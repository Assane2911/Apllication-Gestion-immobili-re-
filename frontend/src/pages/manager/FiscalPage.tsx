import { BookText, Download, FileSpreadsheet, Landmark, Scale } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import { GraphiqueComparaisonFiscale } from "../../components/graphiques/graphiquesALaDemande";
import SectionReglage from "../../components/SectionReglage";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { AnnualFiscalSynthesis, ExpenseCategory } from "../../types";
import { devisesPresentes, formatByCurrency, formatDeduction } from "../../utils/currencyFormat";
import { moisCourt } from "../../utils/moisDuGraphique";
import Bulle from "../../components/Bulle";
import { NomDuBien } from "../../components/PlanLogement";
import { partDesDepenses, repartitionParCategorie, variationAnnuelle } from "../../utils/syntheseFinances";
import { csvSixMois } from "../../utils/syntheseGestionnaire";
import { dateDuJourPourFichier, telechargerCsv } from "../../utils/telechargement";

// Couleurs de la charte (celles des étiquettes de la page Dépenses) : orange d'annotation, encre, bleu de plan, gris.
const categoryDotColors: Record<ExpenseCategory, string> = {
  MAINTENANCE: "#d9480f",
  TAX: "#0f3d5e",
  INSURANCE: "#124a73",
  SYNDIC: "#5b7b8f",
  OTHER: "#8ca0aa",
};

const BOUTON_PLEIN = "flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-ink-900 px-3.5 py-2.5 text-xs font-semibold text-white transition-colors hover:border-orange-700 hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:bg-slate-100 disabled:opacity-60";

/** Vrai si le résultat net est positif ou nul dans TOUTES les devises. */
function allPositive(byCurrency: Record<string, number>): boolean {
  const values = Object.values(byCurrency);
  return values.length === 0 || values.every((amount) => amount >= 0);
}

export default function FiscalPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [synthesis, setSynthesis] = useState<AnnualFiscalSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadingFEC, setDownloadingFEC] = useState(false);
  const [downloadingSyscohada, setDownloadingSyscohada] = useState(false);
  const [vue, setVue] = useState<"graphique" | "tableau">("graphique");
  // Exercice précédent, pour la comparaison : chargé après coup, et jamais bloquant.
  const [precedente, setPrecedente] = useState<AnnualFiscalSynthesis | null>(null);
  const [comparaisonEnCours, setComparaisonEnCours] = useState(false);

  const categoryLabels: Record<ExpenseCategory, string> = {
    MAINTENANCE: t("manager.expenses.categories.MAINTENANCE"),
    TAX: t("manager.expenses.categories.TAX"),
    INSURANCE: t("manager.expenses.categories.INSURANCE"),
    SYNDIC: t("manager.expenses.categories.SYNDIC"),
    OTHER: t("manager.expenses.categories.OTHER"),
  };

  const loadData = useCallback((selectedYear: number) => {
    setLoading(true);
    api
      .get<AnnualFiscalSynthesis>("/fiscal/synthese", { params: { year: selectedYear } })
      .then((res) => {
        setSynthesis(res.data);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData(year);
  }, [loadData, year]);

  // La comparaison avec l'exercice d'avant se demande : elle coûte une requête de plus, et change avec l'exercice affiché.
  useEffect(() => {
    setPrecedente(null);
  }, [year]);

  async function comparerAvecLAnneePrecedente() {
    setComparaisonEnCours(true);
    try {
      const res = await api.get<AnnualFiscalSynthesis>("/fiscal/synthese", { params: { year: year - 1 } });
      if (res?.data?.totalRevenueByCurrency) setPrecedente(res.data);
    } catch {
      // La comparaison est un plus : sans elle, le bilan reste complet.
    } finally {
      setComparaisonEnCours(false);
    }
  }

  async function downloadGrandLivre() {
    setDownloading(true);
    try {
      const res = await api.get(`/fiscal/grand-livre`, { params: { year }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `grand-livre-${year}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  async function downloadFEC() {
    setDownloadingFEC(true);
    try {
      const res = await api.get(`/fiscal/fec`, { params: { year }, responseType: "blob" });
      // Le nom de fichier réglementaire (SIREN + "FEC" + date de clôture) est
      // décidé par le serveur (voir exportFEC, fiscal.controller.ts) : un nom
      // générique ici romprait la convention attendue par un contrôleur.
      const disposition = res.headers?.["content-disposition"] as string | undefined;
      const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? `fec-${year}.txt`;
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setDownloadingFEC(false);
    }
  }

  async function downloadSyscohada() {
    setDownloadingSyscohada(true);
    try {
      const res = await api.get(`/fiscal/syscohada`, { params: { year }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `syscohada-${year}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setDownloadingSyscohada(false);
    }
  }

  if (error) {
    return (
      <div className="border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <h3 className="mb-1 text-base font-bold">{t("manager.fiscal.errorTitle")}</h3>
        <p className="text-sm">{error}</p>
        <button
          onClick={() => loadData(year)}
          className="mt-4 cursor-pointer bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (loading || !synthesis) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.fiscal.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.fiscal.subtitle")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="border border-slate-300 bg-white p-6">
          <Skeleton className="mb-4 h-5 w-56" />
          <Skeleton className="h-[260px] w-full" />
        </div>
      </div>
    );
  }

  const allMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  const monthlyCurrencies = Array.from(
    new Set([
      ...allMonths.flatMap((m) => Object.keys(synthesis.revenueByMonth[m] ?? {})),
      ...allMonths.flatMap((m) => Object.keys(synthesis.expensesByMonth[m] ?? {})),
    ])
  ).sort();

  const hasMonthlyData = monthlyCurrencies.length > 0;

  const monthLabel = (m: string) => {
    const [, mm] = m.split("-");
    return moisCourt(year, Number(mm), i18n.language);
  };

  const comparisonChartData = allMonths.map((month) => {
    const row: Record<string, string | number> = { month: monthLabel(month) };
    for (const currency of monthlyCurrencies) {
      row[`revenue_${currency}`] = Number(synthesis.revenueByMonth[month]?.[currency] ?? 0);
      row[`expense_${currency}`] = Number(synthesis.expensesByMonth[month]?.[currency] ?? 0);
    }
    return row;
  });

  const repartition = repartitionParCategorie(synthesis.expensesByCategory);

  // Même raison que sur l'écran des dépenses : les trois totaux d'un même
  // bilan doivent s'exprimer dans les mêmes monnaies.
  const devisesDeLEcran = devisesPresentes(synthesis.totalRevenueByCurrency, synthesis.totalExpensesByCurrency, synthesis.netResultByCurrency);

  // Marge nette et poids des dépenses : seulement quand il n'y a qu'une devise (sinon le rapport n'aurait pas de sens).
  const partDepenses = partDesDepenses(synthesis.totalRevenueByCurrency, synthesis.totalExpensesByCurrency);
  const marge = partDepenses === null ? null : 100 - partDepenses;
  // Écart des revenus avec l'exercice précédent, devise par devise.
  const variations = precedente
    ? Object.entries(synthesis.totalRevenueByCurrency)
        .map(([devise, montant]) => ({ devise, pct: variationAnnuelle(Number(montant), precedente.totalRevenueByCurrency[devise]) }))
        .filter((v): v is { devise: string; pct: number } => v.pct !== null)
    : [];

  function exporterMensuelCsv() {
    telechargerCsv(
      `bilan-mensuel-${year}-${dateDuJourPourFichier()}.csv`,
      csvSixMois(
        monthlyCurrencies.flatMap((currency) =>
          allMonths.map((month) => ({ month, currency, revenue: Number(synthesis!.revenueByMonth[month]?.[currency] ?? 0), expense: Number(synthesis!.expensesByMonth[month]?.[currency] ?? 0) }))
        ),
        {
          month: t("manager.fiscal.view.month"),
          currency: t("manager.fiscal.view.currency"),
          revenue: t("manager.fiscal.view.revenue"),
          expense: t("manager.fiscal.view.expense"),
          net: t("manager.fiscal.view.result"),
        }
      )
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.fiscal.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.fiscal.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="fiscal-year-select" className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
            {t("manager.fiscal.yearLabel")}
          </label>
          <select
            id="fiscal-year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
          >
            {synthesis.availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 01 — L'exercice en quatre chiffres, avec l'écart des revenus par rapport à l'exercice précédent. */}
      <SectionReglage id="synthese" numero="01" titre={t("manager.fiscal.sections.summary")}>
        <BandeauChiffres
          etiquette={t("manager.fiscal.summary.label")}
          cases={[
            {
              libelle: t("manager.fiscal.stats.totalRevenue"),
              valeur: formatByCurrency(synthesis.totalRevenueByCurrency, formatMoney, devisesDeLEcran),
              aide: t("manager.fiscal.stats.totalRevenueHint", { year }),
            },
            {
              libelle: t("manager.fiscal.stats.totalExpenses"),
              valeur: formatByCurrency(synthesis.totalExpensesByCurrency, formatMoney, devisesDeLEcran),
              aide: t("manager.fiscal.stats.totalExpensesHint"),
            },
            {
              libelle: t("manager.fiscal.stats.netResult"),
              valeur: formatByCurrency(synthesis.netResultByCurrency, formatMoney, devisesDeLEcran),
              aide: allPositive(synthesis.netResultByCurrency) ? t("manager.fiscal.stats.netResultPositive") : t("manager.fiscal.stats.netResultNegative"),
              ton: allPositive(synthesis.netResultByCurrency) ? "normal" : "alerte",
            },
            {
              libelle: t("manager.fiscal.summary.margin"),
              valeur: marge === null ? "—" : `${marge} %`,
              aide: t("manager.fiscal.summary.marginHint"),
              ton: marge !== null && marge < 0 ? "alerte" : "normal",
            },
          ]}
        />
        {!precedente && synthesis.availableYears.includes(year - 1) && (
          <button
            type="button"
            onClick={comparerAvecLAnneePrecedente}
            disabled={comparaisonEnCours}
            className="mt-3 cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 disabled:opacity-60"
          >
            {t("manager.fiscal.summary.compare", { year: year - 1 })}
          </button>
        )}
        {variations.length > 0 && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {variations.map((v) => `${variations.length > 1 ? `${v.devise} · ` : ""}${t("manager.fiscal.summary.vsPrevious", { pct: `${v.pct > 0 ? "+" : ""}${v.pct}`, year: year - 1 })}`).join(" · ")}
          </p>
        )}
      </SectionReglage>

      {/* 02 — Mois par mois (graphique ou tableau, avec export) et répartition des charges. */}
      <SectionReglage id="analyse" numero="02" titre={t("manager.fiscal.sections.analysis")}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-base font-bold text-slate-900">{t("manager.fiscal.charts.revenueVsExpenses", { year })}</h4>
              {hasMonthlyData && (
                <div className="flex flex-wrap items-center gap-2">
                  <div role="group" aria-label={t("manager.fiscal.view.label")} className="inline-flex border border-slate-400">
                    {(["graphique", "tableau"] as const).map((choix) => (
                      <button
                        key={choix}
                        type="button"
                        aria-pressed={vue === choix}
                        onClick={() => setVue(choix)}
                        className={`cursor-pointer border-r border-slate-400 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 ${
                          vue === choix ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100"
                        }`}
                      >
                        {t(choix === "graphique" ? "manager.fiscal.view.chart" : "manager.fiscal.view.table")}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={exporterMensuelCsv} className="inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900">
                    <Download size={13} aria-hidden="true" />
                    {t("manager.fiscal.view.exportCsv")}
                  </button>
                </div>
              )}
            </div>
            {!hasMonthlyData ? (
              <p className="py-16 text-center text-sm text-slate-600">{t("manager.fiscal.charts.noData")}</p>
            ) : vue === "graphique" ? (
              <div className="h-[280px] w-full">
                <Suspense fallback={<Skeleton className="h-full w-full" />}>
                  <GraphiqueComparaisonFiscale data={comparisonChartData} devises={monthlyCurrencies} />
                </Suspense>
              </div>
            ) : (
              <div className="space-y-6">
                {monthlyCurrencies.map((currency) => (
                  <div key={currency} className="relative overflow-x-auto border border-slate-300">
                    <table className="w-full text-sm">
                      <caption className="sr-only">{t("manager.fiscal.view.tableFor", { currency })}</caption>
                      <thead className="text-left">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-semibold">{t("manager.fiscal.view.month")}</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("manager.fiscal.view.revenue")}</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("manager.fiscal.view.expense")}</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("manager.fiscal.view.result")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {allMonths.map((month) => {
                          const revenu = Number(synthesis.revenueByMonth[month]?.[currency] ?? 0);
                          const depense = Number(synthesis.expensesByMonth[month]?.[currency] ?? 0);
                          return (
                            <tr key={month} className="hover:bg-slate-50">
                              <th scope="row" className="px-4 py-2 text-left text-xs font-medium capitalize text-slate-700">{monthLabel(month)}</th>
                              <td className="px-4 py-2 text-right font-bold tabular-nums text-ink-900">{formatMoney(revenu, currency)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatMoney(depense, currency)}</td>
                              <td className={`px-4 py-2 text-right font-bold tabular-nums ${revenu - depense < 0 ? "text-orange-700" : "text-slate-900"}`}>{formatMoney(revenu - depense, currency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-slate-300 p-5">
            <h4 className="mb-4 text-base font-bold text-slate-900">{t("manager.fiscal.charts.categoryBreakdown")}</h4>
            {repartition.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-600">{t("manager.fiscal.charts.noCategoryData")}</p>
            ) : (
              <ul className="space-y-4">
                {repartition.map(({ categorie, parDevise, part }) => (
                  <li key={categorie}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        <span className="size-2.5 shrink-0" style={{ backgroundColor: categoryDotColors[categorie as ExpenseCategory] ?? "#8ca0aa" }} />
                        {categoryLabels[categorie as ExpenseCategory] ?? categorie}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-slate-900">{formatByCurrency(parDevise, formatMoney)}</span>
                    </div>
                    {part !== null && (
                      <div className="mt-1.5 flex items-center gap-2" aria-hidden="true">
                        <div className="h-1.5 flex-1 bg-slate-200">
                          <div className="h-full" style={{ width: `${part}%`, backgroundColor: categoryDotColors[categorie as ExpenseCategory] ?? "#8ca0aa" }} />
                        </div>
                        <span className="w-9 text-right font-mono text-[10px] text-slate-600">{part} %</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SectionReglage>

      {/* 03 — Par bien. */}
      <SectionReglage id="par-bien" numero="03" titre={t("manager.fiscal.sections.perProperty")}>
        <div className="mb-3 flex items-center gap-2">
          <Landmark size={16} className="text-ink-900" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-bold text-slate-900">{t("manager.fiscal.bilanParBien.title")}</h4>
            <p className="text-xs text-slate-600">{t("manager.fiscal.bilanParBien.subtitle")}</p>
          </div>
        </div>
        {/* Zone défilante : focalisable au clavier pour qu'on puisse la faire défiler sans souris. */}
        <div className="relative overflow-x-auto border border-slate-300" tabIndex={0} role="region" aria-label={t("manager.fiscal.bilanParBien.title")}>
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.property")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.currency")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.revenue")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.expense")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.net")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {synthesis.bilanParBien.map((row) => (
                <tr key={`${row.propertyId}-${row.currency}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900"><NomDuBien titre={row.propertyTitle} id={row.propertyId} /></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.currency}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-ink-900">{formatMoney(row.revenue, row.currency)}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-orange-800">{formatDeduction(row.expense, row.currency, formatMoney)}</td>
                  <td className={`px-4 py-3 font-bold tabular-nums ${row.net >= 0 ? "text-ink-900" : "text-orange-700"}`}>{formatMoney(row.net, row.currency)}</td>
                </tr>
              ))}
              {synthesis.bilanParBien.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-slate-600">
                    {t("manager.fiscal.bilanParBien.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionReglage>

      {/* 04 — Les exports pour le comptable, avec ce que contient chacun. */}
      <SectionReglage id="exports" numero="04" titre={t("manager.fiscal.exports.title")}>
        <ul className="grid grid-cols-1 gap-px border border-slate-300 bg-slate-300 lg:grid-cols-3">
          <li className="flex flex-col justify-between gap-3 bg-white p-4">
            <p className="text-xs text-slate-700">{t("manager.fiscal.exports.grandLivre")}</p>
            <Bulle texte={t("manager.tips.fiscalGrandLivre")}>
              <button onClick={downloadGrandLivre} disabled={downloading} className={BOUTON_PLEIN}>
                <BookText size={13} aria-hidden="true" /> {downloading ? t("manager.fiscal.downloadingGrandLivre") : t("manager.fiscal.downloadGrandLivre")}
              </button>
            </Bulle>
          </li>
          <li className="flex flex-col justify-between gap-3 bg-white p-4">
            <p className="text-xs text-slate-700">{t("manager.fiscal.exports.fec")}</p>
            <Bulle texte={t("manager.tips.fiscalFEC")}>
              <button onClick={downloadFEC} disabled={downloadingFEC} className={BOUTON_TRAIT}>
                <FileSpreadsheet size={13} aria-hidden="true" /> {downloadingFEC ? t("manager.fiscal.downloadingFEC") : t("manager.fiscal.downloadFEC")}
              </button>
            </Bulle>
          </li>
          <li className="flex flex-col justify-between gap-3 bg-white p-4">
            <p className="text-xs text-slate-700">{t("manager.fiscal.exports.syscohada")}</p>
            <Bulle texte={t("manager.tips.fiscalSyscohada")}>
              <button onClick={downloadSyscohada} disabled={downloadingSyscohada} className={BOUTON_TRAIT}>
                <Scale size={13} aria-hidden="true" /> {downloadingSyscohada ? t("manager.fiscal.downloadingSyscohada") : t("manager.fiscal.downloadSyscohada")}
              </button>
            </Bulle>
          </li>
        </ul>
      </SectionReglage>
    </div>
  );
}
