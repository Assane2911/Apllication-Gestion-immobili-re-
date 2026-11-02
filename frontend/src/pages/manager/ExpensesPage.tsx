import { BarChart3, Download, Repeat, X } from "lucide-react";
import { csvEscape, csvMontant, CSV_BOM } from "../../utils/csv";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import Pagination from "../../components/Pagination";
import SectionReglage from "../../components/SectionReglage";
import { useCurrency } from "../../context/currency";
import type { Expense, ExpenseCategory, ExpenseRecurrence, PaginatedResponse, Property } from "../../types";
import { devisesPresentes, formatByCurrency, formatDeduction } from "../../utils/currencyFormat";
import Bulle from "../../components/Bulle";
import Dialogue from "../../components/Dialogue";
import { formaterJour } from "../../utils/jourCivil";
import { NomDuBien } from "../../components/PlanLogement";
import ChampDate from "../../components/ChampDate";
import { correspond } from "../../utils/recherche";
import { partDesDepenses, repartitionParCategorie } from "../../utils/syntheseFinances";

const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:opacity-60";
const CHAMP_COMPACT = "border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900";

function currentYearRange() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Vert seulement si le résultat net est positif ou nul dans TOUTES les devises. */
function netCashFlowAllPositive(byCurrency: Record<string, number>): boolean {
  return Object.values(byCurrency).every((amount) => amount >= 0);
}

const PAGE_SIZE = 20;
// Pour le filtre "par bien" : on ne le pagine pas comme la liste principale,
// on demande juste large.
const DROPDOWN_PAGE_SIZE = 100;

const categoryColors: Record<ExpenseCategory, string> = {
  MAINTENANCE: "border-orange-700 bg-orange-50 text-orange-900",
  TAX: "border-ink-900 bg-ink-900 text-white",
  INSURANCE: "border-ink-900 bg-white text-ink-900",
  SYNDIC: "border-slate-400 bg-slate-100 text-ink-900",
  OTHER: "border-slate-300 bg-white text-slate-700",
};

interface FinancialSummary {
  // Groupés par devise (pas une somme unique) : un gestionnaire peut avoir
  // des biens réglés dans des devises différentes (voir formatByCurrency).
  totalRevenueByCurrency: Record<string, number>;
  totalExpensesByCurrency: Record<string, number>;
  netCashFlowByCurrency: Record<string, number>;
  expensesByCategory: Record<string, Record<string, number>>;
  expenseCount: number;
  paidInvoiceCount: number;
}

export default function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reportRange, setReportRange] = useState(currentYearRange());
  const [exportingReport, setExportingReport] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [recherche, setRecherche] = useState("");
  const [categorieFiltre, setCategorieFiltre] = useState<"all" | ExpenseCategory>("all");

  const categoryLabels: Record<ExpenseCategory, string> = {
    MAINTENANCE: t("manager.expenses.categories.MAINTENANCE"),
    TAX: t("manager.expenses.categories.TAX"),
    INSURANCE: t("manager.expenses.categories.INSURANCE"),
    SYNDIC: t("manager.expenses.categories.SYNDIC"),
    OTHER: t("manager.expenses.categories.OTHER"),
  };

  const emptyForm = {
    propertyId: "",
    category: "MAINTENANCE" as ExpenseCategory,
    title: "",
    amount: "",
    expenseDate: new Date().toISOString().split("T")[0],
    notes: "",
    recurrence: "" as "" | ExpenseRecurrence,
    recurrenceEndDate: "",
  };
  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(
    (signal?: AbortSignal) => {
      Promise.all([
        api.get<PaginatedResponse<Property>>("/properties", { params: { pageSize: DROPDOWN_PAGE_SIZE }, signal }),
        api.get<FinancialSummary>("/expenses/summary", { signal }),
        api.get<PaginatedResponse<Expense>>("/expenses", {
          params: { page, pageSize: PAGE_SIZE, ...(selectedPropertyId ? { propertyId: selectedPropertyId } : {}) },
          signal,
        }),
      ])
        .then(([propertiesRes, summaryRes, expensesRes]) => {
          setProperties(liste<Property>(propertiesRes.data, "items"));
          setSummary(summaryRes.data);
          setExpenses(liste<Expense>(expensesRes.data, "items"));
          setTotal(expensesRes.data.total);
          setTotalPages(expensesRes.data.totalPages);
          setLoadError(null);
        })
        .catch((err) => {
          if (isRequestCancelled(err)) return;
          setLoadError(apiErrorMessage(err));
        });
    },
    [page, selectedPropertyId]
  );

  // Sans AbortController, changer vite de filtre par bien pouvait afficher les
  // dépenses d'un mauvais bien si une réponse arrivait après une autre plus
  // récente — même schéma que MessagesPage.tsx / ActivityLogPage.tsx.
  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  function handlePropertyFilterChange(value: string) {
    setSelectedPropertyId(value);
    setPage(1);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    // Le champ number seul ne bloque pas la saisie d'un montant négatif (le
    // "-" reste tapable, et coller une valeur contourne le spinner). Le
    // serveur refuse déjà ces montants (createExpenseSchema, amount positif),
    // mais laisser filer la requête affichait une erreur générique après un
    // aller-retour réseau au lieu de guider tout de suite le gestionnaire.
    if (!(Number(form.amount) > 0)) {
      setError(t("manager.expenses.amountMustBePositive"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/expenses", {
        ...form,
        amount: Number(form.amount),
        recurrence: form.recurrence || undefined,
        recurrenceEndDate: form.recurrence && form.recurrenceEndDate ? form.recurrenceEndDate : undefined,
      });
      setShowModal(false);
      setForm(emptyForm);
      loadData();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(exp: Expense) {
    if (!confirm(t("manager.expenses.confirmDelete", { title: exp.title, amount: formatMoney(exp.amount, exp.currency) }))) return;
    try {
      await api.delete(`/expenses/${exp.id}`);
      loadData();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  /**
   * Export comptable de TOUTES les dépenses du filtre courant.
   *
   * Il sérialisait `expenses`, c'est-à-dire la page affichée. Le gestionnaire
   * lisait « 147 lignes de dépense » juste au-dessus du bouton, cliquait, et
   * obtenait un fichier de vingt lignes — sans le moindre avertissement — qu'il
   * transmettait à son comptable. On va donc chercher les pages suivantes
   * avant de construire le fichier.
   */
  async function exportCSV() {
    if (expenses.length === 0) {
      alert(t("manager.expenses.noExpensesToExport"));
      return;
    }

    setExportingCsv(true);
    let toutes: Expense[] = [];
    try {
      // Le serveur plafonne une page à 100 lignes (MAX_PAGE_SIZE) : demander
      // « tout d'un coup » ne marcherait pas, on pagine donc explicitement.
      const TAILLE = 100;
      const MAX_PAGES = 50; // 5 000 lignes : au-delà, l'export serveur est le bon outil.
      for (let p = 1; p <= MAX_PAGES; p += 1) {
        const res = await api.get<PaginatedResponse<Expense>>("/expenses", {
          params: { page: p, pageSize: TAILLE, ...(selectedPropertyId ? { propertyId: selectedPropertyId } : {}) },
        });
        toutes = toutes.concat(liste<Expense>(res.data, "items"));
        if (toutes.length >= res.data.total || res.data.items.length === 0) break;
      }
    } catch (err) {
      alert(apiErrorMessage(err));
      setExportingCsv(false);
      return;
    } finally {
      setExportingCsv(false);
    }

    const headers = [
      t("manager.expenses.csvHeaders.date"),
      t("manager.expenses.csvHeaders.property"),
      t("manager.expenses.csvHeaders.category"),
      t("manager.expenses.csvHeaders.title"),
      t("manager.expenses.csvHeaders.amount"),
      t("manager.expenses.csvHeaders.currency"),
      t("manager.expenses.csvHeaders.notes"),
    ];
    const rows = toutes.map((e) => [
      formaterJour(e.expenseDate, i18n.language),
      csvEscape(e.property?.title || ""),
      csvEscape(categoryLabels[e.category] || e.category),
      csvEscape(e.title),
      csvMontant(e.amount),
      e.currency,
      csvEscape(e.notes || ""),
    ]);

    const csvContent = CSV_BOM + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `depenses-immobiliers-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Rapport financier complet (revenus + dépenses + résultat net par bien),
   * généré côté serveur sur la période sélectionnée. Téléchargé via blob (et
   * non un lien direct) car l'authentification passe par un header Bearer,
   * pas par un cookie — un lien classique n'enverrait pas le token.
   */
  async function exportFinancialReport() {
    setExportingReport(true);
    try {
      const res = await api.get("/expenses/export", {
        params: { from: reportRange.from || undefined, to: reportRange.to || undefined },
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rapport-financier-${reportRange.from || "debut"}-a-${reportRange.to || "aujourdhui"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setExportingReport(false);
    }
  }

  // Les trois tuiles décrivent la même période et les mêmes biens : elles
  // doivent parler les mêmes monnaies, y compris celles dont le montant se
  // trouve être nul. Sans cela, « 0 » s'affichait dans la devise d'affichage
  // du gestionnaire à côté de totaux libellés dans celle des factures.
  const devisesDeLEcran = summary
    ? devisesPresentes(summary.totalRevenueByCurrency, summary.totalExpensesByCurrency, summary.netCashFlowByCurrency)
    : [];

  const partDepenses = summary ? partDesDepenses(summary.totalRevenueByCurrency, summary.totalExpensesByCurrency) : null;
  const repartition = summary ? repartitionParCategorie(summary.expensesByCategory ?? {}) : [];
  const visibles = expenses.filter(
    (e) => (categorieFiltre === "all" || e.category === categorieFiltre) && correspond(recherche, e.title, e.notes, e.property?.title, categoryLabels[e.category])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.expenses.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.expenses.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Bulle texte={t("manager.tips.expenseExportCsv")}>
            <button onClick={exportCSV} disabled={exportingCsv} className={BOUTON_TRAIT}>
              <Download size={13} aria-hidden="true" /> {exportingCsv ? t("manager.expenses.exportingCsv") : t("manager.expenses.exportCsv")}
            </button>
          </Bulle>
          <Bulle texte={t("manager.tips.expenseCreate")}>
            <button onClick={() => setShowModal(true)} className={BOUTON_PLEIN}>
              {t("manager.expenses.addExpense")}
            </button>
          </Bulle>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => loadData()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {summary && (
        <>
          <BandeauChiffres
            etiquette={t("manager.expenses.summary.label")}
            cases={[
              {
                libelle: t("manager.expenses.stats.revenueCollected"),
                valeur: formatByCurrency(summary.totalRevenueByCurrency, formatMoney, devisesDeLEcran),
                aide: t("manager.expenses.stats.revenueHint", { count: summary.paidInvoiceCount }),
              },
              {
                libelle: t("manager.expenses.stats.totalExpenses"),
                valeur: formatByCurrency(summary.totalExpensesByCurrency, formatMoney, devisesDeLEcran),
                aide: t("manager.expenses.stats.expensesHint", { count: summary.expenseCount }),
              },
              {
                libelle: t("manager.expenses.stats.netCashFlow"),
                valeur: formatByCurrency(summary.netCashFlowByCurrency, formatMoney, devisesDeLEcran),
                aide: netCashFlowAllPositive(summary.netCashFlowByCurrency) ? t("manager.expenses.stats.netCashFlowPositive") : t("manager.expenses.stats.netCashFlowNegative"),
                ton: netCashFlowAllPositive(summary.netCashFlowByCurrency) ? "normal" : "alerte",
              },
              {
                libelle: t("manager.expenses.summary.share"),
                valeur: partDepenses === null ? "—" : `${partDepenses} %`,
                aide: t("manager.expenses.summary.shareHint"),
              },
            ]}
          />

          {repartition.length > 0 && (
            <SectionReglage id="repartition" numero="01" titre={t("manager.expenses.breakdown.title")}>
              <ul className="space-y-3">
                {repartition.map((ligne) => (
                  <li key={ligne.categorie}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-800">{categoryLabels[ligne.categorie as ExpenseCategory] ?? ligne.categorie}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{formatByCurrency(ligne.parDevise, formatMoney)}</span>
                    </div>
                    {ligne.part !== null && (
                      <div className="mt-1.5 flex items-center gap-2" aria-hidden="true">
                        <div className="h-1.5 flex-1 bg-slate-200">
                          <div className="h-full bg-ink-900" style={{ width: `${ligne.part}%` }} />
                        </div>
                        <span className="w-9 text-right font-mono text-[10px] text-slate-600">{ligne.part} %</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </SectionReglage>
          )}
        </>
      )}

      <BarreListe
        idPrefixe="depenses"
        recherche={recherche}
        onRecherche={setRecherche}
        placeholderRecherche={t("manager.expenses.search")}
        libelleFiltres={t("manager.expenses.filtersLabel")}
        filtres={[
          { cle: "all", libelle: t("manager.liste.all"), compte: expenses.length },
          ...(["MAINTENANCE", "TAX", "INSURANCE", "SYNDIC", "OTHER"] as const).map((c) => ({ cle: c, libelle: t(`manager.expenses.categoriesShort.${c}`), compte: expenses.filter((e) => e.category === c).length })),
        ]}
        filtreActif={categorieFiltre}
        onFiltre={(cle) => setCategorieFiltre(cle as "all" | ExpenseCategory)}
      >
        <div className="flex items-center gap-2">
          <label htmlFor="expense-property-filter" className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.expenses.filterByProperty")}</label>
          <select id="expense-property-filter" value={selectedPropertyId} onChange={(e) => handlePropertyFilterChange(e.target.value)} className={CHAMP_COMPACT}>
            <option value="">{t("manager.expenses.allProperties")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </BarreListe>
      <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">{t("manager.expenses.expenseLines", { count: total })}</p>

      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">{t("manager.expenses.fullReportLabel")}</span>
          <ChampDate
            aria-label={t("manager.expenses.fields.reportDateFrom")}
            value={reportRange.from}
            onChange={(e) => setReportRange({ ...reportRange, from: e.target.value })}
            className={CHAMP_COMPACT}
          />
          <span className="text-xs text-slate-600">{t("manager.expenses.to")}</span>
          <ChampDate
            aria-label={t("manager.expenses.fields.reportDateTo")}
            value={reportRange.to}
            onChange={(e) => setReportRange({ ...reportRange, to: e.target.value })}
            className={CHAMP_COMPACT}
          />
        </div>
        <Bulle texte={t("manager.tips.expenseReport")}>
        <button
          onClick={exportFinancialReport}
          disabled={exportingReport}
          className={`${BOUTON_PLEIN} flex items-center gap-1.5`}
        >
          <BarChart3 size={13} aria-hidden="true" /> {exportingReport ? t("manager.expenses.generatingReport") : t("manager.expenses.generateReport")}
        </button>
        </Bulle>
      </div>

      {/* Vide, le tableau ne contient plus rien que le clavier atteigne : le cadre défilant le devient (voir structureEtCibles). */}
      <div
        {...(visibles.length === 0 ? { role: "region", tabIndex: 0, "aria-label": t("manager.expenses.title") } : {})}
        className="relative overflow-x-auto border border-slate-300 bg-white focus-visible:ring-2 focus-visible:ring-ink-900"
      >
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("manager.expenses.table.date")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.expenses.table.property")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.expenses.table.category")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.expenses.table.title")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.expenses.table.amount")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.expenses.table.notes")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("manager.expenses.table.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibles.map((exp) => (
              <tr key={exp.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap tabular-nums">
                  {formaterJour(exp.expenseDate, i18n.language)}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900"><NomDuBien titre={exp.property?.title} id={exp.property?.id} /></td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${
                      categoryColors[exp.category] || "border-slate-400 bg-slate-50 text-slate-700"
                    }`}
                  >
                    {categoryLabels[exp.category] || exp.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-800">
                  <span className="inline-flex items-center gap-1.5">
                    {exp.title}
                    {(exp.recurrence || exp.templateId) && (
                      <Bulle texte={exp.recurrence ? t("manager.expenses.recurrenceModelHint") : t("manager.expenses.recurrenceOccurrenceHint")}>
                        <Repeat size={12} className="shrink-0 text-ink-900" aria-hidden="true" />
                      </Bulle>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap text-orange-800">{formatDeduction(exp.amount, exp.currency, formatMoney)}</td>
                <td className="px-4 py-3 text-slate-600 text-xs truncate max-w-xs">{exp.notes || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <Bulle texte={t("manager.tips.expenseDelete")}>
                  <button
                    onClick={() => handleDelete(exp)}
                    className="text-xs font-semibold text-rose-700 border-b border-rose-700/40 hover:border-rose-700 transition-colors cursor-pointer"
                  >
                    {t("common.actions.delete")}
                  </button>
                  </Bulle>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-600 py-8 text-sm">
                  {expenses.length > 0 ? t("manager.liste.noResult") : t("manager.expenses.noExpenses")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <Dialogue onClose={() => setShowModal(false)} titreId="expense-modal-title" fermable={!saving} className="w-full max-w-lg border border-ink-900 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 id="expense-modal-title" className="font-bold text-slate-900 text-lg">{t("manager.expenses.modalTitle")}</h3>
              <button
                onClick={() => setShowModal(false)}
                className="cursor-pointer text-slate-600 hover:text-ink-900"
                aria-label={t("common.actions.close")}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="expense-modal-property" className={LIBELLE}>{t("manager.expenses.fields.property")}</label>
                <select
                  id="expense-modal-property"
                  required
                  value={form.propertyId}
                  onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                  className={CHAMP}
                >
                  <option value="">{t("manager.expenses.fields.selectProperty")}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.address})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="expense-modal-category" className={LIBELLE}>{t("manager.expenses.fields.category")}</label>
                  <select
                    id="expense-modal-category"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}
                    className={CHAMP}
                  >
                    <option value="MAINTENANCE">{t("manager.expenses.categoriesShort.MAINTENANCE")}</option>
                    <option value="TAX">{t("manager.expenses.categoriesShort.TAX")}</option>
                    <option value="INSURANCE">{t("manager.expenses.categoriesShort.INSURANCE")}</option>
                    <option value="SYNDIC">{t("manager.expenses.categoriesShort.SYNDIC")}</option>
                    <option value="OTHER">{t("manager.expenses.categoriesShort.OTHER")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="expense-modal-date" className={LIBELLE}>{t("manager.expenses.fields.invoiceDate")}</label>
                  <ChampDate
                    id="expense-modal-date"
                    required
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                    className={CHAMP}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor="expense-modal-title" className={LIBELLE}>{t("manager.expenses.fields.titleSupplier")}</label>
                  <input
                    id="expense-modal-title"
                    required
                    placeholder={t("manager.expenses.fields.titlePlaceholder")}
                    maxLength={200}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className={CHAMP}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor="expense-modal-amount" className={LIBELLE}>{t("manager.expenses.fields.amount")}</label>
                  <input
                    id="expense-modal-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1000000000000"
                    required
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className={`${CHAMP} font-semibold`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="expense-modal-notes" className={LIBELLE}>{t("manager.expenses.fields.notes")}</label>
                <textarea
                  id="expense-modal-notes"
                  rows={2}
                  placeholder={t("manager.expenses.fields.notesPlaceholder")}
                  maxLength={5000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={CHAMP}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="expense-modal-recurrence" className={LIBELLE}>
                    {t("manager.expenses.fields.recurrence")}
                  </label>
                  <Bulle texte={t("manager.tips.expenseRecurrence")}>
                  <select
                    id="expense-modal-recurrence"
                    value={form.recurrence}
                    onChange={(e) => setForm({ ...form, recurrence: e.target.value as "" | ExpenseRecurrence })}
                    className={CHAMP}
                  >
                    <option value="">{t("manager.expenses.fields.recurrenceNone")}</option>
                    <option value="MONTHLY">{t("manager.expenses.fields.recurrenceMonthly")}</option>
                    <option value="ANNUAL">{t("manager.expenses.fields.recurrenceAnnual")}</option>
                  </select>
                  </Bulle>
                </div>
                {form.recurrence && (
                  <div>
                    <label htmlFor="expense-modal-recurrence-end" className={LIBELLE}>
                      {t("manager.expenses.fields.recurrenceEndDate")}
                    </label>
                    <ChampDate
                      id="expense-modal-recurrence-end"
                      value={form.recurrenceEndDate}
                      onChange={(e) => setForm({ ...form, recurrenceEndDate: e.target.value })}
                      className={CHAMP}
                    />
                  </div>
                )}
              </div>

              {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="cursor-pointer px-3 py-2 text-xs text-slate-600 hover:text-ink-900"
                >
                  {t("common.actions.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={BOUTON_PLEIN}
                >
                  {saving ? t("common.actions.saving") : t("manager.expenses.saveExpense")}
                </button>
              </div>
            </form>
          </Dialogue>
        </div>
      )}
    </div>
  );
}
