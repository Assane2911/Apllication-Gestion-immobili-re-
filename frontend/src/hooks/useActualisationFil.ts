import { useEffect, useRef } from "react";
import { api } from "../api/client";
import type { Message } from "../types";
import { signalerFilLu } from "../utils/nonLus";

/** Intervalle entre deux actualisations d'un fil ouvert sur un onglet visible. */
export const INTERVALLE_FIL_MS = 10_000;
/** Les liens signés des vocaux valent une heure : on les renouvelle (lecture complète du fil) avant l'échéance. */
export const RENOUVELLEMENT_LIENS_MS = 40 * 60 * 1000;

export interface ReponseActualisation {
  messages: Message[];
  luesIds?: string[];
}

interface Options {
  /** Adresse du fil (ex. « /messages/c1 »), ou null tant qu'aucun fil n'est ouvert. */
  adresse: string | null;
  params?: Record<string, string>;
  /** Dernier message affiché : le serveur ne renvoie que ceux qui le suivent. */
  dernierId: string | null;
  /** Reçoit chaque réponse, pour la fusionner dans le fil affiché. */
  surReponse: (reponse: ReponseActualisation) => void;
  /** Côté gestionnaire : prévenu quand l'actualisation rapporte du nouveau, pour rafraîchir la liste des fils. */
  surNouveau?: () => void;
  /** Faux tant que le fil n'est pas entièrement chargé : une actualisation ne doit jamais se fondre dans le fil précédent. */
  actif?: boolean;
  intervalleMs?: number;
}

/**
 * Tient le fil ouvert à jour sans rechargement : toutes les dix secondes, tant que l'onglet est visible, demande au serveur les
 * messages postérieurs au dernier affiché (et l'état « Lu » de ceux qu'on a envoyés), et à chaque retour sur l'onglet. Pas de
 * connexion permanente : l'hébergement est sans état. Un échec passager (réseau, serveur) est ignoré, le prochain tour réessaie.
 * Jamais deux requêtes en même temps ; une réponse arrivée après un changement de fil est écartée.
 */
export function useActualisationFil({ adresse, params, dernierId, surReponse, surNouveau, actif: autorise = true, intervalleMs = INTERVALLE_FIL_MS }: Options) {
  // Les valeurs qui changent à chaque message passent par des références : elles ne doivent pas relancer le minuteur.
  const dernier = useRef(dernierId);
  const rappels = useRef({ surReponse, surNouveau });
  // Mises à jour dans un effet (jamais pendant le rendu) : les tours du minuteur lisent toujours les dernières valeurs.
  useEffect(() => {
    dernier.current = dernierId;
    rappels.current = { surReponse, surNouveau };
  });
  const cleParams = JSON.stringify(params ?? {});

  useEffect(() => {
    if (!adresse || !autorise) return;
    let actif = true;
    let enCours = false;
    let derniereLectureComplete = Date.now();

    async function actualiser() {
      if (!actif || enCours || document.visibilityState !== "visible") return;
      enCours = true;
      const complete = Date.now() - derniereLectureComplete >= RENOUVELLEMENT_LIENS_MS;
      try {
        const requete = { ...(JSON.parse(cleParams) as Record<string, string>), ...(!complete && dernier.current ? { apresId: dernier.current } : {}) };
        const res = await api.get<ReponseActualisation>(adresse!, { params: requete });
        if (!actif) return;
        if (complete) derniereLectureComplete = Date.now();
        const messages = Array.isArray(res.data?.messages) ? res.data.messages : [];
        rappels.current.surReponse({ messages, luesIds: res.data?.luesIds });
        if (messages.length > 0 && !complete) {
          rappels.current.surNouveau?.();
          // Lire le fil marque ses messages reçus comme lus : la pastille du menu se recompte.
          signalerFilLu();
        }
      } catch {
        // Passager : le prochain tour réessaie.
      } finally {
        enCours = false;
      }
    }

    const minuteur = window.setInterval(() => void actualiser(), intervalleMs);
    const auRetour = () => void actualiser();
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      actif = false;
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [adresse, cleParams, intervalleMs, autorise]);
}

/** Intervalle entre deux rafraîchissements de la liste des fils du gestionnaire. */
export const INTERVALLE_LISTE_MS = 30_000;

/**
 * Appelle `rappel` (recharger la liste des fils) à intervalle régulier tant que l'onglet est visible, et au retour sur l'onglet.
 * Sans cela, un message arrivé dans un AUTRE fil que celui qui est ouvert n'apparaîtrait qu'au rechargement de la page.
 */
export function useRafraichissementPeriodique(rappel: () => unknown, actif: boolean, intervalleMs: number = INTERVALLE_LISTE_MS) {
  const courant = useRef(rappel);
  useEffect(() => {
    courant.current = rappel;
  });
  useEffect(() => {
    if (!actif) return;
    const lancer = () => {
      if (document.visibilityState === "visible") void courant.current();
    };
    const minuteur = window.setInterval(lancer, intervalleMs);
    document.addEventListener("visibilitychange", lancer);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", lancer);
    };
  }, [actif, intervalleMs]);
}
