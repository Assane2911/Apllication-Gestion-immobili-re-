import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Camera, CheckCircle2, Clock, Download, FileCheck, Hourglass, PenLine, RefreshCw } from "lucide-react";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, isRequestCancelled, liste } from "../../api/client";
import Badge from "../../components/Badge";
import DepositRefundModal from "../../components/DepositRefundModal";
import DocumentModal from "../../components/DocumentModal";
import Pagination from "../../components/Pagination";
import PaymentDayModal, { JOURS_ECHEANCE } from "../../components/PaymentDayModal";
import CotenantsModal from "../../components/CotenantsModal";
import GuarantorsModal from "../../components/GuarantorsModal";
import { CLAUSE_CAUTION, clauseCautionIncomplete, insererClause } from "../../data/clauseCaution";
import RentRevisionModal from "../../components/RentRevisionModal";
import ScannedContractModal from "../../components/ScannedContractModal";
import SignatureModal from "../../components/SignatureModal";
import { useCurrency } from "../../context/currency";
import type { Contract, ContractStatus, PaginatedResponse, Property, Tenant } from "../../types";
import Bulle from "../../components/Bulle";

/** Bail actif dont la date anniversaire approche sans révision prévue (GET /contracts/revisions-due). */
interface BailAReviser {
  contractId: string;
  propertyTitle: string;
  tenantName: string;
  rent: number;
  currency: string;
  endDate: string;
  anniversaire: string;
  dateSuggeree: string;
}

/** Ce dont la fenêtre de révision a besoin, qu'on l'ouvre depuis la liste ou depuis le rappel. */
interface BailRevisable {
  id: string;
  rent: number;
  currency?: string;
  endDate: string;
  dateSuggeree?: string;
}

// Jour d'échéance proposé à la création : le 5, ce que disaient déjà les documents remis aux locataires.
const emptyForm = { propertyId: "", tenantId: "", rent: "", deposit: "", startDate: "", endDate: "", terms: "", paymentDay: "5", leaseType: "HABITATION", applicableLaw: "" };
type FormulaireContrat = typeof emptyForm;

/** Valeurs du formulaire pour un contrat existant (dates en AAAA-MM-JJ, telles que le serveur les a enregistrées). */
export function formulaireDepuisContrat(c: Contract): FormulaireContrat {
  return {
    propertyId: c.propertyId,
    tenantId: c.tenantId,
    rent: String(c.rent),
    deposit: String(c.deposit),
    startDate: c.startDate.slice(0, 10),
    endDate: c.endDate.slice(0, 10),
    terms: c.terms ?? "",
    paymentDay: c.paymentDay ? String(c.paymentDay) : "",
    leaseType: c.leaseType ?? "HABITATION",
    applicableLaw: c.applicableLaw ?? "",
  };
}

/**
 * Seuls les champs réellement modifiés partent au serveur : ses garde-fous (factures émises, dépôt
 * restitué) ne se déclenchent ainsi que sur un vrai changement, pas sur un champ renvoyé à l'identique.
 */
export function changementsDuContrat(avant: FormulaireContrat, apres: FormulaireContrat): Record<string, unknown> {
  const corps: Record<string, unknown> = {};
  for (const cle of Object.keys(apres) as Array<keyof FormulaireContrat>) {
    if (apres[cle] === avant[cle]) continue;
    const v = apres[cle];
    if (cle === "rent" || cle === "deposit") corps[cle] = Number(v);
    else if (cle === "paymentDay") corps[cle] = v ? Number(v) : null;
    else if (cle === "terms" || cle === "applicableLaw") corps[cle] = v.trim();
    else corps[cle] = v;
  }
  return corps;
}

// Fenêtre d'affichage du workflow de renouvellement : un contrat actif dont
// la fin tombe dans ce nombre de jours ou moins propose de renouveler ou non.
const RENEWAL_WINDOW_DAYS = 14;
const PAGE_SIZE = 20;
// Pour les listes déroulantes (bien/locataire) du formulaire de création : on
// ne les paginé pas comme la liste principale, on demande juste large.
const DROPDOWN_PAGE_SIZE = 100;

function formatDate(d: string, locale: string) {
  return new Date(d).toLocaleDateString(locale);
}

function daysUntil(d: string) {
  const diffMs = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function depositRefundedAmount(c: Contract): number {
  const total = (c.depositDeductions ?? []).reduce((somme, d) => somme + d.amount, 0);
  return Math.max(0, c.deposit - total);
}

/** Jour d'échéance effectif d'un contrat, comme le serveur le calcule (jour de la date de début, en UTC, à défaut de réglage). */
function jourEcheance(c: Contract): number {
  return c.paymentDay ?? (new Date(c.startDate).getUTCDate() || 1);
}

export default function ContractsPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [depositRefundContract, setDepositRefundContract] = useState<Contract | null>(null);
  const [editingPaymentDay, setEditingPaymentDay] = useState<Contract | null>(null);
  const [revisingRent, setRevisingRent] = useState<BailRevisable | null>(null);
  const [bauxAReviser, setBauxAReviser] = useState<BailAReviser[]>([]);
  const [viewingAvenant, setViewingAvenant] = useState<string | null>(null);
  const [guarantorsContract, setGuarantorsContract] = useState<Contract | null>(null);
  const [cotenantsContract, setCotenantsContract] = useState<Contract | null>(null);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [viewingLeaseContract, setViewingLeaseContract] = useState<Contract | null>(null);
  const [viewingScannedContract, setViewingScannedContract] = useState<{ title: string; url: string } | null>(null);
  const [uploadingScanContractId, setUploadingScanContractId] = useState<string | null>(null);
  const [targetScanContract, setTargetScanContract] = useState<Contract | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  function load(signal?: AbortSignal) {
    Promise.all([
      api.get<PaginatedResponse<Contract>>("/contracts", { params: { page, pageSize: PAGE_SIZE }, signal }),
      api.get<PaginatedResponse<Property>>("/properties", { params: { pageSize: DROPDOWN_PAGE_SIZE }, signal }),
      api.get<PaginatedResponse<Tenant>>("/tenants", { params: { pageSize: DROPDOWN_PAGE_SIZE }, signal }),
    ])
      .then(([contractsRes, propertiesRes, tenantsRes]) => {
        setContracts(liste<Contract>(contractsRes.data, "items"));
        setTotal(contractsRes.data.total);
        setTotalPages(contractsRes.data.totalPages);
        setProperties(liste<Property>(propertiesRes.data, "items"));
        setTenants(liste<Tenant>(tenantsRes.data, "items"));
        setLoadError(null);
        // Rappel des révisions : chargé APRÈS la liste, et jamais bloquant — une erreur ici n'empêche pas d'utiliser la page.
        return api
          .get<BailAReviser[]>("/contracts/revisions-due", { signal })
          .then((res) => setBauxAReviser(liste<BailAReviser>(res.data)))
          .catch((err) => {
            if (!isRequestCancelled(err)) setBauxAReviser([]);
          });
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [page]);

  /** Jour d'échéance du loyer, avec le moyen de le modifier tant que le locataire n'a pas signé le bail. */
  /** Lien « Modifier » : tant que le locataire n'a pas signé, tout le contrat se modifie ici. */
  function modifierLien(c: Contract) {
    if (c.signedByTenantAt) return null;
    return (
      <button type="button" onClick={() => ouvrirModification(c)} className="mt-1 block text-[11px] text-brand-600 dark:text-brand-400 font-semibold hover:underline">
        {t("manager.contracts.edit")}
      </button>
    );
  }

  /** Lien « Colocataires (n) » : ouvre la gestion des colocataires du bail. */
  function colocatairesLien(c: Contract) {
    return (
      <button type="button" onClick={() => setCotenantsContract(c)} className="mt-1 block text-[11px] text-brand-600 dark:text-brand-400 font-semibold hover:underline">
        {t("manager.contracts.cotenantsLink", { count: c.cotenantNames?.length ?? 0 })}
      </button>
    );
  }

  /** Lien « Garants (n) » : ouvre la gestion des garants du bail (consultation seule une fois signé). */
  function garantsLien(c: Contract) {
    return (
      <button type="button" onClick={() => setGuarantorsContract(c)} className="mt-1 block text-[11px] text-brand-600 dark:text-brand-400 font-semibold hover:underline">
        {t("manager.contracts.guarantorsLink", { count: c.guarantorsCount ?? 0 })}
      </button>
    );
  }

  /** Lien « Réviser » sous le loyer d'un bail actif. */
  function revisionLien(c: Contract) {
    if (c.status !== "ACTIVE") return null;
    return (
      <button type="button" onClick={() => setRevisingRent({ id: c.id, rent: c.rent, currency: c.currency, endDate: c.endDate })} className="mt-1 block text-[11px] text-brand-600 dark:text-brand-400 font-semibold hover:underline">
        {t("manager.contracts.reviseRent")}
      </button>
    );
  }

  function echeanceLigne(c: Contract) {
    const jour = jourEcheance(c);
    return (
      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
        {c.paymentDay === 31 ? t("manager.contracts.paymentDayRowLast") : t("manager.contracts.paymentDayRow", { day: jour })}
        {!c.signedByTenantAt && (
          <button type="button" onClick={() => setEditingPaymentDay(c)} className="text-brand-600 dark:text-brand-400 font-semibold hover:underline">
            {t("manager.contracts.editPaymentDay")}
          </button>
        )}
      </span>
    );
  }

  function ouvrirModification(c: Contract) {
    setEditingContract(c);
    setForm(formulaireDepuisContrat(c));
    setError(null);
    setShowForm(true);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function fermerFormulaire() {
    setShowForm(false);
    setEditingContract(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Le modèle de caution contient des passages à compléter : ils ne doivent jamais partir tels quels sur un bail.
    if (clauseCautionIncomplete(form.terms)) {
      setError(t("manager.contracts.clauseIncomplete"));
      return;
    }
    setSaving(true);
    try {
      if (editingContract) {
        const corps = changementsDuContrat(formulaireDepuisContrat(editingContract), form);
        if (Object.keys(corps).length > 0) await api.put(`/contracts/${editingContract.id}`, corps);
        fermerFormulaire();
        load();
        return;
      }
      // Les clauses vides ne sont pas envoyées : le bail n'imprime alors aucune section.
      const { terms, paymentDay, applicableLaw, ...champs } = form;
      await api.post("/contracts", {
        ...champs,
        ...(terms.trim() ? { terms: terms.trim() } : {}),
        // Vide : le jour de la date de début du bail (comportement d'avant).
        ...(paymentDay ? { paymentDay: Number(paymentDay) } : {}),
        // Vide : aucune mention de droit applicable n'est imprimée sur le bail.
        ...(applicableLaw.trim() ? { applicableLaw: applicableLaw.trim() } : {}),
      });
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(c: Contract, status: ContractStatus) {
    try {
      await api.put(`/contracts/${c.id}`, { status });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleTerminate(c: Contract) {
    if (!confirm(t("manager.contracts.confirmTerminate"))) return;
    await changeStatus(c, "TERMINATED");
  }

  async function handleDelete(c: Contract) {
    if (!confirm(t("manager.contracts.confirmDelete"))) return;
    try {
      await api.delete(`/contracts/${c.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleCancelDepositRefund(c: Contract) {
    if (!confirm(t("manager.contracts.confirmCancelDepositRefund"))) return;
    try {
      await api.put(`/contracts/${c.id}/deposit-refund`, { deductions: null });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleRenew(c: Contract) {
    if (
      !confirm(
        t("manager.contracts.confirmRenew", {
          date: formatDate(String(new Date(new Date(c.endDate).getTime() + 86400000)), i18n.language),
        })
      )
    ) {
      return;
    }
    try {
      await api.post(`/contracts/${c.id}/renew`, { months: 12 });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  function triggerScanUpload(contract: Contract) {
    setTargetScanContract(contract);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleScanFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !targetScanContract) return;

    setUploadingScanContractId(targetScanContract.id);
    const formData = new FormData();
    formData.append("scan", file);

    try {
      await api.post(`/contracts/${targetScanContract.id}/scan`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: DELAI_UPLOAD_MS,
      });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setUploadingScanContractId(null);
      setTargetScanContract(null);
    }
  }

  async function handleViewScannedContract(c: Contract) {
    if (c.scannedContractUrl) {
      setViewingScannedContract({
        title: t("manager.contracts.leaseDocTitle", { property: c.property?.title }),
        url: c.scannedContractUrl,
      });
      return;
    }

    try {
      const res = await api.get<{ url: string }>(`/documents/lease-scan/${c.id}`);
      setViewingScannedContract({
        title: t("manager.contracts.leaseDocTitle", { property: c.property?.title }),
        url: res.data.url,
      });
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  // En modification, le bien du contrat reste proposé même s'il est occupé (par ce contrat).
  const availableProperties = properties.filter((p) => p.status !== "OCCUPIED" || p.id === editingContract?.propertyId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.contracts.title")}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t("manager.contracts.count", { count: contracts.length })}</p>
        </div>
        <Bulle texte={t("manager.tips.contractCreate")}>
        <button onClick={() => { setEditingContract(null); setForm(emptyForm); setShowForm(true); }} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-brand-600/20 transition-all">
          {t("manager.contracts.addBtn")}
        </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={() => load()} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {bauxAReviser.length > 0 && (
        <section aria-labelledby="baux-a-reviser" className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3">
          <h3 id="baux-a-reviser" className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {t("manager.contracts.revisionsDue.title", { count: bauxAReviser.length })}
          </h3>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">{t("manager.contracts.revisionsDue.hint")}</p>
          <ul className="mt-2 divide-y divide-amber-200/70 dark:divide-amber-500/20">
            {bauxAReviser.map((b) => (
              <li key={b.contractId} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  <span className="font-medium">{b.propertyTitle}</span> — {b.tenantName}
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    {t("manager.contracts.revisionsDue.anniversary", {
                      date: new Date(b.anniversaire).toLocaleDateString(i18n.language, { timeZone: "UTC" }),
                      rent: formatMoney(b.rent, b.currency),
                    })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setRevisingRent({ id: b.contractId, rent: b.rent, currency: b.currency, endDate: b.endDate, dateSuggeree: b.dateSuggeree })}
                  className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded-lg"
                >
                  {t("manager.contracts.revisionsDue.action")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-1">{editingContract ? t("manager.contracts.editTitle") : t("manager.contracts.formTitle")}</h3>
          {editingContract && <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">{t("manager.contracts.editHint")}</p>}
          {!editingContract && <div className="mb-3" />}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contract-property" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.property")}</label>
              <select id="contract-property" required value={form.propertyId} onChange={(e) => {
                const prop = properties.find((p) => p.id === e.target.value);
                // En modification, choisir un autre bien ne réécrit pas le loyer ni le dépôt déjà convenus.
                if (editingContract) setForm({ ...form, propertyId: e.target.value });
                else setForm({ ...form, propertyId: e.target.value, rent: prop ? String(prop.rent) : form.rent, deposit: prop ? String(prop.rent * 2) : form.deposit });
              }} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{t("manager.contracts.fields.selectProperty")}</option>
                {availableProperties.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-tenant" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.tenant")}</label>
              <select id="contract-tenant" required value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{t("manager.contracts.fields.selectTenant")}</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.firstName} {tenant.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-rent" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.rent")}</label>
              <input id="contract-rent" required type="number" step="0.01" value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contract-deposit" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.deposit")}</label>
              <input id="contract-deposit" required type="number" step="0.01" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contract-startDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.startDate")}</label>
              <input id="contract-startDate" required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contract-endDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.endDate")}</label>
              <input id="contract-endDate" required type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contract-paymentDay" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.paymentDay")}</label>
              <select id="contract-paymentDay" value={form.paymentDay} onChange={(e) => setForm({ ...form, paymentDay: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{t("manager.contracts.fields.paymentDayStart")}</option>
                {JOURS_ECHEANCE.map((jour) => (
                  <option key={jour} value={jour}>
                    {jour === 31 ? t("manager.contracts.fields.paymentDayLast") : t("manager.contracts.fields.paymentDayOption", { day: jour })}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("manager.contracts.fields.paymentDayHint")}</p>
            </div>
            <div>
              <label htmlFor="contract-leaseType" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.leaseType")}</label>
              <select id="contract-leaseType" value={form.leaseType} onChange={(e) => setForm({ ...form, leaseType: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                {(["HABITATION", "MEUBLE", "COMMERCIAL", "PROFESSIONNEL"] as const).map((type) => (
                  <option key={type} value={type}>{t(`manager.contracts.fields.leaseTypes.${type}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-applicableLaw" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.applicableLaw")}</label>
              <input id="contract-applicableLaw" type="text" maxLength={300} value={form.applicableLaw} onChange={(e) => setForm({ ...form, applicableLaw: e.target.value })} placeholder={t("manager.contracts.fields.applicableLawPlaceholder")} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("manager.contracts.fields.applicableLawHint")}</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="contract-terms" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.contracts.fields.terms")}</label>
              <textarea
                id="contract-terms"
                rows={form.terms.length > 300 ? 14 : 4}
                maxLength={10000}
                value={form.terms}
                onChange={(e) => setForm({ ...form, terms: e.target.value })}
                placeholder={t("manager.contracts.fields.termsPlaceholder")}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("manager.contracts.fields.termsHint")}</p>
              <button
                type="button"
                onClick={() => setForm({ ...form, terms: insererClause(form.terms, CLAUSE_CAUTION) })}
                aria-describedby="contract-terms-caution-hint"
                className="mt-2 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:underline"
              >
                {t("manager.contracts.fields.insertGuarantee")}
              </button>
              <p id="contract-terms-caution-hint" className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("manager.contracts.fields.insertGuaranteeHint")}</p>
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? t("common.actions.saving") : editingContract ? t("manager.contracts.saveChanges") : t("manager.contracts.create")}
              </button>
              <button type="button" onClick={fermerFormulaire} className="text-sm text-slate-600 dark:text-slate-400 px-4 py-2">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Vue tableau (écrans sm et plus) */}
      <div className="hidden sm:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("manager.contracts.table.property")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.contracts.table.tenant")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.contracts.table.rent")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.contracts.table.duration")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.contracts.table.signatures")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.contracts.table.status")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("manager.contracts.table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {contracts.map((c) => {
              const daysLeft = daysUntil(c.endDate);
              const showRenewal = c.status === "ACTIVE" && daysLeft <= RENEWAL_WINDOW_DAYS;
              return (
              <tr key={c.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 ${showRenewal ? "bg-amber-50/50 dark:bg-amber-500/10" : ""}`}>
                <td className="px-4 py-3 text-slate-900 dark:text-slate-100 font-medium">{c.property?.title}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {c.tenant?.firstName} {c.tenant?.lastName}
                  {(c.cotenantNames ?? []).length > 0 && <span className="block text-[11px]">+ {c.cotenantNames!.join(", ")}</span>}
                </td>
                <td className="px-4 py-3 text-slate-900 dark:text-slate-100 font-semibold">
                  {formatMoney(c.rent, c.currency)}
                  {revisionLien(c)}
                  {garantsLien(c)}
                  {colocatairesLien(c)}
                  {modifierLien(c)}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">
                  {formatDate(c.startDate, i18n.language)} → {formatDate(c.endDate, i18n.language)}
                  {c.status === "ACTIVE" && echeanceLigne(c)}
                  {showRenewal && (
                    <span className="block mt-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                      <Clock size={12} className="inline shrink-0 -mt-0.5" aria-hidden="true" />{" "}
                      {daysLeft <= 0 ? t("manager.contracts.overdue") : t("manager.contracts.endsInDays", { count: daysLeft })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-600 dark:text-slate-400">{t("manager.contracts.agency")}</span>
                    {c.signedByManagerAt ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 size={13} aria-hidden="true" /> {t("manager.contracts.signed")}
                      </span>
                    ) : (
                      <Bulle texte={t("manager.tips.contractSign")}>
                      <button
                        onClick={() => setSigningContract(c)}
                        className="text-brand-600 dark:text-brand-400 font-semibold hover:underline inline-flex items-center gap-1"
                      >
                        <PenLine size={13} aria-hidden="true" /> {t("manager.contracts.sign")}
                      </button>
                      </Bulle>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-600 dark:text-slate-400">{t("manager.contracts.tenantLabel")}</span>
                    {c.signedByTenantAt ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 size={13} aria-hidden="true" /> {t("manager.contracts.signed")}
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                        <Hourglass size={12} aria-hidden="true" /> {t("manager.contracts.pendingSignature")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3"><Badge status={c.status} /></td>
                {/* Les actions passent à la ligne : sur une seule ligne, six boutons élargissaient le tableau au-delà de
                    l'écran et « Résilier » / « Supprimer » restaient hors de vue, sans indice de défilement. */}
                <td className="px-4 py-3 text-right max-w-[19rem]">
                  <div className="flex flex-wrap justify-end gap-2">
                  <Bulle texte={t("manager.tips.contractViewLease")}>
                  <button
                    onClick={() => setViewingLeaseContract(c)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1"
                  >
                    <Download size={12} aria-hidden="true" /> {t("manager.contracts.leasePdf")}
                  </button>
                  </Bulle>

                  {/* Boutons Scan Papier */}
                  {c.scannedContractUrl ? (
                    <Bulle texte={t("manager.tips.contractViewScan")}>
                    <button
                      onClick={() => handleViewScannedContract(c)}
                      className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 dark:text-emerald-400 font-semibold px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1 border border-emerald-200/80 dark:border-emerald-500/20"
                    >
                      <FileCheck size={13} />
                      <span>{t("manager.contracts.scanContractShort")}</span>
                    </button>
                    </Bulle>
                  ) : null}

                  <Bulle texte={t("manager.tips.contractScan")}>
                  <button
                    onClick={() => triggerScanUpload(c)}
                    disabled={uploadingScanContractId === c.id}
                    className="text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1 border border-brand-200/80 dark:border-brand-500/20 disabled:opacity-50"
                  >
                    <Camera size={13} />
                    <span>
                      {uploadingScanContractId === c.id
                        ? t("manager.contracts.uploadingScan")
                        : c.scannedContractUrl
                        ? "Remplacer scan"
                        : t("manager.contracts.scanContractShort")}
                    </span>
                  </button>
                  </Bulle>

                  {showRenewal && (
                    <>
                      <Bulle texte={t("manager.tips.contractRenew")}>
                      <button
                        onClick={() => handleRenew(c)}
                        className="text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-medium px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1"
                      >
                        <RefreshCw size={12} aria-hidden="true" /> {t("manager.contracts.renew")}
                      </button>
                      </Bulle>
                      <Bulle texte={t("manager.tips.contractEnd")}>
                      <button onClick={() => changeStatus(c, "ENDED")} className="text-slate-600 dark:text-slate-400 hover:underline text-xs">
                        {t("manager.contracts.doNotRenew")}
                      </button>
                      </Bulle>
                    </>
                  )}
                  {c.status === "ACTIVE" && (
                    <Bulle texte={t("manager.tips.contractTerminate")}>
                    <button onClick={() => handleTerminate(c)} className="text-amber-700 dark:text-amber-400 hover:underline text-xs">
                      {t("manager.contracts.terminate")}
                    </button>
                    </Bulle>
                  )}
                  {c.status !== "ACTIVE" && (
                    c.depositRefundedAt ? (
                      <Bulle texte={t("manager.tips.contractCancelDepositRefund")}>
                      <button
                        onClick={() => handleCancelDepositRefund(c)}
                        className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 dark:text-emerald-400 font-semibold px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1 border border-emerald-200/80 dark:border-emerald-500/20"
                      >
                        <Banknote size={13} aria-hidden="true" />
                        <span>{t("manager.contracts.depositRefunded", { amount: formatMoney(depositRefundedAmount(c), c.currency) })}</span>
                      </button>
                      </Bulle>
                    ) : (
                      <Bulle texte={t("manager.tips.contractDepositRefund")}>
                      <button
                        onClick={() => setDepositRefundContract(c)}
                        className="text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1 border border-brand-200/80 dark:border-brand-500/20"
                      >
                        <Banknote size={13} aria-hidden="true" />
                        <span>{t("manager.contracts.depositRefund")}</span>
                      </button>
                      </Bulle>
                    )
                  )}
                  <Bulle texte={t("manager.tips.contractDelete")}>
                  <button onClick={() => handleDelete(c)} className="text-red-600 dark:text-red-400 hover:underline text-xs">
                    {t("common.actions.delete")}
                  </button>
                  </Bulle>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Vue cartes empilées (mobile, < sm) */}
      <div className="sm:hidden space-y-3">
        {contracts.map((c) => {
          const daysLeft = daysUntil(c.endDate);
          const showRenewal = c.status === "ACTIVE" && daysLeft <= RENEWAL_WINDOW_DAYS;
          return (
            <div
              key={c.id}
              className={`bg-white dark:bg-slate-900 rounded-xl border shadow-sm p-4 space-y-2.5 ${
                showRenewal ? "border-amber-300 dark:border-amber-500/40 bg-amber-50/50 dark:bg-amber-500/10" : "border-slate-200 dark:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{c.property?.title}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {c.tenant?.firstName} {c.tenant?.lastName}
                    {(c.cotenantNames ?? []).length > 0 && ` + ${c.cotenantNames!.join(", ")}`}
                  </p>
                </div>
                <Badge status={c.status} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{formatMoney(c.rent, c.currency)}</span>
                {revisionLien(c)}
                  {garantsLien(c)}
                  {colocatairesLien(c)}
                  {modifierLien(c)}
                <span className="text-slate-600 dark:text-slate-400">{formatDate(c.startDate, i18n.language)} → {formatDate(c.endDate, i18n.language)}</span>
              </div>
              {c.status === "ACTIVE" && echeanceLigne(c)}
              {showRenewal && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <Clock size={12} className="inline shrink-0 -mt-0.5" aria-hidden="true" />{" "}
                  {daysLeft <= 0 ? t("manager.contracts.overdue") : t("manager.contracts.endsInDays", { count: daysLeft })}
                </p>
              )}
              <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                <span>
                  {t("manager.contracts.agency")} {c.signedByManagerAt ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 size={13} aria-hidden="true" /> {t("manager.contracts.signed")}
                    </span>
                  ) : (
                    <Bulle texte={t("manager.tips.contractSign")}>
                    <button onClick={() => setSigningContract(c)} className="text-brand-600 dark:text-brand-400 font-semibold hover:underline inline-flex items-center gap-1">
                      <PenLine size={13} aria-hidden="true" /> {t("manager.contracts.sign")}
                    </button>
                    </Bulle>
                  )}
                </span>
                <span>
                  {t("manager.contracts.tenantLabel")} {c.signedByTenantAt ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 size={13} aria-hidden="true" /> {t("manager.contracts.signed")}
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                      <Hourglass size={12} aria-hidden="true" /> {t("manager.contracts.pendingSignature")}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Bulle texte={t("manager.tips.contractViewLease")}>
                <button
                  onClick={() => setViewingLeaseContract(c)}
                  className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
                >
                  <Download size={12} aria-hidden="true" /> {t("manager.contracts.leasePdf")}
                </button>
                </Bulle>

                {c.scannedContractUrl ? (
                  <Bulle texte={t("manager.tips.contractViewScan")}>
                  <button
                    onClick={() => handleViewScannedContract(c)}
                    className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 font-semibold px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-emerald-200/80 dark:border-emerald-500/20"
                  >
                    <FileCheck size={13} />
                    <span>{t("manager.contracts.scanContractShort")}</span>
                  </button>
                  </Bulle>
                ) : null}

                <Bulle texte={t("manager.tips.contractScan")}>
                <button
                  onClick={() => triggerScanUpload(c)}
                  disabled={uploadingScanContractId === c.id}
                  className="text-xs bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-brand-200/80 dark:border-brand-500/20 disabled:opacity-50"
                >
                  <Camera size={13} />
                  <span>
                    {uploadingScanContractId === c.id
                      ? t("manager.contracts.uploadingScan")
                      : c.scannedContractUrl
                      ? "Remplacer scan"
                      : t("manager.contracts.scanContractShort")}
                  </span>
                </button>
                </Bulle>

                {showRenewal && (
                  <>
                    <Bulle texte={t("manager.tips.contractRenew")}>
                    <button
                      onClick={() => handleRenew(c)}
                      className="text-xs bg-emerald-700 text-white font-medium px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
                    >
                      <RefreshCw size={12} aria-hidden="true" /> {t("manager.contracts.renewShort")}
                    </button>
                    </Bulle>
                    <Bulle texte={t("manager.tips.contractEnd")}>
                    <button onClick={() => changeStatus(c, "ENDED")} className="text-slate-600 dark:text-slate-400 hover:underline text-xs">
                      {t("manager.contracts.doNotRenew")}
                    </button>
                    </Bulle>
                  </>
                )}
                {c.status === "ACTIVE" && (
                  <Bulle texte={t("manager.tips.contractTerminate")}>
                  <button onClick={() => handleTerminate(c)} className="text-amber-700 dark:text-amber-400 hover:underline text-xs">
                    {t("manager.contracts.terminate")}
                  </button>
                  </Bulle>
                )}
                {c.status !== "ACTIVE" && (
                  c.depositRefundedAt ? (
                    <Bulle texte={t("manager.tips.contractCancelDepositRefund")}>
                    <button
                      onClick={() => handleCancelDepositRefund(c)}
                      className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 font-semibold px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-emerald-200/80 dark:border-emerald-500/20"
                    >
                      <Banknote size={13} aria-hidden="true" />
                      <span>{t("manager.contracts.depositRefunded", { amount: formatMoney(depositRefundedAmount(c), c.currency) })}</span>
                    </button>
                    </Bulle>
                  ) : (
                    <Bulle texte={t("manager.tips.contractDepositRefund")}>
                    <button
                      onClick={() => setDepositRefundContract(c)}
                      className="text-xs bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-brand-200/80 dark:border-brand-500/20"
                    >
                      <Banknote size={13} aria-hidden="true" />
                      <span>{t("manager.contracts.depositRefund")}</span>
                    </button>
                    </Bulle>
                  )
                )}
                <Bulle texte={t("manager.tips.contractDelete")}>
                <button onClick={() => handleDelete(c)} className="text-red-600 dark:text-red-400 hover:underline text-xs">
                  {t("common.actions.delete")}
                </button>
                </Bulle>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input de fichier pour scanner le contrat papier (supporte la caméra smartphone via capture="environment") */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleScanFileChange}
        accept="application/pdf,image/png,image/jpeg,image/webp"
        capture="environment"
        className="hidden"
      />

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {signingContract && (
        <SignatureModal
          signUrl={`/contracts/${signingContract.id}/sign`}
          title={t("manager.contracts.leaseTitle", { property: signingContract.property?.title })}
          onSuccess={() => {
            setSigningContract(null);
            load();
          }}
          onClose={() => setSigningContract(null)}
        />
      )}

      {viewingLeaseContract && (
        <DocumentModal
          title={t("manager.contracts.leaseDocTitle", { property: viewingLeaseContract.property?.title })}
          docUrl={`/documents/lease/${viewingLeaseContract.id}`}
          onClose={() => setViewingLeaseContract(null)}
        />
      )}

      {viewingScannedContract && (
        <ScannedContractModal
          title={viewingScannedContract.title}
          fileUrl={viewingScannedContract.url}
          onClose={() => setViewingScannedContract(null)}
        />
      )}

      {revisingRent && (
        <RentRevisionModal
          contractId={revisingRent.id}
          rent={revisingRent.rent}
          currency={revisingRent.currency}
          endDate={revisingRent.endDate}
          dateSuggeree={revisingRent.dateSuggeree}
          onOpenAvenant={setViewingAvenant}
          onSuccess={() => {
            setRevisingRent(null);
            load();
          }}
          onClose={() => setRevisingRent(null)}
        />
      )}

      {viewingAvenant && (
        <DocumentModal title={t("manager.contracts.avenantDocTitle")} docUrl={`/documents/rent-revision/${viewingAvenant}`} onClose={() => setViewingAvenant(null)} />
      )}

      {guarantorsContract && (
        <GuarantorsModal
          contractId={guarantorsContract.id}
          currency={guarantorsContract.currency}
          verrouille={Boolean(guarantorsContract.signedByTenantAt)}
          onChange={() => load()}
          onClose={() => setGuarantorsContract(null)}
        />
      )}

      {cotenantsContract && (
        <CotenantsModal
          contractId={cotenantsContract.id}
          titulaireId={cotenantsContract.tenantId}
          locataires={tenants}
          verrouille={Boolean(cotenantsContract.signedByTenantAt)}
          onChange={() => load()}
          onClose={() => setCotenantsContract(null)}
        />
      )}

      {editingPaymentDay && (
        <PaymentDayModal
          contractId={editingPaymentDay.id}
          paymentDay={editingPaymentDay.paymentDay ?? null}
          startDay={new Date(editingPaymentDay.startDate).getUTCDate()}
          onSuccess={() => {
            setEditingPaymentDay(null);
            load();
          }}
          onClose={() => setEditingPaymentDay(null)}
        />
      )}

      {depositRefundContract && (
        <DepositRefundModal
          contract={depositRefundContract}
          onSuccess={() => {
            setDepositRefundContract(null);
            load();
          }}
          onClose={() => setDepositRefundContract(null)}
        />
      )}
    </div>
  );
}
