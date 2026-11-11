import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useRafraichissementPeriodique } from "./useActualisationFil";

/** Intervalle entre deux décomptes : une échéance ne change pas à la minute, inutile de solliciter le serveur plus souvent. */
export const INTERVALLE_RESUME_AGENDA_MS = 5 * 60_000;

export interface ResumeAgenda {
  overdue: number;
  overdueOther: number;
  soon: number;
}

const ZERO: ResumeAgenda = { overdue: 0, overdueOther: 0, soon: 0 };
const nombre = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Les chiffres de l'agenda du gestionnaire, pour la pastille du menu : au chargement, toutes les cinq minutes tant que
 * l'onglet est visible, et à son retour. Un échec passager garde le dernier chiffre connu (comme useNonLus) : une pastille
 * qui s'éteint sur une coupure de réseau serait pire qu'un chiffre légèrement en retard.
 */
export function useResumeAgenda(actif: boolean = true): ResumeAgenda {
  const [valeur, setValeur] = useState<ResumeAgenda>(ZERO);

  const recompter = useCallback(async () => {
    try {
      const res = await api.get<ResumeAgenda>("/agenda/summary");
      const overdue = nombre(res.data?.overdue);
      const overdueOther = nombre(res.data?.overdueOther);
      const soon = nombre(res.data?.soon);
      if (overdue === null || overdueOther === null || soon === null) return;
      setValeur((avant) => (avant.overdue === overdue && avant.overdueOther === overdueOther && avant.soon === soon ? avant : { overdue, overdueOther, soon }));
    } catch {
      // Passager : le prochain tour recompte.
    }
  }, []);

  useEffect(() => {
    if (actif) void recompter();
  }, [actif, recompter]);

  useRafraichissementPeriodique(recompter, actif, INTERVALLE_RESUME_AGENDA_MS);
  return valeur;
}
