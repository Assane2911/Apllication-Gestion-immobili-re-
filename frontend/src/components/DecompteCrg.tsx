import { useTranslation } from "react-i18next";
import { useCurrency } from "../context/currency";
import type { CrgSynthesis } from "../types";
import { formatByCurrency, formatDeduction } from "../utils/currencyFormat";
import { NomDuBien } from "./PlanLogement";

/** Vrai si le montant est positif ou nul dans TOUTES les devises. */
function allNonNegative(byCurrency: Record<string, number>): boolean {
  const values = Object.values(byCurrency);
  return values.length === 0 || values.every((amount) => amount >= 0);
}

/** Part de chaque poste dans les loyers, en pourcentage entier ; le net ne descend jamais sous zéro dans la barre. */
function parts(loyers: number, charges: number, commission: number, net: number) {
  if (loyers <= 0) return null;
  const pct = (montant: number) => Math.max(0, Math.min(100, (montant / loyers) * 100));
  return { net: pct(net), commission: pct(commission), charges: pct(charges) };
}

/** Une barre à trois tronçons : ce qui revient au propriétaire (encre), la commission (orange), les charges (gris). */
function BarreRepartition({ loyers, charges, commission, net, hauteur = "h-2.5" }: { loyers: number; charges: number; commission: number; net: number; hauteur?: string }) {
  const p = parts(loyers, charges, commission, net);
  if (!p) return <div aria-hidden="true" className={`${hauteur} w-full bg-slate-200`} />;
  return (
    <div aria-hidden="true" className={`flex ${hauteur} w-full gap-px bg-slate-200`}>
      <span className="bg-ink-900" style={{ width: `${p.net}%` }} />
      <span className="bg-orange-700" style={{ width: `${p.commission}%` }} />
      <span className="bg-slate-400" style={{ width: `${p.charges}%` }} />
    </div>
  );
}

interface Props {
  crg: CrgSynthesis;
  /** Espace de traduction des libellés (`manager.crg` ou `owner.crg`). */
  ns: "manager.crg" | "owner.crg";
  /** Libellé de la période, affiché en tête du décompte (« septembre 2026 »). */
  periode: string;
}

/**
 * Le décompte du mois, présenté comme une soustraction : loyers encaissés, moins les charges, moins la commission,
 * égale le net à reverser. En dessous, la répartition des loyers en une barre quand une seule devise est en jeu (des
 * euros et des francs CFA ne se mettent pas dans la même barre), puis le détail bien par bien.
 */
export default function DecompteCrg({ crg, ns, periode }: Props) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const devises = Object.keys(crg.totalLoyersByCurrency);
  const uneSeuleDevise = devises.length === 1 ? devises[0] : null;
  const netPositif = allNonNegative(crg.totalNetByCurrency);

  const cellules = [
    { cle: "loyers", label: t(`${ns}.stats.totalLoyers`), valeur: formatByCurrency(crg.totalLoyersByCurrency, formatMoney), signe: null as string | null },
    { cle: "charges", label: t(`${ns}.stats.totalCharges`), valeur: formatByCurrency(crg.totalChargesByCurrency, formatMoney), signe: "−" },
    {
      cle: "commission",
      label: t(`${ns}.stats.totalCommission`),
      valeur: formatByCurrency(crg.totalCommissionByCurrency, formatMoney),
      signe: "−",
      aide: t(`${ns}.feeRateHint`, { rate: crg.managementFeeRate }),
    },
    { cle: "net", label: t(`${ns}.stats.totalNet`), valeur: formatByCurrency(crg.totalNetByCurrency, formatMoney), signe: "=" },
  ];

  let resume: { net: number; commission: number; charges: number } | null = null;
  if (uneSeuleDevise) {
    const p = parts(
      crg.totalLoyersByCurrency[uneSeuleDevise] ?? 0,
      crg.totalChargesByCurrency[uneSeuleDevise] ?? 0,
      crg.totalCommissionByCurrency[uneSeuleDevise] ?? 0,
      crg.totalNetByCurrency[uneSeuleDevise] ?? 0
    );
    if (p) resume = { net: Math.round(p.net), commission: Math.round(p.commission), charges: Math.round(p.charges) };
  }

  return (
    <div className="space-y-6">
      <section aria-label={t("common.crgReleve.decompte")} className="border border-slate-300 bg-white">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-300 bg-slate-50 px-5 py-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">
            <span aria-hidden="true" className="mr-3 text-[11px] text-orange-700">01</span>
            {t("common.crgReleve.decompte")}
          </h3>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600 first-letter:uppercase">{periode}</p>
        </header>

        <dl className="grid grid-cols-1 gap-px bg-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          {cellules.map((c) => {
            const net = c.cle === "net";
            return (
              <div key={c.cle} className={`relative px-5 py-4 ${net ? "bg-ink-900 text-white" : "bg-white"}`}>
                {c.signe && (
                  <span
                    aria-hidden="true"
                    className={`absolute right-4 top-3 font-mono text-lg font-semibold ${net ? "text-orange-300" : "text-slate-400"}`}
                  >
                    {c.signe}
                  </span>
                )}
                <dt className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${net ? "text-slate-300" : "text-slate-600"}`}>{c.label}</dt>
                <dd
                  className={`mt-2 text-xl font-bold tabular-nums wrap-break-word ${net ? (netPositif ? "text-white" : "text-orange-300") : "text-slate-900"}`}
                >
                  {c.valeur}
                </dd>
                {c.aide && <p className="mt-1 font-mono text-[11px] text-slate-600">{c.aide}</p>}
              </div>
            );
          })}
        </dl>

        {resume && uneSeuleDevise && (
          <div className="border-t border-slate-300 px-5 py-4">
            <BarreRepartition
              loyers={crg.totalLoyersByCurrency[uneSeuleDevise] ?? 0}
              charges={crg.totalChargesByCurrency[uneSeuleDevise] ?? 0}
              commission={crg.totalCommissionByCurrency[uneSeuleDevise] ?? 0}
              net={crg.totalNetByCurrency[uneSeuleDevise] ?? 0}
            />
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
              {[
                { cle: "net", barre: "bg-ink-900", texte: `${t("common.crgReleve.shareNet")} · ${resume.net} %` },
                { cle: "commission", barre: "bg-orange-700", texte: `${t("common.crgReleve.shareCommission")} · ${resume.commission} %` },
                { cle: "charges", barre: "bg-slate-400", texte: `${t("common.crgReleve.shareCharges")} · ${resume.charges} %` },
              ].map((l) => (
                <li key={l.cle} className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-800">
                  <span aria-hidden="true" className={`size-2.5 ${l.barre}`} />
                  {l.texte}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-label={t(`${ns}.table.title`)} className="border border-slate-300 bg-white">
        <header className="flex items-baseline gap-3 border-b border-slate-300 bg-slate-50 px-5 py-3">
          <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-orange-700">02</span>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t(`${ns}.table.title`)}</h3>
        </header>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="px-4 py-3 font-semibold">{t(`${ns}.table.property`)}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t(`${ns}.table.currency`)}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t(`${ns}.table.loyers`)}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t(`${ns}.table.charges`)}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t(`${ns}.table.commission`)}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t(`${ns}.table.net`)}</th>
                <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">{t("common.crgReleve.share")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {crg.properties.map((row) => (
                <tr key={`${row.propertyId}-${row.currency}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900"><NomDuBien titre={row.propertyTitle} id={row.propertyId} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.currency}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">{formatMoney(row.loyersEncaisses, row.currency)}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">{formatDeduction(row.chargesDeduites, row.currency, formatMoney)}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-orange-800">{formatDeduction(row.commission, row.currency, formatMoney)}</td>
                  <td className={`px-4 py-3 font-bold tabular-nums ${row.netAReverser >= 0 ? "text-ink-900" : "text-orange-700"}`}>
                    {formatMoney(row.netAReverser, row.currency)}
                  </td>
                  <td className="w-32 px-4 py-3">
                    <BarreRepartition loyers={row.loyersEncaisses} charges={row.chargesDeduites} commission={row.commission} net={row.netAReverser} hauteur="h-1.5" />
                  </td>
                </tr>
              ))}
              {crg.properties.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-600">
                    {t(`${ns}.empty`)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
