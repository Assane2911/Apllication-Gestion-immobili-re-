import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/CurrencyContext";
import type { Expense, ExpenseCategory, Property } from "../../types";

function currentYearRange() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const categoryLabels: Record<ExpenseCategory, { label: string; color: string }> = {
  MAINTENANCE: { label: "🛠️ Entretien & Travaux", color: "bg-amber-100 text-amber-800" },
  TAX: { label: "🏛️ Taxe Foncière", color: "bg-red-100 text-red-800" },
  INSURANCE: { label: "🛡️ Assurance PNO", color: "bg-blue-100 text-blue-800" },
  SYNDIC: { label: "🏢 Copropriété / Syndic", color: "bg-purple-100 text-purple-800" },
  OTHER: { label: "📦 Autre Charge", color: "bg-slate-100 text-slate-800" },
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
    if (!confirm(`Supprimer la dépense "${exp.title}" (${formatMoney(exp.amount, exp.currency)}) ?`)) return;
    try {
      await api.delete(`/expenses/${exp.id}`);
      loadData();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  function exportCSV() {
    if (expenses.length === 0) {
      alert("Aucune dépense à exporter.");
      return;
    }

    const headers = ["Date", "Bien", "Catégorie", "Intitulé", "Montant", "Devise", "Notes"];
    const rows = expenses.map((e) => [
      new Date(e.expenseDate).toLocaleDateString("fr-FR"),
      `"${e.property?.title || ""}"`,
      `"${categoryLabels[e.category]?.label || e.category}"`,
      `"${e.title.replace(/"/g, '""')}"`,
      e.amount,
      e.currency,
      `"${(e.notes || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `depenses-immobiliers-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Rapport financier complet (revenus + d\u00E9penses + r\u00E9sultat net par bien),
   * g\u00E9n\u00E9r\u00E9 c\u00F4t\u00E9 serveur sur la p\u00E9riode s\u00E9lectionn\u00E9e. T\u00E9l\u00E9charg\u00E9 via blob (et
   * non un lien direct) car l'authentification passe par un header Bearer,
   * pas par un cookie \u2014 un lien classique n'enverrait pas le token.
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
          <h2 className="text-2xl font-semibold text-slate-900">Dépenses & Rentabilité Réelle</h2>
          <p className="text-sm text-slate-500 mt-1">
            Suivi des charges, factures de travaux et calcul automatique du Cash-Flow net
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3.5 py-2.5 rounded-lg border border-slate-300 flex items-center gap-1.5 transition-colors"
          >
            <span>📥</span> Export Comptable CSV
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-sm transition-colors"
          >
            + Enregistrer une dépense
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Loyers Encaissés"
            value={formatMoney(summary.totalRevenue)}
            hint={`${summary.paidInvoiceCount} quittance(s) réglée(s)`}
            accent="green"
          />
          <StatCard
            label="Total Dépenses & Travaux"
            value={formatMoney(summary.totalExpenses)}
            hint={`${summary.expenseCount} facture(s) enregistrée(s)`}
            accent="red"
          />
          <StatCard
            label="Cash-Flow Net Réel"
            value={formatMoney(summary.netCashFlow)}
            hint={summary.netCashFlow >= 0 ? "Bénéfice net positif" : "Déficit temporaire"}
            accent={summary.netCashFlow >= 0 ? "green" : "red"}
          />
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-700">Filtrer par bien :</label>
          <select
            value={selectedPropertyId}
            onChange={(e) => setSelectedPropertyId(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Tous les biens immobiliers</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">{expenses.length} ligne(s) de dépense</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold text-slate-700">Rapport financier complet (revenus + dépenses) du</label>
          <input
            type="date"
            value={reportRange.from}
            onChange={(e) => setReportRange({ ...reportRange, from: e.target.value })}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-xs text-slate-500">au</span>
          <input
            type="date"
            value={reportRange.to}
            onChange={(e) => setReportRange({ ...reportRange, to: e.target.value })}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={exportFinancialReport}
          disabled={exportingReport}
          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
        >
          <span>📊</span> {exportingReport ? "Génération..." : "Générer le rapport (CSV)"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Bien</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium">Intitulé</th>
              <th className="px-4 py-3 font-medium">Montant</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.map((exp) => (
              <tr key={exp.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 text-slate-600 text-xs">
                  {new Date(exp.expenseDate).toLocaleDateString("fr-FR")}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">{exp.property?.title}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                      categoryLabels[exp.category]?.color || "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {categoryLabels[exp.category]?.label || exp.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-800">{exp.title}</td>
                <td className="px-4 py-3 font-bold text-red-600">-{formatMoney(exp.amount, exp.currency)}</td>
                <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-xs">{exp.notes || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(exp)}
                    className="text-xs text-red-600 hover:text-red-800 hover:underline"
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-8 text-sm">
                  Aucune dépense enregistrée pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">Enregistrer une dépense / facture</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Bien concerné *</label>
                <select
                  required
                  value={form.propertyId}
                  onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sélectionner un bien immobilier</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.address})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Catégorie *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="MAINTENANCE">🛠️ Entretien & Travaux</option>
                    <option value="TAX">🏛️ Taxe Foncière</option>
                    <option value="INSURANCE">🛡️ Assurance PNO</option>
                    <option value="SYNDIC">🏢 Copropriété / Syndic</option>
                    <option value="OTHER">📦 Autre charge</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date de la facture</label>
                  <input
                    type="date"
                    required
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Intitulé / Fournisseur *</label>
                  <input
                    required
                    placeholder="Ex: Remplacement chauffe-eau"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Montant TTC *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Détails complémentaires</label>
                <textarea
                  rows={2}
                  placeholder="Artisan plombier, devis n°..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm"
                >
                  {saving ? "Enregistrement..." : "Enregistrer la dépense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
