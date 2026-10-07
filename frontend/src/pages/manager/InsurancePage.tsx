import { ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import Pagination from "../../components/Pagination";
import { useCurrency } from "../../context/currency";
import type { InsurancePolicy, PaginatedResponse, Property } from "../../types";
import Bulle from "../../components/Bulle";

const PAGE_SIZE = 20;
// Pour le filtre "par bien" : on ne le pagine pas comme la liste principale,
// on demande juste large (même convention que ExpensesPage).
const DROPDOWN_PAGE_SIZE = 100;

// Même seuil que le rappel serveur par défaut (INSURANCE_REMINDER_DAYS) :
// l'interface doit signaler visuellement une échéance avant que l'email ne
// parte, pas seulement après.
const JOURS_ALERTE_ECHEANCE = 30;

function joursAvantEcheance(expiryDate: string): number {
  const aujourdhui = new Date();
  const aMinuit = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((aMinuit(new Date(expiryDate)).getTime() - aMinuit(aujourdhui).getTime()) / 86_400_000);
}

export default function InsurancePage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const emptyForm = {
    propertyId: "",
    insurerName: "",
    policyNumber: "",
    premiumAmount: "",
    startDate: "",
    expiryDate: "",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(
    (signal?: AbortSignal) => {
      Promise.all([
        api.get<PaginatedResponse<Property>>("/properties", { params: { pageSize: DROPDOWN_PAGE_SIZE }, signal }),
        api.get<PaginatedResponse<InsurancePolicy>>("/insurance-policies", {
          params: { page, pageSize: PAGE_SIZE, ...(selectedPropertyId ? { propertyId: selectedPropertyId } : {}) },
          signal,
        }),
      ])
        .then(([propertiesRes, policiesRes]) => {
          setProperties(liste<Property>(propertiesRes.data, "items"));
          setPolicies(liste<InsurancePolicy>(policiesRes.data, "items"));
          setTotal(policiesRes.data.total);
          setTotalPages(policiesRes.data.totalPages);
          setLoadError(null);
        })
        .catch((err) => {
          if (isRequestCancelled(err)) return;
          setLoadError(apiErrorMessage(err));
        });
    },
    [page, selectedPropertyId]
  );

  // AbortController : même raison que ExpensesPage/MessagesPage — changer vite
  // de filtre par bien ne doit pas afficher une réponse arrivée en retard.
  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  function handlePropertyFilterChange(value: string) {
    setSelectedPropertyId(value);
    setPage(1);
  }

  function openCreateModal() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  }

  function openEditModal(policy: InsurancePolicy) {
    setEditingId(policy.id);
    setForm({
      propertyId: policy.propertyId,
      insurerName: policy.insurerName,
      policyNumber: policy.policyNumber,
      premiumAmount: policy.premiumAmount != null ? String(policy.premiumAmount) : "",
      startDate: policy.startDate ? policy.startDate.split("T")[0] : "",
      expiryDate: policy.expiryDate.split("T")[0],
      notes: policy.notes || "",
    });
    setError(null);
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        premiumAmount: form.premiumAmount ? Number(form.premiumAmount) : undefined,
        startDate: form.startDate || undefined,
      };
      if (editingId) {
        await api.put(`/insurance-policies/${editingId}`, payload);
      } else {
        await api.post("/insurance-policies", payload);
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditingId(null);
      loadData();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(policy: InsurancePolicy) {
    if (!confirm(t("manager.insurance.confirmDelete", { insurer: policy.insurerName }))) return;
    try {
      await api.delete(`/insurance-policies/${policy.id}`);
      loadData();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  function echeanceBadge(policy: InsurancePolicy) {
    const jours = joursAvantEcheance(policy.expiryDate);
    if (jours < 0) {
      return (
        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300">
          {t("manager.insurance.expired")}
        </span>
      );
    }
    if (jours <= JOURS_ALERTE_ECHEANCE) {
      return (
        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300">
          {t("manager.insurance.expiringSoon", { count: jours })}
        </span>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.insurance.title")}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t("manager.insurance.subtitle")}</p>
        </div>
        <Bulle texte={t("manager.tips.insuranceCreate")}>
          <button
            onClick={openCreateModal}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-sm transition-colors"
          >
            {t("manager.insurance.addPolicy")}
          </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={() => loadData()} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <label htmlFor="insurance-property-filter" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t("manager.insurance.filterByProperty")}
          </label>
          <select
            id="insurance-property-filter"
            value={selectedPropertyId}
            onChange={(e) => handlePropertyFilterChange(e.target.value)}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">{t("manager.insurance.allProperties")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t("manager.insurance.policyLines", { count: total })}</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.insurance.table.property")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.insurance.table.insurer")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.insurance.table.policyNumber")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.insurance.table.premium")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.insurance.table.expiryDate")}</th>
              <th className="px-4 py-3 font-medium text-right">{t("manager.insurance.table.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {policies.map((policy) => (
              <tr key={policy.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{policy.property?.title}</td>
                <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{policy.insurerName}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{policy.policyNumber}</td>
                <td className="px-4 py-3 text-slate-800 dark:text-slate-200">
                  {policy.premiumAmount != null ? formatMoney(policy.premiumAmount, policy.currency) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    {new Date(policy.expiryDate).toLocaleDateString(i18n.language)}
                    {echeanceBadge(policy)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => openEditModal(policy)}
                    className="text-xs text-brand-600 dark:text-brand-400 hover:underline mr-3"
                  >
                    {t("common.actions.edit")}
                  </button>
                  <button
                    onClick={() => handleDelete(policy)}
                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:underline"
                  >
                    {t("common.actions.delete")}
                  </button>
                </td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-600 dark:text-slate-400 py-8 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <ShieldAlert size={14} aria-hidden="true" />
                    {t("manager.insurance.noPolicies")}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">
                {editingId ? t("manager.insurance.editModalTitle") : t("manager.insurance.createModalTitle")}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                aria-label={t("common.actions.close")}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="insurance-modal-property" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("manager.insurance.fields.property")}
                </label>
                <select
                  id="insurance-modal-property"
                  required
                  value={form.propertyId}
                  onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="">{t("manager.insurance.fields.selectProperty")}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.address})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="insurance-modal-insurer" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("manager.insurance.fields.insurerName")}
                  </label>
                  <input
                    id="insurance-modal-insurer"
                    required
                    value={form.insurerName}
                    onChange={(e) => setForm({ ...form, insurerName: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="insurance-modal-policy-number" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("manager.insurance.fields.policyNumber")}
                  </label>
                  <input
                    id="insurance-modal-policy-number"
                    required
                    value={form.policyNumber}
                    onChange={(e) => setForm({ ...form, policyNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="insurance-modal-premium" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("manager.insurance.fields.premiumAmount")}
                  </label>
                  <input
                    id="insurance-modal-premium"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={form.premiumAmount}
                    onChange={(e) => setForm({ ...form, premiumAmount: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="insurance-modal-start" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("manager.insurance.fields.startDate")}
                  </label>
                  <input
                    id="insurance-modal-start"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="insurance-modal-expiry" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("manager.insurance.fields.expiryDate")}
                </label>
                <input
                  id="insurance-modal-expiry"
                  type="date"
                  required
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="insurance-modal-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("manager.insurance.fields.notes")}
                </label>
                <textarea
                  id="insurance-modal-notes"
                  rows={2}
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
                  className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-2"
                >
                  {t("common.actions.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm"
                >
                  {saving ? t("common.actions.saving") : t("manager.insurance.savePolicy")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
