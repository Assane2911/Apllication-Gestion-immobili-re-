import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { EVENEMENT_FIL_LU } from "../utils/nonLus";
import { useRafraichissementPeriodique } from "./useActualisationFil";

/** Intervalle entre deux décomptes des messages non lus. */
export const INTERVALLE_NON_LUS_MS = 30_000;

interface Reponse {
  count: number;
  tenants?: number;
  owners?: number;
}

const ZERO = { count: 0, tenants: 0, owners: 0 };

/**
 * Le nombre de messages non lus de la personne connectée, tenu à jour pour la pastille du menu : au chargement, toutes les trente
 * secondes tant que l'onglet est visible, à son retour, et dès qu'un fil vient d'être lu (voir utils/nonLus.ts). Un échec
 * passager garde le dernier chiffre connu : une pastille qui clignote à zéro sur une coupure de réseau serait pire qu'un
 * chiffre légèrement en retard.
 */
export function useNonLus(adresse: string | null) {
  const [valeur, setValeur] = useState(ZERO);

  const recompter = useCallback(async () => {
    if (!adresse) return;
    try {
      const res = await api.get<Reponse>(adresse);
      const count = Number(res.data?.count);
      if (!Number.isFinite(count)) return;
      setValeur((avant) => {
        const suivante = { count, tenants: res.data.tenants ?? 0, owners: res.data.owners ?? 0 };
        // Même chiffre : on garde l'objet, le menu ne se redessine pas.
        return avant.count === suivante.count && avant.tenants === suivante.tenants && avant.owners === suivante.owners ? avant : suivante;
      });
    } catch {
      // Passager : le prochain tour recompte.
    }
  }, [adresse]);

  useEffect(() => {
    if (!adresse) return;
    void recompter();
    window.addEventListener(EVENEMENT_FIL_LU, recompter);
    return () => window.removeEventListener(EVENEMENT_FIL_LU, recompter);
  }, [adresse, recompter]);

  useRafraichissementPeriodique(recompter, Boolean(adresse), INTERVALLE_NON_LUS_MS);
  return valeur;
}
