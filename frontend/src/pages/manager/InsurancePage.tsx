import { ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import Pagination from "../../components/Pagination";
import { useCurrency } from "../../context/currency";
import type { InsurancePolicy, PaginatedResponse, Property } from "../../types";
import Bulle from "../../components/Bulle";
import Dialogue from "../../components/Dialogue";
import { ecartEnJours, formaterJour } from "../../utils/jourCivil";
import { NomDuBien } from "../../components/PlanLogement";
import ChampDate from "../../components/ChampDate";
import { formatByCurrency } from "../../utils/currencyFormat";
import { correspond } from "../../utils/recherche";
import { etatPolice, JOURS_ALERTE_ECHEANCE, syntheseAssurances, type EtatPolice } from "../../utils/syntheseFinances";

const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const CHAMP_COMPACT = "border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900";
type Filtre = "all" | EtatPolice;

const PAGE_SIZE = 20;
// Pour le filtre "par bien" : on ne le pagine pas comme la liste principale,
// on demande juste large (même convention que ExpensesPage).
const DROPDOWN_PAGE_SIZE = 100;

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
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("all");

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

  /** Filet à gauche de la ligne : orange plein pour une police échue, encre quand l'échéance approche. */
  function barreEcheance(policy: InsurancePolicy) {
    const etat = etatPolice(policy.expiryDate);
    if (etat === "expired") return "shadow-[inset_3px_0_0_var(--color-orange-700)]";
    if (etat === "soon") return "shadow-[inset_3px_0_0_var(--color-ink-900)]";
    return "";
  }

  function echeanceBadge(policy: InsurancePolicy) {
    const etat = etatPolice(policy.expiryDate);
    if (etat === "expired") {
      return (
        <span className="inline-block whitespace-nowrap border border-orange-700 bg-orange-700 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
          {t("manager.insurance.expired")}
        </span>
      );
    }
    if (etat === "soon") {
      return (
        <span className="inline-block whitespace-nowrap border border-orange-300 bg-orange-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-900">
          {t("manager.insurance.expiringSoon", { count: ecartEnJours(policy.expiryDate) })}
        </span>
      );
    }
    return null;
  }

  const synthese = syntheseAssurances(policies);
  const visibles = policies.filter(
    (p) => (filtre === "all" || etatPolice(p.expiryDate) === filtre) && correspond(recherche, p.insurerName, p.policyNumber, p.property?.title)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.insurance.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.insurance.subtitle")}</p>
        </div>
        <Bulle texte={t("manager.tips.insuranceCreate")}>
          <button onClick={openCreateModal} className={BOUTON_PLEIN}>
            {t("manager.insurance.addPolicy")}
          </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => loadData()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {policies.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.insurance.summary.label")}
          cases={[
            { libelle: t("manager.insurance.summary.total"), valeur: synthese.total, aide: t("manager.insurance.summary.totalHint") },
            {
              libelle: t("manager.insurance.summary.expired"),
              valeur: synthese.echues,
              aide: t("manager.insurance.summary.expiredHint"),
              ton: synthese.echues > 0 ? "alerte" : "normal",
            },
            {
              libelle: t("manager.insurance.summary.soon"),
              valeur: synthese.bientot,
              aide: t("manager.insurance.summary.soonHint", { days: JOURS_ALERTE_ECHEANCE }),
              ton: synthese.bientot > 0 ? "alerte" : "normal",
            },
            {
              libelle: t("manager.insurance.summary.premiums"),
              valeur: synthese.primes.length > 0 ? formatByCurrency(Object.fromEntries(synthese.primes.map((p) => [p.currency, p.total])), formatMoney) : "—",
              aide: t("manager.insurance.summary.premiumsHint"),
            },
          ]}
        />
      )}

      <BarreListe
        idPrefixe="assurances"
        recherche={recherche}
        onRecherche={setRecherche}
        placeholderRecherche={t("manager.insurance.search")}
        libelleFiltres={t("manager.insurance.filtersLabel")}
        filtres={[
          { cle: "all", libelle: t("manager.liste.all"), compte: policies.length },
          { cle: "expired", libelle: t("manager.insurance.filters.expired"), compte: synthese.echues },
          { cle: "soon", libelle: t("manager.insurance.filters.soon"), compte: synthese.bientot },
          { cle: "valid", libelle: t("manager.insurance.filters.valid"), compte: synthese.total - synthese.echues - synthese.bientot },
        ]}
        filtreActif={filtre}
        onFiltre={(cle) => setFiltre(cle as Filtre)}
      >
        <div className="flex items-center gap-2">
          <label htmlFor="insurance-property-filter" className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            {t("manager.insurance.filterByProperty")}
          </label>
          <select id="insurance-property-filter" value={selectedPropertyId} onChange={(e) => handlePropertyFilterChange(e.target.value)} className={CHAMP_COMPACT}>
            <option value="">{t("manager.insurance.allProperties")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </BarreListe>
      <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">{t("manager.insurance.policyLines", { count: total })}</p>

      {/* Vide, le tableau ne contient plus rien que le clavier atteigne : le cadre défilant le devient (voir structureEtCibles). */}
      <div
        {...(visibles.length === 0 ? { role: "region", tabIndex: 0, "aria-label": t("manager.insurance.title") } : {})}
        className="relative overflow-x-auto border border-slate-300 bg-white focus-visible:ring-2 focus-visible:ring-ink-900"
      >
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("manager.insurance.table.property")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.insurance.table.insurer")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.insurance.table.policyNumber")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.insurance.table.premium")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.insurance.table.expiryDate")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("manager.insurance.table.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibles.map((policy) => (
              <tr key={policy.id} className="hover:bg-slate-50">
                <td className={`px-4 py-3 font-medium text-slate-900 ${barreEcheance(policy)}`}><NomDuBien titre={policy.property?.title} id={policy.property?.id} /></td>
                <td className="px-4 py-3 text-slate-800">{policy.insurerName}</td>
                <td className="px-4 py-3 text-slate-700 font-mono text-xs whitespace-nowrap">{policy.policyNumber}</td>
                <td className="px-4 py-3 text-slate-800 tabular-nums whitespace-nowrap">
                  {policy.premiumAmount != null ? formatMoney(policy.premiumAmount, policy.currency) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600 text-xs tabular-nums">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {formaterJour(policy.expiryDate, i18n.language)}
                    {echeanceBadge(policy)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => openEditModal(policy)}
                    className="mr-4 text-xs font-semibold text-ink-900 border-b border-ink-900/40 hover:border-orange-700 hover:text-orange-700 transition-colors cursor-pointer"
                  >
                    {t("common.actions.edit")}
                  </button>
                  <button
                    onClick={() => handleDelete(policy)}
                    className="text-xs font-semibold text-rose-700 border-b border-rose-700/40 hover:border-rose-700 transition-colors cursor-pointer"
                  >
                    {t("common.actions.delete")}
                  </button>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-600 py-8 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <ShieldAlert size={14} aria-hidden="true" />
                    {policies.length > 0 ? t("manager.liste.noResult") : t("manager.insurance.noPolicies")}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <Dialogue onClose={() => setShowModal(false)} titreId="insurance-modal-title" fermable={!saving} className="w-full max-w-lg border border-ink-900 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 id="insurance-modal-title" className="font-bold text-slate-900 text-lg">
                {editingId ? t("manager.insurance.editModalTitle") : t("manager.insurance.createModalTitle")}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="cursor-pointer text-slate-600 hover:text-ink-900"
                aria-label={t("common.actions.close")}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="insurance-modal-property" className={LIBELLE}>
                  {t("manager.insurance.fields.property")}
                </label>
                <select
                  id="insurance-modal-property"
                  required
                  value={form.propertyId}
                  onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                  className={CHAMP}
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
                  <label htmlFor="insurance-modal-insurer" className={LIBELLE}>
                    {t("manager.insurance.fields.insurerName")}
                  </label>
                  <input
                    id="insurance-modal-insurer"
                    required
                    maxLength={200}
                    value={form.insurerName}
                    onChange={(e) => setForm({ ...form, insurerName: e.target.value })}
                    className={CHAMP}
                  />
                </div>
                <div>
                  <label htmlFor="insurance-modal-policy-number" className={LIBELLE}>
                    {t("manager.insurance.fields.policyNumber")}
                  </label>
                  <input
                    id="insurance-modal-policy-number"
                    required
                    maxLength={100}
                    value={form.policyNumber}
                    onChange={(e) => setForm({ ...form, policyNumber: e.target.value })}
                    className={CHAMP}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="insurance-modal-premium" className={LIBELLE}>
                    {t("manager.insurance.fields.premiumAmount")}
                  </label>
                  <input
                    id="insurance-modal-premium"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1000000000000"
                    placeholder="0.00"
                    value={form.premiumAmount}
                    onChange={(e) => setForm({ ...form, premiumAmount: e.target.value })}
                    className={CHAMP}
                  />
                </div>
                <div>
                  <label htmlFor="insurance-modal-start" className={LIBELLE}>
                    {t("manager.insurance.fields.startDate")}
                  </label>
                  <ChampDate
                    id="insurance-modal-start"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className={CHAMP}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="insurance-modal-expiry" className={LIBELLE}>
                  {t("manager.insurance.fields.expiryDate")}
                </label>
                <ChampDate
                  id="insurance-modal-expiry"
                  required
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  className={CHAMP}
                />
              </div>

              <div>
                <label htmlFor="insurance-modal-notes" className={LIBELLE}>
                  {t("manager.insurance.fields.notes")}
                </label>
                <textarea
                  id="insurance-modal-notes"
                  rows={2}
                  maxLength={5000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={CHAMP}
                />
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
                  {saving ? t("common.actions.saving") : t("manager.insurance.savePolicy")}
                </button>
              </div>
            </form>
          </Dialogue>
        </div>
      )}
    </div>
  );
}
