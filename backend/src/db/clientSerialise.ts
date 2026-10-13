import type postgres from "postgres";

/**
 * Client postgres-js qui exécute les requêtes UNE PAR UNE, et se recrée quand la connexion se fige.
 *
 * Pourquoi : postgres-js « pipeline » les requêtes concurrentes sur une même connexion (jusqu'à 100,
 * voir `max_pipeline`). Derrière le pooler Supabase en mode transaction (Supavisor, port 6543), les
 * octets des requêtes pipelinées au-delà de la première ne sont jamais transmis à un backend : la
 * promesse ne se résout jamais, le backend reste « active / ClientRead » indéfiniment et TOUTES les
 * requêtes mises en file derrière sur cette connexion attendent aussi. Notre client n'a qu'une
 * connexion (`max: 1`), et une page qui lance trois appels d'API à la fois suffit à déclencher le
 * blocage : la fonction tourne alors jusqu'au délai maximal de Vercel (300 s), et la connexion
 * bloquée empoisonne l'instance pour les requêtes suivantes. Voir porsager/postgres#970 et la page
 * « hanging queries in Serverless Functions » de la documentation Supabase.
 *
 * Désactiver le pipeline (`max_pipeline: 0`) casserait `sql.begin`, donc toutes les transactions :
 * le rappel qui réserve la connexion n'est plus jamais appelé. On sérialise donc ici, en amont :
 *  - une requête isolée attend la fin de la précédente (file FIFO) ;
 *  - une transaction garde la file pour toute sa durée, comme elle gardait déjà l'unique connexion.
 *    À l'intérieur, le client est celui de postgres-js, lié à la connexion réservée : le backend ne
 *    change pas de main tant que la transaction dure, le pipeline n'y est pas en cause.
 *
 * Garde de délai : une requête (ou une transaction) qui ne revient pas dans le temps imparti est
 * abandonnée avec une erreur, et le client est recréé. La cause n'est pas toujours le pipeline : une
 * fonction gelée entre deux requêtes laisse un socket que le pooler a fermé entre-temps, et la
 * reprise y écrit dans le vide. Échouer en quelques secondes et repartir sur une connexion neuve
 * vaut mieux qu'attendre 300 s sur une connexion morte.
 */
type ClientPostgres = ReturnType<typeof postgres>;

export interface OptionsClientSerialise {
  /** Au-delà, une requête isolée est tenue pour bloquée (ms). */
  delaiRequeteMs: number;
  /** Au-delà, une transaction entière est tenue pour bloquée (ms). */
  delaiTransactionMs: number;
  /** Appelée quand le client est recréé (journalisation). */
  surRecyclage?: (raison: string) => void;
}

export class DelaiBaseDepasse extends Error {
  readonly code = "DB_TIMEOUT";
  constructor(delaiMs: number) {
    super(`La base de données ne répond pas (aucune réponse après ${Math.round(delaiMs / 1000)} s).`);
    this.name = "DelaiBaseDepasse";
  }
}

export function creerClientSerialise(creer: () => ClientPostgres, options: OptionsClientSerialise): ClientPostgres {
  let courant = creer();
  // Chaîne de promesses qui sert de file FIFO : chaque tâche attend la fin de la précédente, qu'elle
  // ait réussi ou échoué.
  let file: Promise<unknown> = Promise.resolve();

  function recycler(client: ClientPostgres, raison: string) {
    // Un seul remplacement par client : plusieurs délais dépassés ne recréent pas plusieurs fois.
    if (courant !== client) return;
    courant = creer();
    options.surRecyclage?.(raison);
    // Fermeture immédiate (timeout 0), sans attendre une connexion qui ne répond plus.
    Promise.resolve(client.end({ timeout: 0 })).catch(() => {});
  }

  function executerAvecGarde<T>(tache: (client: ClientPostgres) => PromiseLike<T> | T, delaiMs: number): Promise<T> {
    const client = courant;
    return new Promise<T>((resolve, reject) => {
      let termine = false;
      const minuteur = setTimeout(() => {
        if (termine) return;
        termine = true;
        recycler(client, `aucune réponse après ${delaiMs} ms`);
        reject(new DelaiBaseDepasse(delaiMs));
      }, delaiMs);
      // Le minuteur ne doit jamais retenir le processus (tests, arrêt propre).
      minuteur.unref?.();

      Promise.resolve()
        .then(() => tache(client))
        .then(
          (valeur) => {
            if (termine) return;
            termine = true;
            clearTimeout(minuteur);
            resolve(valeur);
          },
          (erreur) => {
            if (termine) return;
            termine = true;
            clearTimeout(minuteur);
            reject(erreur);
          }
        );
    });
  }

  function enSerie<T>(tache: (client: ClientPostgres) => PromiseLike<T> | T, delaiMs: number): Promise<T> {
    const resultat = file.then(() => executerAvecGarde(tache, delaiMs));
    // La file continue même si cette tâche échoue.
    file = resultat.catch(() => undefined);
    return resultat;
  }

  /**
   * Ce que Drizzle fait d'un `client.unsafe(requête, paramètres)` : l'attendre directement, ou en
   * demander les lignes sous forme de tableaux (`.values()`).
   */
  function requete(args: unknown[]) {
    const lancer = (client: ClientPostgres) => (client.unsafe as (...a: unknown[]) => PromiseLike<unknown>)(...args);
    return {
      then: <R1, R2>(surSucces?: (v: unknown) => R1 | PromiseLike<R1>, surEchec?: (e: unknown) => R2 | PromiseLike<R2>) =>
        enSerie(lancer, options.delaiRequeteMs).then(surSucces, surEchec),
      values: () =>
        enSerie(
          (client) => (client.unsafe as (...a: unknown[]) => { values(): PromiseLike<unknown[][]> })(...args).values(),
          options.delaiRequeteMs
        ),
    };
  }

  const facade = new Proxy(function () {} as unknown as ClientPostgres, {
    get(_cible, propriete) {
      if (propriete === "unsafe") return (...args: unknown[]) => requete(args);
      if (propriete === "begin") {
        return (...args: unknown[]) =>
          enSerie((client) => (client.begin as (...a: unknown[]) => PromiseLike<unknown>)(...args), options.delaiTransactionMs);
      }
      // Tout le reste (options, end, …) est celui du client COURANT : il change quand on recrée.
      const valeur = Reflect.get(courant, propriete);
      return typeof valeur === "function" ? valeur.bind(courant) : valeur;
    },
    apply() {
      throw new Error("Le client serialisé ne s'utilise pas comme une fonction à gabarit : passer par Drizzle (unsafe, begin).");
    },
  });
  return facade;
}
