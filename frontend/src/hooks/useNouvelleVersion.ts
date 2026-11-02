import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import { estNouvelleVersion, lireVersionPubliee, VERSION_COURANTE } from "../utils/versionPubliee";

/** Intervalle entre deux vérifications d'un onglet visible. */
export const INTERVALLE_VERIFICATION_MS = 5 * 60 * 1000;
/** Au retour sur l'onglet, on revérifie si la dernière vérification date d'au moins ceci. */
const DELAI_RETOUR_MS = 60 * 1000;

/**
 * Dit si un déploiement a eu lieu depuis le chargement de cet onglet. La vérification se fait toutes les cinq minutes tant
 * que l'onglet est visible, et au retour sur un onglet resté en arrière-plan. Elle s'arrête dès qu'une nouvelle version est
 * trouvée. Sans effet dans l'application mobile (son code est embarqué : elle se met à jour par le store) et en développement.
 */
export function useNouvelleVersion(courante: string = VERSION_COURANTE) {
  const [disponible, setDisponible] = useState(false);
  const [ignoree, setIgnoree] = useState(false);
  const actif = courante !== "dev" && !Capacitor.isNativePlatform();

  useEffect(() => {
    if (!actif || disponible) return;
    let derniere = Date.now();
    let annule = false;

    async function verifier() {
      derniere = Date.now();
      const publiee = await lireVersionPubliee();
      if (!annule && estNouvelleVersion(courante, publiee)) setDisponible(true);
    }

    const minuteur = window.setInterval(() => {
      if (document.visibilityState === "visible") void verifier();
    }, INTERVALLE_VERIFICATION_MS);
    function auRetour() {
      if (document.visibilityState === "visible" && Date.now() - derniere >= DELAI_RETOUR_MS) void verifier();
    }
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      annule = true;
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [actif, disponible, courante]);

  const reporter = useCallback(() => setIgnoree(true), []);
  return { disponible: disponible && !ignoree, reporter };
}
