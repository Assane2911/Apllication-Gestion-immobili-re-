import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/CurrencyContext";
import type { Expense, ExpenseCategory, Property } from "../../types";

function currentYearRange() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const categoryColors: Record<ExpenseCategory, string> = {
  MAINTENANCE: "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300",
  TAX: "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300",
  INSURANCE: "bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300",
  SYNDIC: "bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300",
  OTHER: "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-300",
};

interface FinancialSummary {
  totalRevenue: number;
  totalExpenses: number;
  netCashFlow: number;
  expensesByCategory: Record<string, number>;
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
  const [reportRange, setReportRange] = useState(currentYearRange());
  const [exportingReport, setExportingReport] = useState(false);

  const categoryLabels: Record<ExpenseCategory, string> = {
    MAINTENANCE: t("manager.expenses.categories.MAINTENANCE"),
    TAX: t("manager.expenses.categories.TAX"),
    INSURANCE: t("manager.expenses.categories.INSURANCE"),
    SYNDIC: t("manager.expenses.categories.SYNDIC"),
    OTHER: t("manager.expenses.categories.OTHER"),
  };

  const [form, setForm] = useState({
    propertyId: "",
    category: "MAINTENANCE" as ExpenseCategory,
    title: "",
    amount: "",
    expenseDate: new Date().toISOString().split("T")[0],
    notes: "",
  });

  function loadData() {
    api.get<Property[]>("/properties").then((res) => setProperties(res.data));
    api.get<FinancialSummary>("/expenses/summary").then((res) => setSummary(res.data));
    api
      .get<Expense[]>("/expenses", {
        params: selectedPropertyId ? { propertyId: selectedPropertyId } : {},
      })
      .then((res) => setExpenses(res.data));
  }

  useEffect(() => {
    loadData();
  }, [selectedPropertyId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/expenses", {
        ...form,
        amount: Number(form.amount),
      });
      setShowModal(false);
      setForm({
        propertyId: "",
        category: "MAINTENANCE",
        title: "",
        amount: "",
        expenseDate: new Date().toISOString().split("T")[0],
        notes: "",
      });
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

  function exportCSV() {
    if (expenses.length === 0) {
      alert(t("manager.expenses.noExpensesToExport"));
      return;
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
    const rows = expenses.map((e) => [
      new Date(e.expenseDate).toLocaleDateString(i18n.language),
      `"${e.property?.title || ""}"`,
      `"${categoryLabels[e.category] || e.category}"`,
      `"${e.title.replace(/"/g, '""')}"`,
      e.amount,
      e.currency,
      `"${(e.notes || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "﻿" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.expenses.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t("manager.expenses.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <span>📥</span> {t("manager.expenses.exportCsv")}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-sm transition-colors"
          >
            {t("manager.expenses.addExpense")}
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label={t("manager.expenses.stats.revenueCollected")}
            value={formatMoney(summary.totalRevenue)}
            hint={t("manager.expenses.stats.revenueHint", { count: summary.paidInvoiceCount })}
            accent="green"
          />
          <StatCard
            label={t("manager.expenses.stats.totalExpenses")}
            value={formatMoney(summary.totalExpenses)}
            hint={t("manager.expenses.stats.expensesHint", { count: summary.expenseCount })}
            accent="red"
          />
          <StatCard
            label={t("manager.expenses.stats.netCashFlow")}
            value={formatMoney(summary.netCashFlow)}
            hint={summary.netCashFlow >= 0 ? t("manager.expenses.stats.netCashFlowPositive") : t("manager.expenses.stats.netCashFlowNegative")}
            accent={summary.netCashFlow >= 0 ? "green" : "red"}
          />
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("manager.expenses.filterByProperty")}</label>
          <select
            value={selectedPropertyId}
            onChange={(e) => setSelectedPropertyId(e.target.value)}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">{t("manager.expenses.allProperties")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("manager.expenses.expenseLines", { count: expenses.length })}</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("manager.expenses.fullReportLabel")}</label>
          <input
            type="date"
            value={reportRange.from}
            onChange={(e) => setReportRange({ ...reportRange, from: e.target.value })}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">{t("manager.expenses.to")}</span>
          <input
            type="date"
            value={reportRange.to}
            onChange={(e) => setReportRange({ ...reportRange, to: e.target.value })}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={exportFinancialReport}
          disabled={exportingReport}
          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
        >
          <span>📊</span> {exportingReport ? t("manager.expenses.generatingReport") : t("manager.expenses.generateReport")}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.expenses.table.date")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.expenses.table.property")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.expenses.table.category")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.expenses.table.title")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.expenses.table.amount")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.expenses.table.notes")}</th>
              <th className="px-4 py-3 font-medium text-right">{t("manager.expenses.table.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {expenses.map((exp) => (
              <tr key={exp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">
                  {new Date(exp.expenseDate).toLocaleDateString(i18n.language)}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{exp.property?.title}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                      categoryColors[exp.category] || "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {categoryLabels[exp.category] || exp.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{exp.title}</td>
                <td className="px-4 py-3 font-bold text-red-600 dark:text-red-400">-{formatMoney(exp.amount, exp.currency)}</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs truncate max-w-xs">{exp.notes || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(exp)}
                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:underline"
                  >
                    {t("common.actions.delete")}
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">
                  {t("manager.expenses.noExpenses")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">{t("manager.expenses.modalTitle")}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("manager.expenses.fields.property")}</label>
                <select
                  required
                  value={form.propertyId}
                  onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
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
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("manager.expenses.fields.category")}</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  >
                    <option value="MAINTENANCE">{t("manager.expenses.categoriesShort.MAINTENANCE")}</option>
                    <option value="TAX">{t("manager.expenses.categoriesShort.TAX")}</option>
                    <option value="INSURANCE">{t("manager.expenses.categoriesShort.INSURANCE")}</option>
                    <option value="SYNDIC">{t("manager.expenses.categoriesShort.SYNDIC")}</option>
                    <option value="OTHER">{t("manager.expenses.categoriesShort.OTHER")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("manager.expenses.fields.invoiceDate")}</label>
                  <input
                    type="date"
                    required
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("manager.expenses.fields.titleSupplier")}</label>
                  <input
                    required
                    placeholder={t("manager.expenses.fields.titlePlaceholder")}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("manager.expenses.fields.amount")}</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("manager.expenses.fields.notes")}</label>
                <textarea
                  rows={2}
                  placeholder={t("manager.expenses.fields.notesPlaceholder")}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                />
              </div>

              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-2"
                >
                  {t("common.actions.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm"
                >
                  {saving ? t("common.actions.saving") : t("manager.expenses.saveExpense")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
