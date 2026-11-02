import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api/client";
import { aAnnoncer, definirEtat, enCours, type EtatMaintenance, lireEtat, lireEtatCourant, sAbonner } from "../utils/maintenance";

/** Intervalle entre deux interrogations de l'état de la maintenance. Plus court quand elle est en cours : on veut le retour vite. */
export const INTERVALLE_MAINTENANCE_MS = 60_000;
export const INTERVALLE_MAINTENANCE_EN_COURS_MS = 15_000;
/** Le temps affiché (minutes restantes) se rafraîchit à ce rythme. */
const PAS_HORLOGE_MS = 30_000;

/**
 * L'état de la maintenance planifiée, tenu à jour : interrogé au chargement, à intervalle régulier tant que l'onglet est visible,
 * à son retour au premier plan, et à la demande (`verifier`). Il est aussi alimenté, hors de ce hook, par toute réponse 503
 * « MAINTENANCE » de l'API (voir api/client.ts). Une interrogation qui échoue garde l'état connu : un réseau capricieux ne doit ni
 * lever ni baisser l'écran de maintenance.
 *
 * `maintenant` avance toutes les 30 s : la bascule « à venir → en cours → terminée » se voit à la seconde près sans attendre le
 * serveur, et les minutes restantes se mettent à jour.
 */
export function useMaintenance() {
  const etat = useSyncExternalStore(sAbonner, lireEtatCourant, lireEtatCourant);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [verification, setVerification] = useState(false);

  const verifier = useCallback(async () => {
    setVerification(true);
    try {
      const res = await api.get<{ maintenance?: unknown }>("/maintenance");
      definirEtat(lireEtat(res.data?.maintenance));
    } catch {
      // Passager : on garde ce qu'on sait.
    } finally {
      setVerification(false);
      setMaintenant(Date.now());
    }
  }, []);

  const bloquee = enCours(etat, maintenant);

  useEffect(() => {
    void verifier();
  }, [verifier]);

  useEffect(() => {
    const periode = bloquee ? INTERVALLE_MAINTENANCE_EN_COURS_MS : INTERVALLE_MAINTENANCE_MS;
    const minuteur = window.setInterval(() => {
      if (document.visibilityState === "visible") void verifier();
    }, periode);
    const auRetour = () => {
      if (document.visibilityState === "visible") void verifier();
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [bloquee, verifier]);

  // L'horloge ne tourne que s'il y a une maintenance à suivre.
  useEffect(() => {
    if (!etat) return;
    const horloge = window.setInterval(() => setMaintenant(Date.now()), PAS_HORLOGE_MS);
    return () => window.clearInterval(horloge);
  }, [etat]);

  const etatCourant: EtatMaintenance | null = etat;
  return { etat: etatCourant, enCours: bloquee, aAnnoncer: aAnnoncer(etat, maintenant), maintenant, verification, verifier };
}
