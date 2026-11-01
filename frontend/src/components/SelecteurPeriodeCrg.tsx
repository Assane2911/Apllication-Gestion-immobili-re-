import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  month: number;
  year: number;
  onChange: (month: number, year: number) => void;
  /** Préfixe des identifiants des deux menus (plusieurs pages peuvent coexister dans les tests). */
  idPrefixe: string;
  /** Espace de traduction des libellés « Mois » et « Année » (`manager.crg` ou `owner.crg`). */
  ns: "manager.crg" | "owner.crg";
}

const CHAMP =
  "border border-slate-400 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20";
const FLECHE =
  "flex size-8 cursor-pointer items-center justify-center border border-slate-400 bg-white text-ink-900 transition-colors hover:border-ink-900 disabled:cursor-default disabled:opacity-40 disabled:hover:border-slate-400";

/**
 * Choix de la période d'un compte-rendu de gestion : mois et année en menus, deux flèches pour passer au mois voisin
 * (de décembre à janvier, l'année suit) et un raccourci vers le mois en cours. La période va de cinq ans en arrière
 * jusqu'à la fin de l'année courante, comme les menus d'origine.
 */
export default function SelecteurPeriodeCrg({ month, year, onChange, idPrefixe, ns }: Props) {
  const { t, i18n } = useTranslation();
  const maintenant = new Date();
  const anneeCourante = maintenant.getFullYear();
  const moisCourant = maintenant.getMonth() + 1;
  const anneeMin = anneeCourante - 5;

  const mois = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i, 1).toLocaleDateString(i18n.language, { month: "long" }),
  }));
  const annees = Array.from({ length: 6 }, (_, i) => anneeCourante - i);

  const index = year * 12 + (month - 1);
  const min = anneeMin * 12;
  const max = anneeCourante * 12 + 11;
  function aller(nouvelIndex: number) {
    onChange((nouvelIndex % 12) + 1, Math.floor(nouvelIndex / 12));
  }
  const estMoisCourant = month === moisCourant && year === anneeCourante;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <button type="button" onClick={() => aller(index - 1)} disabled={index <= min} aria-label={t("common.crgReleve.previous")} className={FLECHE}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <div>
        <label htmlFor={`${idPrefixe}-month-select`} className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-700">
          {t(`${ns}.monthLabel`)}
        </label>
        <select
          id={`${idPrefixe}-month-select`}
          value={month}
          onChange={(e) => onChange(Number(e.target.value), year)}
          className={`${CHAMP} capitalize`}
        >
          {mois.map((m) => (
            <option key={m.value} value={m.value} className="capitalize">
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefixe}-year-select`} className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-700">
          {t(`${ns}.yearLabel`)}
        </label>
        <select id={`${idPrefixe}-year-select`} value={year} onChange={(e) => onChange(month, Number(e.target.value))} className={CHAMP}>
          {annees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <button type="button" onClick={() => aller(index + 1)} disabled={index >= max} aria-label={t("common.crgReleve.next")} className={FLECHE}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onChange(moisCourant, anneeCourante)}
        disabled={estMoisCourant}
        className="h-8 cursor-pointer border-b border-ink-900/40 px-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 disabled:cursor-default disabled:border-transparent disabled:text-slate-500 disabled:hover:text-slate-500"
      >
        {t("common.crgReleve.thisMonth")}
      </button>
    </div>
  );
}
