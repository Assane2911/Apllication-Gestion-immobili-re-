import { Check, Copy, Download, KeyRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, isRequestCancelled, liste, MAX_UPLOAD_SIZE_MB } from "../../api/client";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import { preparerFichier } from "../../utils/fichiers";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import ChampTelephone from "../../components/ChampTelephone";
import SectionReglage from "../../components/SectionReglage";
import Initiales from "../../components/Initiales";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { Skeleton, TableRowSkeleton } from "../../components/Skeleton";
import type { PaginatedResponse, ReliabilityLevel, Tenant } from "../../types";
import Bulle from "../../components/Bulle";
import { motDePasseTemporaire } from "../../utils/motDePasseTemporaire";
import { correspond } from "../../utils/recherche";
import { aSurveiller, csvLocataires, trierLocataires, type CritereTriLocataire } from "../../utils/syntheseParc";
import { dateDuJourPourFichier, telechargerCsv } from "../../utils/telechargement";

// Sous ce nombre de fiches, la recherche et les filtres n'apportent rien : la barre d'outils reste cachée.
const SEUIL_OUTILS = 4;
const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900";
const LIEN_ACTION = "cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 whitespace-nowrap";
type Filtre = "all" | "watch" | "noPortal" | "noId";

const emptyForm = { civility: "", firstName: "", lastName: "", phone: "", email: "", language: "fr" };
const PAGE_SIZE = 20;

const CLASSES_PAR_NIVEAU: Record<ReliabilityLevel, string> = {
  excellent: "border-ink-900 bg-ink-900 text-white",
  bon: "border-ink-900 bg-white text-ink-900",
  moyen: "border-orange-300 bg-orange-50 text-orange-900",
  risque: "border-orange-700 bg-orange-700 text-white",
  insuffisant: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Badge du score interne de ponctualité de paiement — voir reliability.service.ts côté API. */
function BadgeFiabilite({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  const f = tenant.fiabilite;
  if (!f) return <span className="text-slate-500">—</span>;

  const libelle = t(`manager.tenants.reliability.${f.niveau}`);
  const texteBulle = t("manager.tips.tenantReliability", {
    onTime: f.payeATemps,
    late: f.payeEnRetard,
    unpaid: f.enRetardActuel,
  });

  return (
    <Bulle texte={texteBulle}>
      <span
        tabIndex={0}
        className={`inline-flex cursor-default items-center gap-1 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${CLASSES_PAR_NIVEAU[f.niveau]}`}
      >
        {f.score !== null ? `${f.score}/100 · ${libelle}` : libelle}
      </span>
    </Bulle>
  );
}

export default function TenantsPage() {
  const { t, i18n } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [portalTenant, setPortalTenant] = useState<Tenant | null>(null);
  const [portalPassword, setPortalPassword] = useState("");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const [creatingPortal, setCreatingPortal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("all");
  const [tri, setTri] = useState<CritereTriLocataire>("recent");
  const [motDePasseCopie, setMotDePasseCopie] = useState(false);

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<Tenant>>("/tenants", { params: { page, pageSize: PAGE_SIZE }, signal })
      .then((res) => {
        setTenants(liste<Tenant>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
        setLoading(false);
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
    // Les e-mails du locataire partent dans la langue choisie ici ; par défaut, celle dans laquelle le gestionnaire
    // utilise l'application.
    const langueDeLInterface = (i18n.language || "fr").slice(0, 2);
    setForm({ ...emptyForm, language: SUPPORTED_LANGUAGES.some((l) => l.code === langueDeLInterface) ? langueDeLInterface : "fr" });
    setIdDocument(null);
    setShowForm(true);
  }

  function openEdit(t: Tenant) {
    setEditing(t);
    setForm({ civility: t.civility ?? "", firstName: t.firstName, lastName: t.lastName, phone: t.phone, email: t.email, language: t.language ?? "fr" });
    setIdDocument(null);
    setShowForm(true);
  }

  // Pièce d'identité : photo réduite avant l'envoi, PDF trop lourd refusé tout de suite avec un message lisible.
  async function choisirPiece(e: React.ChangeEvent<HTMLInputElement>) {
    const brut = e.target.files?.[0] ?? null;
    const prete = brut ? await preparerFichier(brut) : null;
    if (brut && !prete) {
      e.target.value = "";
      setIdDocument(null);
      setError(t("common.errors.fileTooLarge", { maxMb: MAX_UPLOAD_SIZE_MB }));
      return;
    }
    setError(null);
    setIdDocument(prete);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = new FormData();
      // Un champ laissé vide est OMIS, et non envoyé comme chaîne vide : le
      // serveur attend « M », « MME » ou rien du tout, et « » n'est pas rien
      // — c'est une valeur qu'il refuse. La civilité étant facultative, ne pas
      // la renseigner doit rester possible.
      Object.entries(form).forEach(([k, v]) => {
        if (v !== "") data.append(k, v);
      });
      if (idDocument) data.append("idDocument", idDocument);

      if (editing) {
        await api.put(`/tenants/${editing.id}`, data, { timeout: DELAI_UPLOAD_MS });
      } else {
        await api.post("/tenants", data, { timeout: DELAI_UPLOAD_MS });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function openIdDocument(tenant: Tenant) {
    try {
      // La pièce d'identité vit dans le bucket PRIVÉ de Supabase Storage : on
      // génère une URL signée à durée limitée à la demande, plutôt que de
      // stocker un lien public permanent vers un document sensible.
      const { data } = await api.get<{ url: string }>(`/tenants/${tenant.id}/id-document-url`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleDelete(tenant: Tenant) {
    if (!confirm(t("manager.tenants.confirmDelete", { name: `${tenant.firstName} ${tenant.lastName}` }))) return;
    try {
      await api.delete(`/tenants/${tenant.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  /**
   * Droit d'accès et portabilité. Le locataire adresse sa demande au
   * gestionnaire, responsable de traitement pour les données qu'il a saisies :
   * c'est donc d'ici que le dossier complet se récupère, en un fichier.
   */
  async function handleExport(tenant: Tenant) {
    try {
      const res = await api.get(`/tenants/${tenant.id}/export`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `donnees-${tenant.firstName}-${tenant.lastName}.json`.toLowerCase();
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  /**
   * Droit à l'effacement. La suppression pure est refusée par l'API dès qu'un
   * contrat existe — on ne détruit pas des pièces comptables — ce qui ne
   * laissait aucune réponse à donner au locataire qui la demande.
   * L'anonymisation efface ce qui l'identifie et conserve les écritures.
   */
  async function handleAnonymize(tenant: Tenant) {
    if (!confirm(t("manager.tenants.confirmAnonymize", { name: `${tenant.firstName} ${tenant.lastName}` }))) return;
    try {
      await api.post(`/tenants/${tenant.id}/anonymiser`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  function genererMotDePasse() {
    setPortalPassword(motDePasseTemporaire());
    setMotDePasseCopie(false);
  }

  async function copierMotDePasse() {
    try {
      await navigator.clipboard.writeText(portalPassword);
      setMotDePasseCopie(true);
      setTimeout(() => setMotDePasseCopie(false), 1800);
    } catch {
      // Presse-papiers indisponible : le mot de passe reste affiché, il peut être recopié à la main.
    }
  }

  async function handleCreatePortal(e: React.FormEvent) {
    e.preventDefault();
    if (!portalTenant || creatingPortal) return;
    setPortalMsg(null);
    setCreatingPortal(true);
    try {
      await api.post(`/tenants/${portalTenant.id}/portal-account`, { password: portalPassword });
      setPortalMsg(t("manager.tenants.portalSuccess"));
      load();
    } catch (err) {
      setPortalMsg(apiErrorMessage(err));
    } finally {
      setCreatingPortal(false);
    }
  }

  const actifs = tenants.filter((l) => !l.anonymizedAt);
  const sansPortail = actifs.filter((l) => !l.userId);
  const sansPiece = actifs.filter((l) => !l.idDocument);
  const asurveiller = actifs.filter(aSurveiller);
  const afficherOutils = tenants.length >= SEUIL_OUTILS;
  const visibles = trierLocataires(
    tenants.filter((l) => {
      if (filtre === "watch" && !aSurveiller(l)) return false;
      if (filtre === "noPortal" && (l.userId || l.anonymizedAt)) return false;
      if (filtre === "noId" && (l.idDocument || l.anonymizedAt)) return false;
      return correspond(recherche, l.firstName, l.lastName, l.phone, l.email);
    }),
    tri
  );
  const filtresActifs = recherche.trim() !== "" || filtre !== "all";

  function exporterCsv() {
    telechargerCsv(
      `locataires-${dateDuJourPourFichier()}.csv`,
      csvLocataires(visibles, {
        name: t("manager.tenants.table.name"),
        phone: t("manager.tenants.table.phone"),
        email: t("manager.tenants.table.email"),
        portal: t("manager.tenants.csvPortal"),
        reliability: t("manager.tenants.csvReliability"),
        yes: t("manager.tenants.csvYes"),
        no: t("manager.tenants.csvNo"),
      })
    );
  }

  function ouvrirPortail(tenant: Tenant) {
    setPortalTenant(tenant);
    setPortalMsg(null);
    setPortalPassword("");
    setMotDePasseCopie(false);
  }

  const lienTel = (l: Tenant) => (
    <a href={`tel:${l.phone.replace(/\s+/g, "")}`} title={t("manager.tenants.call", { name: `${l.firstName} ${l.lastName}` })} className="hover:text-orange-700 hover:underline">
      {l.phone}
    </a>
  );
  const lienMail = (l: Tenant) => (
    <a href={`mailto:${l.email}`} title={t("manager.tenants.writeTo", { name: `${l.firstName} ${l.lastName}` })} className="whitespace-nowrap hover:text-orange-700 hover:underline sm:[overflow-wrap:normal]">
      {l.email}
    </a>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.tenants.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.tenants.count", { count: tenants.length })}</p>
        </div>
        <Bulle texte={t("manager.tips.tenantCreate")}>
          <button onClick={openCreate} className={BOUTON_PLEIN}>
            {t("manager.tenants.addBtn")}
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

      {showForm && (
        <SectionReglage id="fiche-locataire" numero="01" titre={editing ? t("manager.tenants.formTitleEdit") : t("manager.tenants.formTitleNew")}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="tenant-civility" className={LIBELLE}>{t("common.civility.label")}</label>
              <select id="tenant-civility" value={form.civility} onChange={(e) => setForm({ ...form, civility: e.target.value })} className={`${CHAMP} md:w-56`}>
                <option value="">{t("common.civility.none")}</option>
                <option value="M">{t("common.civility.M")}</option>
                <option value="MME">{t("common.civility.MME")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="tenant-firstName" className={LIBELLE}>{t("manager.tenants.fields.firstName")}</label>
              <input id="tenant-firstName" required maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="tenant-lastName" className={LIBELLE}>{t("manager.tenants.fields.lastName")}</label>
              <input id="tenant-lastName" required maxLength={100} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="tenant-phone" className={LIBELLE}>{t("manager.tenants.fields.phone")}</label>
              <ChampTelephone id="tenant-phone" required value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
            <div>
              <label htmlFor="tenant-email" className={LIBELLE}>{t("manager.tenants.fields.email")}</label>
              <input id="tenant-email" required type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={CHAMP} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="tenant-language" className={LIBELLE}>{t("manager.tenants.fields.language")}</label>
              <select id="tenant-language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} aria-describedby="tenant-language-hint" className={`${CHAMP} md:w-56`}>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <p id="tenant-language-hint" className="mt-1 text-xs text-slate-600">{t("manager.tenants.fields.languageHint")}</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="tenant-idDocument" className={LIBELLE}>{t("manager.tenants.fields.idDocument")}</label>
              <input id="tenant-idDocument" type="file" accept="image/*,application/pdf" onChange={(e) => void choisirPiece(e)} className="w-full text-sm" />
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

      {portalTenant && (
        <SectionReglage id="acces-portail" numero="02" titre={t("manager.tenants.createPortalTitle", { name: `${portalTenant.firstName} ${portalTenant.lastName}` })}>
          <p className="mb-4 font-mono text-[11px] text-slate-600">{t("manager.tenants.loginId", { email: portalTenant.email })}</p>
          <form onSubmit={handleCreatePortal} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="tenant-tempPassword" className={LIBELLE}>{t("manager.tenants.tempPassword")}</label>
              <input id="tenant-tempPassword" required minLength={8} type="text" value={portalPassword} onChange={(e) => { setPortalPassword(e.target.value); setMotDePasseCopie(false); }} className={`${CHAMP} w-64 font-mono`} />
            </div>
            <button type="button" onClick={genererMotDePasse} className={BOUTON_TRAIT}>
              <KeyRound size={13} aria-hidden="true" />
              {t("manager.tenants.generatePassword")}
            </button>
            {portalPassword && (
              <button type="button" onClick={copierMotDePasse} className={BOUTON_TRAIT}>
                {motDePasseCopie ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {motDePasseCopie ? t("manager.tenants.copiedPassword") : t("manager.tenants.copyPassword")}
              </button>
            )}
            <button type="submit" disabled={creatingPortal} className={BOUTON_PLEIN}>
              {creatingPortal ? t("common.actions.saving") : t("manager.tenants.createAccess")}
            </button>
            <button type="button" onClick={() => { setPortalTenant(null); setPortalMsg(null); }} className="cursor-pointer px-2 py-2 text-sm text-slate-500 hover:text-ink-900">
              {t("common.actions.close")}
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-600">{t("manager.tenants.passwordHint")}</p>
          {portalMsg && <p className="mt-2 border-l-2 border-orange-700 pl-3 text-sm text-slate-700">{portalMsg}</p>}
        </SectionReglage>
      )}

      {!loading && tenants.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.tenants.summary.label")}
          cases={[
            { libelle: t("manager.tenants.summary.total"), valeur: actifs.length, aide: t("manager.tenants.summary.totalHint") },
            {
              libelle: t("manager.tenants.summary.portal"),
              valeur: `${actifs.length - sansPortail.length} / ${actifs.length}`,
              aide: t("manager.tenants.summary.portalHint", { count: sansPortail.length }),
            },
            {
              libelle: t("manager.tenants.summary.idDocs"),
              valeur: `${actifs.length - sansPiece.length} / ${actifs.length}`,
              aide: t("manager.tenants.summary.idDocsHint", { count: sansPiece.length }),
              ton: sansPiece.length > 0 ? "alerte" : "normal",
            },
            {
              libelle: t("manager.tenants.summary.watch"),
              valeur: asurveiller.length,
              aide: t("manager.tenants.summary.watchHint"),
              ton: asurveiller.length > 0 ? "alerte" : "normal",
            },
          ]}
        />
      )}

      {!loading && afficherOutils && (
        <>
          <BarreListe
            idPrefixe="locataires"
            recherche={recherche}
            onRecherche={setRecherche}
            placeholderRecherche={t("manager.tenants.search")}
            libelleFiltres={t("manager.tenants.filtersLabel")}
            filtres={[
              { cle: "all", libelle: t("manager.liste.all"), compte: tenants.length },
              { cle: "watch", libelle: t("manager.tenants.filters.watch"), compte: asurveiller.length },
              { cle: "noPortal", libelle: t("manager.tenants.filters.noPortal"), compte: sansPortail.length },
              { cle: "noId", libelle: t("manager.tenants.filters.noId"), compte: sansPiece.length },
            ]}
            filtreActif={filtre}
            onFiltre={(cle) => setFiltre(cle as Filtre)}
            tri={{
              libelle: t("manager.tenants.sort.label"),
              valeur: tri,
              onChange: (v) => setTri(v as CritereTriLocataire),
              options: [
                { valeur: "recent", libelle: t("manager.tenants.sort.recent") },
                { valeur: "nom", libelle: t("manager.tenants.sort.name") },
                { valeur: "fiabilite", libelle: t("manager.tenants.sort.reliability") },
              ],
            }}
          >
            <button type="button" onClick={exporterCsv} className={BOUTON_TRAIT}>
              <Download size={13} aria-hidden="true" />
              {t("manager.liste.exportCsv")}
            </button>
          </BarreListe>
          <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {t(totalPages > 1 ? "manager.liste.shownOnPage" : "manager.liste.shown", { shown: visibles.length, total: tenants.length })}
          </p>
        </>
      )}

      {!loading && tenants.length === 0 && !showForm ? (
        <EmptyState
          icon={Users}
          title={t("manager.tenants.emptyTitle")}
          description={t("manager.tenants.emptyDesc")}
          action={{ label: t("manager.tenants.addBtn"), onClick: openCreate }}
        />
      ) : !loading && visibles.length === 0 && tenants.length > 0 ? (
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
              <th className="px-4 py-3 font-semibold">{t("manager.tenants.table.name")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.tenants.table.phone")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.tenants.table.email")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.tenants.table.idDocument")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.tenants.table.reliability")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.tenants.table.portal")}</th>
              <th className="px-4 py-3 font-semibold">
                <span className="sr-only">{t("manager.tenants.table.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} columns={7} />)
            ) : (
            visibles.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  <div className="flex items-center gap-3">
                    <Initiales prenom={tenant.firstName} nom={tenant.lastName} />
                    <span className="whitespace-nowrap">{tenant.firstName} {tenant.lastName}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{lienTel(tenant)}</td>
                <td className="px-4 py-3 text-slate-600">{lienMail(tenant)}</td>
                <td className="px-4 py-3">
                  {tenant.idDocument ? (
                    <Bulle texte={t("manager.tips.tenantIdDocument")}><button onClick={() => openIdDocument(tenant)} className={LIEN_ACTION}>
                      {t("manager.tenants.viewIdDocument")}
                    </button></Bulle>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <BadgeFiabilite tenant={tenant} />
                </td>
                <td className="px-4 py-3">
                  {tenant.userId ? (
                    <span className="inline-flex items-center gap-1.5 border border-ink-900 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900"><span aria-hidden="true" className="size-1.5 bg-ink-900" />{t("manager.tenants.portalActive")}</span>
                  ) : (
                    <Bulle texte={t("manager.tips.tenantPortal")}>
                    <button onClick={() => ouvrirPortail(tenant)} className={LIEN_ACTION}>
                      {t("manager.tenants.createAccess")}
                    </button>
                    </Bulle>
                  )}
                </td>
                <td className="px-4 py-3 text-right"><div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
                  <Bulle texte={t("manager.tips.tenantEdit")}><button onClick={() => openEdit(tenant)} className={LIEN_ACTION}>{t("common.actions.edit")}</button></Bulle>
                  <Bulle texte={t("manager.tips.tenantExport")}><button onClick={() => handleExport(tenant)} className="cursor-pointer border-b border-slate-400/60 text-xs font-semibold text-slate-700 transition-colors hover:border-ink-900 hover:text-ink-900">{t("manager.tenants.exportData")}</button></Bulle>
                  {tenant.anonymizedAt ? (
                    <span className="text-xs text-slate-600">{t("manager.tenants.anonymized")}</span>
                  ) : (
                    <Bulle texte={t("manager.tips.tenantAnonymize")}><button onClick={() => handleAnonymize(tenant)} className="cursor-pointer border-b border-orange-700/40 text-xs font-semibold text-orange-800 transition-colors hover:border-orange-800">{t("manager.tenants.anonymize")}</button></Bulle>
                  )}
                  <Bulle texte={t("manager.tips.tenantDelete")}><button onClick={() => handleDelete(tenant)} className="cursor-pointer border-b border-rose-700/40 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-700">{t("common.actions.delete")}</button></Bulle>
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
          : visibles.map((tenant) => (
              <div key={tenant.id} className="space-y-2.5 border border-slate-300 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Initiales prenom={tenant.firstName} nom={tenant.lastName} />
                    <p className="font-medium text-slate-900">{tenant.firstName} {tenant.lastName}</p>
                  </div>
                  {tenant.userId ? (
                    <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">{t("manager.tenants.portalActiveMobile")}</span>
                  ) : (
                    <Bulle texte={t("manager.tips.tenantPortal")}>
                    <button onClick={() => ouvrirPortail(tenant)} className="-my-1 shrink-0 cursor-pointer border-b border-ink-900/40 py-1 text-[11px] font-semibold text-ink-900">
                      {t("manager.tenants.createAccess")}
                    </button>
                    </Bulle>
                  )}
                </div>
                <div className="space-y-1 text-xs text-slate-600">
                  <p>{lienTel(tenant)}</p>
                  <p>{lienMail(tenant)}</p>
                </div>
                <div>
                  <BadgeFiabilite tenant={tenant} />
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                  {tenant.idDocument ? (
                    <Bulle texte={t("manager.tips.tenantIdDocument")}><button onClick={() => openIdDocument(tenant)} className="-my-1 cursor-pointer border-b border-ink-900/40 py-1 font-semibold text-ink-900">
                      {t("manager.tenants.viewIdDocumentMobile")}
                    </button></Bulle>
                  ) : (
                    <span className="text-slate-500">{t("manager.tenants.noIdDocument")}</span>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Bulle texte={t("manager.tips.tenantEdit")}><button onClick={() => openEdit(tenant)} className="-my-1 cursor-pointer border-b border-ink-900/40 py-1 font-semibold text-ink-900">{t("common.actions.edit")}</button></Bulle>
                    <Bulle texte={t("manager.tips.tenantExport")}><button onClick={() => handleExport(tenant)} className="-my-1 cursor-pointer py-1 text-slate-600 hover:underline">{t("manager.tenants.exportData")}</button></Bulle>
                    {tenant.anonymizedAt ? (
                      <span className="text-slate-600">{t("manager.tenants.anonymized")}</span>
                    ) : (
                      <Bulle texte={t("manager.tips.tenantAnonymize")}><button onClick={() => handleAnonymize(tenant)} className="-my-1 cursor-pointer py-1 text-orange-800 hover:underline">{t("manager.tenants.anonymize")}</button></Bulle>
                    )}
                    <Bulle texte={t("manager.tips.tenantDelete")}><button onClick={() => handleDelete(tenant)} className="-my-1 cursor-pointer py-1 text-rose-700 hover:underline">{t("common.actions.delete")}</button></Bulle>
                  </div>
                </div>
              </div>
            ))}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </>
      )}
    </div>
  );
}
