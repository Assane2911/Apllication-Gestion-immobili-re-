import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerClientSerialise, DelaiBaseDepasse } from "./clientSerialise";

/**
 * Le client serialisé exécute les requêtes UNE PAR UNE (postgres-js pipeline sinon, et le pooler Supabase
 * perd les requêtes pipelinées au-delà de la première), et se recrée quand une requête ne revient pas.
 *
 * Ces tests utilisent un faux client : ils prouvent la logique (file, transactions, délai, recyclage).
 * Que le pipeline ait réellement disparu des échanges réseau se vérifie sur un vrai Postgres.
 */
type Resolveur = { resoudre: (v?: unknown) => void; rejeter: (e: unknown) => void };

function fauxClient(nom = "client") {
  const etat = { enCours: 0, maxEnCours: 0, appels: [] as string[], fermé: false, bloquer: false };
  const attentes: Resolveur[] = [];
  const executer = (requete: string, valeur: unknown) => {
    etat.appels.push(requete);
    etat.enCours++;
    etat.maxEnCours = Math.max(etat.maxEnCours, etat.enCours);
    return new Promise((resoudre, rejeter) => {
      const fin = (v: unknown) => {
        etat.enCours--;
        resoudre(v);
      };
      const echec = (e: unknown) => {
        etat.enCours--;
        rejeter(e);
      };
      if (etat.bloquer) {
        attentes.push({ resoudre: fin, rejeter: echec });
        return;
      }
      setTimeout(() => (requete.includes("ERREUR") ? echec(new Error("échec simulé")) : fin(valeur)), 5);
    });
  };
  const client = {
    nom,
    options: { parsers: {}, serializers: {} },
    unsafe: (requete: string) => ({
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => executer(requete, [{ requete }]).then(ok, ko),
      values: () => executer(requete, [[requete]]),
    }),
    begin: async (fn: (tx: unknown) => Promise<unknown>) => {
      etat.appels.push("BEGIN");
      etat.enCours++;
      etat.maxEnCours = Math.max(etat.maxEnCours, etat.enCours);
      try {
        // Dans la transaction : le client réservé, que le serialiseur ne touche pas.
        return await fn({ unsafe: () => Promise.resolve([{ dansTransaction: true }]) });
      } finally {
        etat.enCours--;
        etat.appels.push("COMMIT");
      }
    },
    end: vi.fn(async () => {
      etat.fermé = true;
    }),
  };
  return { client, etat, attentes };
}

const OPTIONS = { delaiRequeteMs: 1_000, delaiTransactionMs: 5_000 };
// Le client serialisé est typé comme un client postgres-js ; ses méthodes utiles sont appelées telles que Drizzle les appelle.
const sur = (client: unknown) =>
  client as { unsafe: (r: string, p?: unknown[]) => PromiseLike<unknown> & { values: () => Promise<unknown[][]> }; begin: (fn: (tx: { unsafe: () => Promise<unknown> }) => Promise<unknown>) => Promise<unknown>; options: unknown };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("client serialisé : une requête à la fois", () => {
  it("n'a jamais plus d'une requête en vol, quel que soit le nombre d'appels concurrents", async () => {
    const { client, etat } = fauxClient();
    const db = sur(creerClientSerialise(() => client as never, OPTIONS));

    // Une requête attendue directement entre dans la file au tour suivant, une .values() tout de suite :
    // on ne compare donc pas l'ordre global, seulement qu'elles passent toutes, une à la fois.
    const resultats = Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? db.unsafe(`SELECT ${i}`).values() : Promise.resolve(db.unsafe(`SELECT ${i}`)))));
    await vi.advanceTimersByTimeAsync(100);
    await resultats;

    expect(etat.maxEnCours).toBe(1);
    expect([...etat.appels].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `SELECT ${i}`));
  });

  it("rend ce que rend le client, en attente directe comme en .values()", async () => {
    const { client } = fauxClient();
    const db = sur(creerClientSerialise(() => client as never, OPTIONS));

    const [direct, valeurs] = await Promise.all([
      (async () => db.unsafe("SELECT 1"))(),
      db.unsafe("SELECT 2").values(),
      vi.advanceTimersByTimeAsync(50),
    ]);

    expect(direct).toEqual([{ requete: "SELECT 1" }]);
    expect(valeurs).toEqual([["SELECT 2"]]);
  });

  it("une requête en échec rejette son appelant sans bloquer la file", async () => {
    const { client, etat } = fauxClient();
    const db = sur(creerClientSerialise(() => client as never, OPTIONS));

    const echec = Promise.resolve(db.unsafe("SELECT ERREUR")).catch((e: Error) => e.message);
    const suite = db.unsafe("SELECT 2").values();
    await vi.advanceTimersByTimeAsync(50);

    expect(await echec).toBe("échec simulé");
    expect(await suite).toEqual([["SELECT 2"]]);
    expect(etat.maxEnCours).toBe(1);
  });

  it("passe les options du client courant (Drizzle y règle ses analyseurs de types)", () => {
    const { client } = fauxClient();
    const db = sur(creerClientSerialise(() => client as never, OPTIONS));

    expect(db.options).toBe(client.options);
  });
});

describe("client serialisé : transactions", () => {
  it("une transaction garde la file : les requêtes isolées attendent sa fin, sans s'y mêler", async () => {
    const { client, etat } = fauxClient();
    const db = sur(creerClientSerialise(() => client as never, OPTIONS));

    let finTransaction!: () => void;
    const transaction = db.begin(async (tx) => {
      await tx.unsafe();
      await new Promise<void>((r) => (finTransaction = r));
      return "fait";
    });
    const pendant = db.unsafe("SELECT pendant").values();
    await vi.advanceTimersByTimeAsync(200);

    // La requête isolée n'est pas partie tant que la transaction tient la file.
    expect(etat.appels).toEqual(["BEGIN"]);
    finTransaction();
    await vi.advanceTimersByTimeAsync(50);

    expect(await transaction).toBe("fait");
    expect(await pendant).toEqual([["SELECT pendant"]]);
    expect(etat.appels).toEqual(["BEGIN", "COMMIT", "SELECT pendant"]);
    expect(etat.maxEnCours).toBe(1);
  });

  it("une transaction en échec libère la file", async () => {
    const { client } = fauxClient();
    const db = sur(creerClientSerialise(() => client as never, OPTIONS));

    const echec = db.begin(async () => {
      throw new Error("annulée");
    }).catch((e: Error) => e.message);
    const suite = db.unsafe("SELECT apres").values();
    await vi.advanceTimersByTimeAsync(50);

    expect(await echec).toBe("annulée");
    expect(await suite).toEqual([["SELECT apres"]]);
  });
});

describe("client serialisé : connexion figée", () => {
  it("une requête qui ne revient pas est abandonnée après le délai, et le client est recréé", async () => {
    const premier = fauxClient("premier");
    const second = fauxClient("second");
    const clients = [premier, second];
    const surRecyclage = vi.fn();
    const db = sur(creerClientSerialise(() => clients.shift()!.client as never, { ...OPTIONS, surRecyclage }));

    premier.etat.bloquer = true;
    const bloquee = Promise.resolve(db.unsafe("SELECT bloquee")).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);

    const erreur = await bloquee;
    expect(erreur).toBeInstanceOf(DelaiBaseDepasse);
    expect((erreur as DelaiBaseDepasse).code).toBe("DB_TIMEOUT");
    expect(surRecyclage).toHaveBeenCalledTimes(1);
    // Le client figé est fermé sans attendre ; le suivant repart sur le nouveau.
    expect(premier.client.end).toHaveBeenCalledWith({ timeout: 0 });
    const suite = db.unsafe("SELECT apres").values();
    await vi.advanceTimersByTimeAsync(50);
    expect(await suite).toEqual([["SELECT apres"]]);
    expect(second.etat.appels).toEqual(["SELECT apres"]);
  });

  it("les requêtes en file derrière une requête figée ne sont pas perdues : elles passent sur le nouveau client", async () => {
    const premier = fauxClient("premier");
    const second = fauxClient("second");
    const clients = [premier, second];
    const db = sur(creerClientSerialise(() => clients.shift()!.client as never, OPTIONS));

    premier.etat.bloquer = true;
    const bloquee = db.unsafe("SELECT bloquee").values().catch(() => "abandonnée");
    const derriere = db.unsafe("SELECT derriere").values();
    await vi.advanceTimersByTimeAsync(1_001);
    await vi.advanceTimersByTimeAsync(50);

    expect(await bloquee).toBe("abandonnée");
    expect(await derriere).toEqual([["SELECT derriere"]]);
    expect(premier.etat.appels).toEqual(["SELECT bloquee"]);
    expect(second.etat.appels).toEqual(["SELECT derriere"]);
  });

  it("une requête rapide ne déclenche ni délai ni recyclage", async () => {
    const { client } = fauxClient();
    const surRecyclage = vi.fn();
    const db = sur(creerClientSerialise(() => client as never, { ...OPTIONS, surRecyclage }));

    const res = db.unsafe("SELECT 1").values();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await res).toEqual([["SELECT 1"]]);
    expect(surRecyclage).not.toHaveBeenCalled();
    expect(client.end).not.toHaveBeenCalled();
  });

  it("une transaction figée est abandonnée après SON délai (plus long), et le client est recréé", async () => {
    const premier = fauxClient("premier");
    const second = fauxClient("second");
    const clients = [premier, second];
    const db = sur(creerClientSerialise(() => clients.shift()!.client as never, OPTIONS));

    const figee = db.begin(() => new Promise(() => {})).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);
    // Le délai d'une requête isolée ne s'applique pas à une transaction.
    expect(premier.client.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(await figee).toBeInstanceOf(DelaiBaseDepasse);
    expect(premier.client.end).toHaveBeenCalledTimes(1);
  });
});

describe("branchement de production", () => {
  // Les tests tournent sur une base locale (PGlite) : la branche postgres-js de client.ts n'y est jamais
  // chargée. Cette garde empêche de la revenir, sans qu'aucun test ne l'ait vu, à un client qui pipeline.
  const source = readFileSync(path.resolve(__dirname, "client.ts"), "utf8");

  it("la connexion de production passe par le client serialisé", () => {
    expect(source).toContain("creerClientSerialise(creerClient");
    expect(source).toMatch(/dbInstance = drizzlePg\(client, \{ schema \}\)/);
  });

  it("chaque client recréé reçoit les analyseurs de types de Drizzle (dates, JSON)", () => {
    expect(source).toMatch(/drizzlePg\(brut, \{ schema \}\);\s*return brut;/);
  });

  it("le client reste à une connexion, sans préparation, avec un délai de connexion", () => {
    expect(source).toMatch(/postgres\(connectionString, \{[^}]*prepare: false[^}]*max: 1[^}]*connect_timeout: 10/);
  });
});
