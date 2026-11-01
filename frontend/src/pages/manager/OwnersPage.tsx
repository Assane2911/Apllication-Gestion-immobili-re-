import { Briefcase, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCurrency } from "../../context/currency";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import ChampTelephone from "../../components/ChampTelephone";
import SectionReglage from "../../components/SectionReglage";
import Initiales from "../../components/Initiales";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { Skeleton, TableRowSkeleton } from "../../components/Skeleton";
import type { Owner, PaginatedResponse } from "../../types";
import Bulle from "../../components/Bulle";
import { formatByCurrency } from "../../utils/currencyFormat";
import { bicValide, ibanValide } from "../../utils/iban";
import { correspond } from "../../utils/recherche";
import { csvProprietaires, trierProprietaires, type CritereTriProprietaire } from "../../utils/syntheseParc";
import { dateDuJourPourFichier, telechargerCsv } from "../../utils/telechargement";

// Sous ce nombre de fiches, la recherche et les filtres n'apportent rien : la barre d'outils reste cachée.
const SEUIL_OUTILS = 4;
const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900";
const LIEN_ACTION = "cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700";
type Filtre = "all" | "noPortal" | "pending" | "noIban";

/** Synthèse des reversements d'un mois (GET /crg/payouts/summary). */
interface SyntheseReversements {
  month: number;
  year: number;
  owners: Array<{ ownerId: string; ownerName: string; hasIban: boolean; resteByCurrency: Record<string, number> }>;
}

/** Les reversements se font au début du mois suivant : on rappelle donc le mois écoulé. */
function moisPrecedent(): { month: number; year: number } {
  const d = new Date();
  const precedent = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { month: precedent.getMonth() + 1, year: precedent.getFullYear() };
}

const aReverser = (s: SyntheseReversements) => s.owners.filter((o) => Object.values(o.resteByCurrency).some((m) => m > 0));

const emptyForm = {
  civility: "",
  firstName: "",
  lastName: "",
  companyName: "",
  phone: "",
  email: "",
  address: "",
  iban: "",
  bic: "",
  managementFeeRate: "8",
  notes: "",
  language: "fr",
};
const PAGE_SIZE = 20;

export default function OwnersPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Owner | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviting, setInvitingId] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<{ ownerId: string; text: string } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [synthese, setSynthese] = useState<SyntheseReversements | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("all");
  const [tri, setTri] = useState<CritereTriProprietaire>("recent");

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<Owner>>("/owners", { params: { page, pageSize: PAGE_SIZE }, signal })
      .then((res) => {
        setOwners(liste<Owner>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
        setLoading(false);
        // Reversements du mois écoulé : chargés APRÈS la liste, jamais bloquants.
        const { month, year } = moisPrecedent();
        return api
          .get<SyntheseReversements>("/crg/payouts/summary", { params: { month, year }, signal })
          .then((r) => setSynthese(r.data && Array.isArray(r.data.owners) ? r.data : null))
          .catch((err) => {
            if (!isRequestCancelled(err)) setSynthese(null);
          });
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [page]);

  function openCreate() {
    setEditing(null);
    // Par défaut, la langue dans laquelle le gestionnaire utilise l'application (voir TenantsPage).
    const langueDeLInterface = (i18n.language || "fr").slice(0, 2);
    setForm({ ...emptyForm, language: SUPPORTED_LANGUAGES.some((l) => l.code === langueDeLInterface) ? langueDeLInterface : "fr" });
    setShowForm(true);
  }

  function openEdit(owner: Owner) {
    setEditing(owner);
    setForm({
      firstName: owner.firstName,
      lastName: owner.lastName,
      companyName: owner.companyName ?? "",
      phone: owner.phone,
      civility: owner.civility ?? "",
      email: owner.email,
      address: owner.address ?? "",
      iban: owner.iban ?? "",
      bic: owner.bic ?? "",
      managementFeeRate: String(owner.managementFeeRate),
      notes: owner.notes ?? "",
      language: owner.language ?? "fr",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        // `undefined` et non `""` : la civilité est facultative, et le serveur
        // n'accepte que « M », « MME » ou l'absence du champ.
        civility: form.civility || undefined,
        firstName: form.firstName,
        lastName: form.lastName,
        companyName: form.companyName || undefined,
        phone: form.phone,
        email: form.email,
        address: form.address || undefined,
        iban: form.iban || undefined,
        bic: form.bic || undefined,
        managementFeeRate: form.managementFeeRate,
        notes: form.notes || undefined,
        language: form.language,
      };

      if (editing) {
        await api.put(`/owners/${editing.id}`, body);
      } else {
        await api.post("/owners", body);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(owner: Owner) {
    if (!confirm(t("manager.owners.confirmDelete", { name: `${owner.firstName} ${owner.lastName}` }))) return;
    try {
      await api.delete(`/owners/${owner.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  /**
   * Droit à l'effacement. `deleteOwner` refuse dès qu'un bien est associé —
   * les comptes-rendus de gestion et reversements doivent rester traçables —
   * ce qui ne laissait aucune réponse à donner au propriétaire qui la
   * demande. L'anonymisation efface ce qui l'identifie et conserve les biens
   * et l'historique de gestion (même principe que handleAnonymize côté
   * locataire, voir TenantsPage.tsx).
   */
  async function handleAnonymize(owner: Owner) {
    if (!confirm(t("manager.owners.confirmAnonymize", { name: `${owner.firstName} ${owner.lastName}` }))) return;
    try {
      await api.post(`/owners/${owner.id}/anonymiser`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleInvite(owner: Owner) {
    setInvitingId(owner.id);
    setInviteMsg(null);
    try {
      await api.post(`/owners/${owner.id}/invite`);
      setInviteMsg({ ownerId: owner.id, text: t("manager.owners.inviteSuccess") });
      load();
    } catch (err) {
      setInviteMsg({ ownerId: owner.id, text: apiErrorMessage(err) });
    } finally {
      setInvitingId(null);
    }
  }

  function portalStatusLabel(owner: Owner) {
    if (owner.portalStatus === "ACTIVE") return t("manager.owners.portalActive");
    if (owner.portalStatus === "PENDING") return t("manager.owners.portalPending");
    return t("manager.owners.portalNone");
  }

  const actifs = owners.filter((o) => !o.anonymizedAt);
  const sansPortail = actifs.filter((o) => o.portalStatus === "NONE");
  const invites = actifs.filter((o) => o.portalStatus === "PENDING");
  const sansIban = actifs.filter((o) => !o.iban?.trim());
  const commissionMoyenne = actifs.length > 0 ? actifs.reduce((somme, o) => somme + o.managementFeeRate, 0) / actifs.length : 0;
  const afficherOutils = owners.length >= SEUIL_OUTILS;
  const visibles = trierProprietaires(
    owners.filter((o) => {
      if (filtre === "noPortal" && (o.portalStatus !== "NONE" || o.anonymizedAt)) return false;
      if (filtre === "pending" && o.portalStatus !== "PENDING") return false;
      if (filtre === "noIban" && (o.iban?.trim() || o.anonymizedAt)) return false;
      return correspond(recherche, o.firstName, o.lastName, o.companyName, o.email, o.phone);
    }),
    tri
  );
  const filtresActifs = recherche.trim() !== "" || filtre !== "all";
  const aReverserListe = synthese ? aReverser(synthese) : [];
  // Total à reverser, devise par devise : jamais d'addition entre monnaies.
  const totalAReverser: Record<string, number> = {};
  for (const o of aReverserListe) for (const [devise, montant] of Object.entries(o.resteByCurrency)) if (montant > 0) totalAReverser[devise] = (totalAReverser[devise] ?? 0) + montant;

  function exporterCsv() {
    telechargerCsv(
      `proprietaires-${dateDuJourPourFichier()}.csv`,
      csvProprietaires(
        visibles,
        {
          name: t("manager.owners.table.name"),
          company: t("manager.owners.csvCompany"),
          phone: t("manager.owners.table.phone"),
          email: t("manager.owners.table.email"),
          feeRate: t("manager.owners.table.feeRate"),
          portal: t("manager.owners.csvPortal"),
        },
        portalStatusLabel
      )
    );
  }

  const pastillePortail = (owner: Owner) => (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
        owner.portalStatus === "ACTIVE"
          ? "border-ink-900 text-ink-900"
          : owner.portalStatus === "PENDING"
            ? "border-orange-300 bg-orange-50 text-orange-900"
            : "border-slate-300 bg-slate-100 text-slate-600"
      }`}
    >
      <span aria-hidden="true" className="size-1.5 bg-current" />
      {portalStatusLabel(owner)}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.owners.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.owners.count", { count: owners.length })}</p>
        </div>
        <Bulle texte={t("manager.tips.ownerCreate")}>
          <button onClick={openCreate} className={BOUTON_PLEIN}>
            {t("manager.owners.addBtn")}
          </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {synthese && aReverserListe.length > 0 && (
        <section aria-labelledby="reversements-du-mois" className="border border-slate-300 bg-white shadow-[inset_4px_0_0_var(--color-orange-700)]">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-300 bg-slate-50 py-3 pl-6 pr-5">
            <h3 id="reversements-du-mois" className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">
              {t("manager.owners.payoutsDue.title", {
                period: new Date(synthese.year, synthese.month - 1, 1).toLocaleDateString(i18n.language, { month: "long", year: "numeric" }),
                count: aReverserListe.length,
              })}
            </h3>
            <p className="font-mono text-xs font-semibold tabular-nums text-orange-700">{t("manager.owners.payoutsDue.total", { amount: formatByCurrency(totalAReverser, formatMoney) })}</p>
          </header>
          <ul className="divide-y divide-slate-200 py-1 pl-6 pr-5">
            {aReverserListe.map((o) => (
              <li key={o.ownerId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="text-slate-800">
                  <span className="font-medium">{o.ownerName}</span>
                  {!o.hasIban && <span className="ml-2 border border-orange-300 bg-orange-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-900">{t("manager.owners.payoutsDue.noIban")}</span>}
                </span>
                <span className="flex items-center gap-4">
                  <span className="font-semibold tabular-nums text-ink-900">
                    {Object.entries(o.resteByCurrency)
                      .filter(([, montant]) => montant > 0)
                      .map(([devise, montant]) => formatMoney(montant, devise))
                      .join(" · ")}
                  </span>
                  <Link to={`/proprietaires/${o.ownerId}/crg?month=${synthese.month}&year=${synthese.year}`} className={LIEN_ACTION}>
                    {t("manager.owners.payoutsDue.action")}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showForm && (
        <SectionReglage id="fiche-proprietaire" numero="01" titre={editing ? t("manager.owners.formTitleEdit") : t("manager.owners.formTitleNew")}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="owner-civility" className={LIBELLE}>{t("common.civility.label")}</label>
              <select id="owner-civility" value={form.civility} onChange={(e) => setForm({ ...form, civility: e.target.value })} className={`${CHAMP} md:w-56`}>
                <option value="">{t("common.civility.none")}</option>
                <option value="M">{t("common.civility.M")}</option>
                <option value="MME">{t("common.civility.MME")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="owner-firstName" className={LIBELLE}>{t("manager.owners.fields.firstName")}</label>
              <input id="owner-firstName" required maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="owner-lastName" className={LIBELLE}>{t("manager.owners.fields.lastName")}</label>
              <input id="owner-lastName" required maxLength={100} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={CHAMP} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-companyName" className={LIBELLE}>{t("manager.owners.fields.companyName")}</label>
              <input id="owner-companyName" maxLength={200} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="owner-phone" className={LIBELLE}>{t("manager.owners.fields.phone")}</label>
              <ChampTelephone id="owner-phone" required value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
            <div>
              <label htmlFor="owner-email" className={LIBELLE}>{t("manager.owners.fields.email")}</label>
              <input id="owner-email" required type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={CHAMP} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-address" className={LIBELLE}>{t("manager.owners.fields.address")}</label>
              <input id="owner-address" maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="owner-iban" className={LIBELLE}>{t("manager.owners.fields.iban")}</label>
              <input id="owner-iban" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} aria-describedby="owner-iban-aide" className={`${CHAMP} font-mono`} />
              {/* Indication seulement : la clé de contrôle détecte une faute de frappe, l'enregistrement reste libre. */}
              <p id="owner-iban-aide" aria-live="polite" className={`mt-1 min-h-4 font-mono text-[11px] ${form.iban.trim() === "" ? "" : ibanValide(form.iban) ? "text-ink-900" : "text-orange-700"}`}>
                {form.iban.trim() === "" ? "" : ibanValide(form.iban) ? t("manager.owners.ibanCheck.valid") : t("manager.owners.ibanCheck.invalid")}
              </p>
            </div>
            <div>
              <label htmlFor="owner-bic" className={LIBELLE}>{t("manager.owners.fields.bic")}</label>
              <input id="owner-bic" value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value })} aria-describedby="owner-bic-aide" className={`${CHAMP} font-mono`} />
              <p id="owner-bic-aide" aria-live="polite" className="mt-1 min-h-4 font-mono text-[11px] text-orange-700">
                {form.bic.trim() !== "" && !bicValide(form.bic) ? t("manager.owners.ibanCheck.bicInvalid") : ""}
              </p>
            </div>
            <div>
              <label htmlFor="owner-managementFeeRate" className={LIBELLE}>{t("manager.owners.fields.managementFeeRate")}</label>
              <input id="owner-managementFeeRate" required type="number" step="0.1" min="0" max="100" value={form.managementFeeRate} onChange={(e) => setForm({ ...form, managementFeeRate: e.target.value })} className={CHAMP} />
              {editing && <p className="mt-1 text-xs text-slate-500">{t("manager.owners.fields.managementFeeRateHint")}</p>}
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-language" className={LIBELLE}>{t("manager.owners.fields.language")}</label>
              <select id="owner-language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} aria-describedby="owner-language-hint" className={`${CHAMP} md:w-56`}>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <p id="owner-language-hint" className="mt-1 text-xs text-slate-600">{t("manager.owners.fields.languageHint")}</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-notes" className={LIBELLE}>{t("manager.owners.fields.notes")}</label>
              <textarea id="owner-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={CHAMP} />
            </div>
            {error && <p role="alert" className="text-sm text-red-600 md:col-span-2">{error}</p>}
            <div className="flex gap-2 md:col-span-2">
              <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="cursor-pointer px-4 py-2 text-sm text-slate-600 hover:text-ink-900">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </SectionReglage>
      )}

      {!loading && owners.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.owners.summary.label")}
          cases={[
            { libelle: t("manager.owners.summary.total"), valeur: actifs.length, aide: t("manager.owners.summary.totalHint") },
            {
              libelle: t("manager.owners.summary.portal"),
              valeur: `${actifs.length - sansPortail.length - invites.length} / ${actifs.length}`,
              aide: t("manager.owners.summary.portalHint", { pending: invites.length, none: sansPortail.length }),
            },
            { libelle: t("manager.owners.summary.feeAverage"), valeur: `${(Math.round(commissionMoyenne * 10) / 10).toLocaleString(i18n.language)} %`, aide: t("manager.owners.summary.feeAverageHint") },
            {
              libelle: t("manager.owners.summary.missingIban"),
              valeur: sansIban.length,
              aide: t("manager.owners.summary.missingIbanHint"),
              ton: sansIban.length > 0 ? "alerte" : "normal",
            },
          ]}
        />
      )}

      {!loading && afficherOutils && (
        <>
          <BarreListe
            idPrefixe="proprietaires"
            recherche={recherche}
            onRecherche={setRecherche}
            placeholderRecherche={t("manager.owners.search")}
            libelleFiltres={t("manager.owners.filtersLabel")}
            filtres={[
              { cle: "all", libelle: t("manager.liste.all"), compte: owners.length },
              { cle: "noPortal", libelle: t("manager.owners.filters.noPortal"), compte: sansPortail.length },
              { cle: "pending", libelle: t("manager.owners.filters.pending"), compte: invites.length },
              { cle: "noIban", libelle: t("manager.owners.filters.noIban"), compte: sansIban.length },
            ]}
            filtreActif={filtre}
            onFiltre={(cle) => setFiltre(cle as Filtre)}
            tri={{
              libelle: t("manager.owners.sort.label"),
              valeur: tri,
              onChange: (v) => setTri(v as CritereTriProprietaire),
              options: [
                { valeur: "recent", libelle: t("manager.owners.sort.recent") },
                { valeur: "nom", libelle: t("manager.owners.sort.name") },
                { valeur: "commission", libelle: t("manager.owners.sort.feeDesc") },
              ],
            }}
          >
            <button type="button" onClick={exporterCsv} className={BOUTON_TRAIT}>
              <Download size={13} aria-hidden="true" />
              {t("manager.liste.exportCsv")}
            </button>
          </BarreListe>
          <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {t(totalPages > 1 ? "manager.liste.shownOnPage" : "manager.liste.shown", { shown: visibles.length, total: owners.length })}
          </p>
        </>
      )}

      {!loading && owners.length === 0 && !showForm ? (
        <EmptyState
          icon={Briefcase}
          title={t("manager.owners.emptyTitle")}
          description={t("manager.owners.emptyDesc")}
          action={{ label: t("manager.owners.addBtn"), onClick: openCreate }}
        />
      ) : !loading && visibles.length === 0 && owners.length > 0 ? (
        <div className="border border-slate-300 bg-white p-8 text-center shadow-[inset_4px_0_0_var(--color-ink-900)]">
          <p className="text-sm text-slate-700">{t("manager.liste.noResult")}</p>
          {filtresActifs && (
            <button type="button" onClick={() => { setRecherche(""); setFiltre("all"); }} className={`${BOUTON_TRAIT} mt-4`}>
              {t("manager.liste.resetFilters")}
            </button>
          )}
        </div>
      ) : (
      <>
      {/* Vue tableau (écrans sm et plus) */}
      <div className="relative hidden overflow-x-auto border border-slate-300 bg-white sm:block">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("manager.owners.table.name")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.owners.table.phone")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.owners.table.email")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.owners.table.feeRate")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.owners.table.portal")}</th>
              <th className="relative px-4 py-3 font-semibold"><span className="sr-only">{t("common.actions.column")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} columns={6} />)
            ) : (
            visibles.map((owner) => (
              <tr key={owner.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  <div className="flex items-center gap-3">
                    <Initiales prenom={owner.firstName} nom={owner.lastName} />
                    <div>
                      {owner.firstName} {owner.lastName}
                      {owner.companyName && <span className="block text-xs font-normal text-slate-600">{owner.companyName}</span>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{owner.phone}</td>
                <td className="px-4 py-3 text-slate-600">{owner.email}</td>
                <td className="px-4 py-3 tabular-nums text-slate-600">{owner.managementFeeRate}%</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1.5">
                    {pastillePortail(owner)}
                    {owner.portalStatus !== "ACTIVE" && (
                      <Bulle texte={t("manager.tips.ownerInvite")}>
                      <button
                        onClick={() => handleInvite(owner)}
                        disabled={inviting === owner.id}
                        className={`${LIEN_ACTION} text-left disabled:opacity-60`}
                      >
                        {owner.portalStatus === "PENDING" ? t("manager.owners.resendInvite") : t("manager.owners.invite")}
                      </button>
                      </Bulle>
                    )}
                    {inviteMsg?.ownerId === owner.id && (
                      <span className="text-[11px] text-slate-600">{inviteMsg.text}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right"><div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
                  <Link to={`/proprietaires/${owner.id}/crg`} className={LIEN_ACTION}>{t("manager.owners.viewCrg")}</Link>
                  <Bulle texte={t("manager.tips.ownerEdit")}><button onClick={() => openEdit(owner)} className={LIEN_ACTION}>{t("common.actions.edit")}</button></Bulle>
                  {owner.anonymizedAt ? (
                    <span className="text-xs text-slate-600">{t("manager.owners.anonymized")}</span>
                  ) : (
                    <Bulle texte={t("manager.tips.ownerAnonymize")}><button onClick={() => handleAnonymize(owner)} className="cursor-pointer border-b border-orange-700/40 text-xs font-semibold text-orange-800 transition-colors hover:border-orange-800">{t("manager.owners.anonymize")}</button></Bulle>
                  )}
                  <Bulle texte={t("manager.tips.ownerDelete")}><button onClick={() => handleDelete(owner)} className="cursor-pointer border-b border-rose-700/40 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-700">{t("common.actions.delete")}</button></Bulle>
                </div></td>
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>

      {/* Vue cartes empilées (mobile, < sm) */}
      <div className="space-y-3 sm:hidden">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 border border-slate-300 bg-white p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))
          : visibles.map((owner) => (
              <div key={owner.id} className="space-y-2.5 border border-slate-300 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Initiales prenom={owner.firstName} nom={owner.lastName} />
                    <p className="font-medium text-slate-900">{owner.firstName} {owner.lastName}</p>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-slate-600">{owner.managementFeeRate}%</span>
                </div>
                <div className="space-y-0.5 text-xs text-slate-600">
                  <p>{owner.phone}</p>
                  <p>{owner.email}</p>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                  <div className="flex flex-col items-start gap-1">
                    {pastillePortail(owner)}
                    {owner.portalStatus !== "ACTIVE" && (
                      <Bulle texte={t("manager.tips.ownerInvite")}>
                      <button onClick={() => handleInvite(owner)} disabled={inviting === owner.id} className="cursor-pointer border-b border-ink-900/40 text-left font-semibold text-ink-900 disabled:opacity-60">
                        {owner.portalStatus === "PENDING" ? t("manager.owners.resendInvite") : t("manager.owners.invite")}
                      </button>
                      </Bulle>
                    )}
                  </div>
                  <div className="space-x-3">
                    <Link to={`/proprietaires/${owner.id}/crg`} className="font-semibold text-ink-900 hover:underline">{t("manager.owners.viewCrg")}</Link>
                    <Bulle texte={t("manager.tips.ownerEdit")}><button onClick={() => openEdit(owner)} className="cursor-pointer font-semibold text-ink-900 hover:underline">{t("common.actions.edit")}</button></Bulle>
                    {owner.anonymizedAt ? (
                      <span className="text-slate-600">{t("manager.owners.anonymized")}</span>
                    ) : (
                      <Bulle texte={t("manager.tips.ownerAnonymize")}><button onClick={() => handleAnonymize(owner)} className="cursor-pointer text-orange-800 hover:underline">{t("manager.owners.anonymize")}</button></Bulle>
                    )}
                    <Bulle texte={t("manager.tips.ownerDelete")}><button onClick={() => handleDelete(owner)} className="cursor-pointer text-rose-700 hover:underline">{t("common.actions.delete")}</button></Bulle>
                  </div>
                </div>
                {inviteMsg?.ownerId === owner.id && (
                  <p className="text-[11px] text-slate-600">{inviteMsg.text}</p>
                )}
              </div>
            ))}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </>
      )}
    </div>
  );
}
