import { useTranslation } from "react-i18next";
import type { CrgSynthesis } from "../types";
import { etatReversement } from "../utils/resumeCrg";

const CLASSES = {
  none: "border-orange-300 bg-orange-50 text-orange-900",
  partial: "border-amber-300 bg-amber-50 text-amber-900",
  done: "border-ink-900 bg-white text-ink-900",
  over: "border-rose-300 bg-rose-50 text-rose-900",
} as const;

/** Étiquette de l'état du reversement du mois, à côté du titre : rien versé, en partie, soldé, ou trop versé. */
export default function EtatReversementCrg({ crg }: { crg: CrgSynthesis }) {
  const { t } = useTranslation();
  const etat = etatReversement(crg);
  if (!etat) return null;
  return (
    <span className={`inline-block border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider ${CLASSES[etat]}`}>
      {t(`common.crgReleve.state.${etat}`)}
    </span>
  );
}
