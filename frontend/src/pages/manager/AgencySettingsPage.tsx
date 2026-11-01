import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import ChampTelephone from "../../components/ChampTelephone";
import SectionImageAgence from "../../components/SectionImageAgence";
import SectionReglage from "../../components/SectionReglage";
import DeleteAccountModal from "../../components/DeleteAccountModal";
import TwoFactorDisableModal from "../../components/TwoFactorDisableModal";
import TwoFactorSetupModal from "../../components/TwoFactorSetupModal";
import { useAuth } from "../../context/auth";
import type { AgencySettings, RetentionEcheances, TeamMember, TeamRole } from "../../types";

const ROLES_EQUIPE: TeamRole[] = ["FULL", "AGENT", "ACCOUNTANT", "READ_ONLY"];
import Bulle from "../../components/Bulle";
import MembreEquipe from "../../components/MembreEquipe";


/** Jours de retard auxquels partent les trois relances, pour l'aperçu des réglages (même règle que le serveur). */
export function calendrierRelances(grace: string, intervalle: string): { first: number; second: number; third: number } {
  const g = Math.max(1, Number(grace) || 0);
  const i = Math.max(1, Number(intervalle) || 0);
  return { first: g, second: g + i, third: g + 2 * i };
}

export default function AgencySettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, user, refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTwoFactorSetup, setShowTwoFactorSetup] = useState(false);
  const [showTwoFactorDisable, setShowTwoFactorDisable] = useState(false);

  function handleTwoFactorEnabled() {
    setShowTwoFactorSetup(false);
    refreshUser();
  }

  function handleTwoFactorDisabled() {
    setShowTwoFactorDisable(false);
    refreshUser();
  }

  function handleAccountDeleted() {
    logout();
    navigate("/login", { replace: true });
  }

  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState("");

  async function handleLogoutAll() {
    if (!confirm(t("manager.agencySettings.security.confirmLogoutAll"))) return;
    setLoggingOutAll(true);
    setLogoutAllError("");
    try {
      await api.post("/auth/logout-all");
      // Le jeton courant vient d'être invalidé côté serveur : rester sur la
      // page afficherait une application qui se croit connectée et dont chaque
      // requête repartirait en 401.
      handleAccountDeleted();
    } catch (err) {
      setLogoutAllError(apiErrorMessage(err) || t("manager.agencySettings.security.logoutAllError"));
      setLoggingOutAll(false);
    }
  }

  const [form, setForm] = useState({
    agencyName: "",
    siretOrId: "",
    address: "",
    phone: "",
    email: "",
    legalNotice: "",
    iban: "",
    bic: "",
    overdueRemindersEnabled: false,
    overdueGraceDays: "5",
    overdueIntervalDays: "10",
    overdueNotifyGuarantors: false,
  });

  // Logo et tampon de l'agence : ils s'envoient à part du formulaire (fichiers), et le formulaire ne les renvoie jamais.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);

  useEffect(() => {
    // Sans ce `catch`, un échec de chargement affichait un formulaire VIDE,
    // indiscernable d'une agence jamais renseignée. Le gestionnaire retapait
    // les deux champs obligatoires, enregistrait, et le PUT écrasait IBAN,
    // BIC, adresse et mentions légales par des chaînes vides. Une perte de
    // données silencieuse, causée par une panne réseau passagère.
    api
      .get<AgencySettings>("/agency")
      .then((res) => {
        setForm({
          agencyName: res.data.agencyName || "",
          siretOrId: res.data.siretOrId || "",
          address: res.data.address || "",
          phone: res.data.phone || "",
          email: res.data.email || "",
          legalNotice: res.data.legalNotice || "",
          iban: res.data.iban || "",
          bic: res.data.bic || "",
          overdueRemindersEnabled: Boolean(res.data.overdueRemindersEnabled),
          overdueGraceDays: String(res.data.overdueGraceDays ?? 5),
          overdueIntervalDays: String(res.data.overdueIntervalDays ?? 10),
          overdueNotifyGuarantors: Boolean(res.data.overdueNotifyGuarantors),
        });
        setLogoUrl(res.data.logoUrl ?? null);
        setStampUrl(res.data.stampOrSignatureUrl ?? null);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)));
  }, []);

  /**
   * Données arrivées à échéance.
   *
   * Le Service ne les détruit pas de lui-même : pour les données locatives, le
   * gestionnaire est responsable de traitement et le Service sous-traitant, et
   * lui seul sait si un litige en cours justifie de conserver un dossier. La
   * plateforme signale, il décide — d'où une liste et un lien vers les fiches,
   * jamais un bouton « tout purger ».
   */
  const [echeances, setEcheances] = useState<RetentionEcheances | null>(null);
  const [echeancesError, setEcheancesError] = useState("");

  useEffect(() => {
    api
      .get<RetentionEcheances>("/conservation/echeances")
      .then((res) => setEcheances(res.data))
      .catch(() => setEcheancesError(t("manager.agencySettings.retention.error")));
  }, [t]);

  // Multi-utilisateurs (formule Entreprise) : seul le PROPRIÉTAIRE de
  // l'agence gère l'équipe, jamais un collaborateur (voir team.controller.ts
  // côté backend, qui refuse l'invitation/révocation dans ce cas).
  const estProprietaire = !user?.collaboratorId;
  const formuleEntreprise = user?.subscription?.plan === "ENTERPRISE";
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamError, setTeamError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  // Rôle proposé par défaut : le moins de droits utiles (voir rolesEquipe.ts).
  const [inviteRole, setInviteRole] = useState<TeamRole>("AGENT");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  function loadTeam() {
    api
      .get<TeamMember[]>("/team")
      .then((res) => setTeamMembers(res.data))
      .catch((err) => setTeamError(apiErrorMessage(err)));
  }

  useEffect(() => {
    if (estProprietaire && formuleEntreprise) loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estProprietaire, formuleEntreprise]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError("");
    setInviteSuccess("");
    try {
      await api.post("/team", { email: inviteEmail, role: inviteRole });
      setInviteSuccess(t("manager.agencySettings.team.inviteSuccess", { email: inviteEmail }));
      setInviteEmail("");
      loadTeam();
    } catch (err) {
      setInviteError(apiErrorMessage(err));
    } finally {
      setInviting(false);
    }
  }

  async function handleChangeRole(member: TeamMember, role: TeamRole) {
    const ancien = member.role;
    setTeamMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
    try {
      await api.patch(`/team/${member.id}/role`, { role });
    } catch (err) {
      setTeamMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: ancien } : m)));
      setTeamError(apiErrorMessage(err) || t("manager.agencySettings.team.roleChangeError"));
    }
  }

  async function handleResend(member: TeamMember) {
    setInviteError("");
    setInviteSuccess("");
    try {
      await api.post(`/team/${member.id}/resend`);
      setInviteSuccess(t("manager.agencySettings.team.resendSuccess", { email: member.email }));
      loadTeam();
    } catch (err) {
      setInviteError(apiErrorMessage(err) || t("manager.agencySettings.team.resendError"));
    }
  }

  async function handleRemove(member: TeamMember) {
    if (!confirm(t("manager.agencySettings.team.confirmRemove", { email: member.email }))) return;
    try {
      await api.delete(`/team/${member.id}`);
      setTeamMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await api.put<AgencySettings>("/agency", {
        ...form,
        overdueGraceDays: Number(form.overdueGraceDays),
        overdueIntervalDays: Number(form.overdueIntervalDays),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Sommaire des rubriques (le numéro de chaque entrée est celui de sa section) ; l'équipe n'existe que pour le propriétaire.
  const rubriques = [
    { id: "agency-logo", cle: "logo" },
    { id: "agency-stamp", cle: "stamp" },
    { id: "agency-identite", cle: "identity" },
    { id: "agency-banque", cle: "bank" },
    { id: "agency-relances", cle: "reminders" },
    { id: "agency-conservation", cle: "retention" },
    { id: "agency-securite", cle: "security" },
    { id: "agency-2fa", cle: "twoFactor" },
    ...(estProprietaire ? [{ id: "agency-equipe", cle: "team" }] : []),
    { id: "agency-danger", cle: "danger" },
  ];
  const numero = (id: string) => String(rubriques.findIndex((r) => r.id === id) + 1).padStart(2, "0");

  const CHAMP = "w-full border border-slate-400 bg-white px-3.5 py-2 text-sm text-slate-900";
  const ETIQUETTE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
  const BOUTON_TRAIT =
    "cursor-pointer border border-slate-400 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:bg-slate-100 disabled:opacity-60";
  const BOUTON_ROSE =
    "cursor-pointer border border-rose-400 bg-white px-4 py-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60";

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.agencySettings.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.agencySettings.subtitle")}</p>
      </div>

      {loadError ? (
        // Le formulaire n'est PAS rendu tant que l'état initial est inconnu :
        // c'est ce qui empêche d'enregistrer du vide par-dessus des données
        // qu'on n'a simplement pas réussi à lire.
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{loadError}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-2 cursor-pointer text-xs font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[12.5rem_1fr]">
          {/* Sommaire : un lien par rubrique, collé en haut de l'écran quand on descend dans la page. */}
          <nav aria-label={t("manager.agencySettings.sections.index")} className="hidden self-start lg:sticky lg:top-6 lg:block">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.agencySettings.sections.index")}</p>
            <ol className="border-l border-slate-400">
              {rubriques.map((r) => (
                <li key={r.id}>
                  <a
                    href={`#${r.id}`}
                    className={`flex items-baseline gap-2.5 py-1.5 pl-3 text-xs transition-colors hover:text-orange-700 ${
                      r.cle === "danger" ? "text-rose-700" : "text-slate-800"
                    }`}
                  >
                    <span aria-hidden="true" className="font-mono text-[10px] text-slate-500">{numero(r.id)}</span>
                    {t(`manager.agencySettings.sections.${r.cle}`)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 space-y-6">
            {success && (
              <div role="status" className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-[inset_4px_0_0_var(--color-emerald-600)]">
                <CheckCircle2 size={15} aria-hidden="true" /> {t("manager.agencySettings.success")}
              </div>
            )}

            {error && (
              <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <SectionImageAgence ressource="logo" numero={numero("agency-logo")} url={logoUrl} onChange={setLogoUrl} />
            <SectionImageAgence ressource="stamp" numero={numero("agency-stamp")} url={stampUrl} onChange={setStampUrl} />

            <form onSubmit={handleSubmit} className="space-y-6">
              <SectionReglage id="agency-identite" numero={numero("agency-identite")} titre={t("manager.agencySettings.sections.identity")}>
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="agency-agencyName" className={ETIQUETTE}>
                        {t("manager.agencySettings.fields.agencyName")}
                      </label>
                      <input
                        id="agency-agencyName"
                        required
                        value={form.agencyName}
                        onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
                        placeholder={t("manager.agencySettings.fields.agencyNamePlaceholder")}
                        className={CHAMP}
                      />
                    </div>
                    <div>
                      <label htmlFor="agency-siretOrId" className={ETIQUETTE}>
                        {t("manager.agencySettings.fields.siretOrId")}
                      </label>
                      <input
                        id="agency-siretOrId"
                        value={form.siretOrId}
                        onChange={(e) => setForm({ ...form, siretOrId: e.target.value })}
                        placeholder={t("manager.agencySettings.fields.siretOrIdPlaceholder")}
                        className={CHAMP}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="agency-email" className={ETIQUETTE}>
                        {t("manager.agencySettings.fields.email")}
                      </label>
                      <input
                        id="agency-email"
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder={t("manager.agencySettings.fields.emailPlaceholder")}
                        className={CHAMP}
                      />
                    </div>
                    <div>
                      <label htmlFor="agency-phone" className={ETIQUETTE}>
                        {t("manager.agencySettings.fields.phone")}
                      </label>
                      <ChampTelephone id="agency-phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="agency-address" className={ETIQUETTE}>
                      {t("manager.agencySettings.fields.address")}
                    </label>
                    <input
                      id="agency-address"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      placeholder={t("manager.agencySettings.fields.addressPlaceholder")}
                      className={CHAMP}
                    />
                  </div>

                  <div>
                    <label htmlFor="agency-legalNotice" className={ETIQUETTE}>
                      {t("manager.agencySettings.fields.legalNotice")}
                    </label>
                    <textarea
                      id="agency-legalNotice"
                      rows={3}
                      value={form.legalNotice}
                      onChange={(e) => setForm({ ...form, legalNotice: e.target.value })}
                      placeholder={t("manager.agencySettings.fields.legalNoticePlaceholder")}
                      className={CHAMP}
                    />
                  </div>
                </div>
              </SectionReglage>

              <SectionReglage id="agency-banque" numero={numero("agency-banque")} titre={t("manager.agencySettings.fields.bankSectionTitle")}>
                <p className="mb-4 text-sm text-slate-600">{t("manager.agencySettings.fields.bankSectionHint")}</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="agency-iban" className={ETIQUETTE}>
                      {t("manager.agencySettings.fields.iban")}
                    </label>
                    <input
                      id="agency-iban"
                      value={form.iban}
                      onChange={(e) => setForm({ ...form, iban: e.target.value })}
                      placeholder={t("manager.agencySettings.fields.ibanPlaceholder")}
                      className={`${CHAMP} font-mono`}
                    />
                  </div>
                  <div>
                    <label htmlFor="agency-bic" className={ETIQUETTE}>
                      {t("manager.agencySettings.fields.bic")}
                    </label>
                    <input
                      id="agency-bic"
                      value={form.bic}
                      onChange={(e) => setForm({ ...form, bic: e.target.value })}
                      placeholder={t("manager.agencySettings.fields.bicPlaceholder")}
                      className={`${CHAMP} font-mono`}
                    />
                  </div>
                </div>
              </SectionReglage>

              <SectionReglage id="agency-relances" numero={numero("agency-relances")} titre={t("manager.agencySettings.overdue.title")}>
                <fieldset className="space-y-3">
                  {/* Le titre de la rubrique est celui de la section ; la légende reste pour les lecteurs d'écran. */}
                  <legend className="sr-only">{t("manager.agencySettings.overdue.title")}</legend>
                  <p className="text-sm text-slate-600">{t("manager.agencySettings.overdue.hint")}</p>
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.overdueRemindersEnabled}
                      onChange={(e) => setForm({ ...form, overdueRemindersEnabled: e.target.checked })}
                    />
                    {t("manager.agencySettings.overdue.enabled")}
                  </label>
                  {form.overdueRemindersEnabled && (
                    <>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="agency-grace" className={ETIQUETTE}>
                            {t("manager.agencySettings.overdue.grace")}
                          </label>
                          <input
                            id="agency-grace"
                            type="number"
                            min={0}
                            max={30}
                            value={form.overdueGraceDays}
                            onChange={(e) => setForm({ ...form, overdueGraceDays: e.target.value })}
                            className={CHAMP}
                          />
                        </div>
                        <div>
                          <label htmlFor="agency-interval" className={ETIQUETTE}>
                            {t("manager.agencySettings.overdue.interval")}
                          </label>
                          <input
                            id="agency-interval"
                            type="number"
                            min={3}
                            max={30}
                            value={form.overdueIntervalDays}
                            onChange={(e) => setForm({ ...form, overdueIntervalDays: e.target.value })}
                            className={CHAMP}
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={form.overdueNotifyGuarantors}
                          onChange={(e) => setForm({ ...form, overdueNotifyGuarantors: e.target.checked })}
                        />
                        {t("manager.agencySettings.overdue.guarantors")}
                      </label>
                      <p role="status" className="border-l-2 border-orange-700 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
                        {t("manager.agencySettings.overdue.schedule", calendrierRelances(form.overdueGraceDays, form.overdueIntervalDays))}
                      </p>
                    </>
                  )}
                </fieldset>
              </SectionReglage>

              {/* Barre d'enregistrement collée en bas de l'écran tant que le formulaire est à l'écran. */}
              <div className="sticky bottom-0 z-10 flex justify-end border border-slate-300 bg-white px-5 py-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="cursor-pointer border border-ink-900 bg-ink-900 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
                >
                  {saving ? t("manager.agencySettings.saving") : t("manager.agencySettings.save")}
                </button>
              </div>
            </form>

            <SectionReglage id="agency-conservation" numero={numero("agency-conservation")} titre={t("manager.agencySettings.retention.title")}>
              <p className="text-sm text-slate-600">{t("manager.agencySettings.retention.description")}</p>
              {echeancesError && (
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {echeancesError}
                </p>
              )}
              {echeances && echeances.total === 0 && <p className="mt-3 text-sm text-slate-600">{t("manager.agencySettings.retention.none")}</p>}
              {echeances && echeances.total > 0 && (
                <>
                  <ul className="mt-4 space-y-2">
                    {echeances.fichesSansBail.map((fiche) => (
                      <li key={fiche.id} className="border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-[inset_3px_0_0_var(--color-orange-700)]">
                        <span className="font-semibold">
                          {fiche.firstName} {fiche.lastName}
                        </span>{" "}
                        — {t("manager.agencySettings.retention.noBail", { days: echeances.durees.ficheSansBailJours })}
                      </li>
                    ))}
                    {echeances.bauxClosDepuisLongtemps.map((fiche) => (
                      <li key={fiche.id} className="border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-[inset_3px_0_0_var(--color-orange-700)]">
                        <span className="font-semibold">
                          {fiche.firstName} {fiche.lastName}
                        </span>{" "}
                        —{" "}
                        {t("manager.agencySettings.retention.leaseEnded", {
                          years: Math.round(echeances.durees.apresFinDeBailJours / 365),
                        })}
                      </li>
                    ))}
                    {echeances.leadsAnciens.map((lead) => (
                      <li key={lead.id} className="border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-[inset_3px_0_0_var(--color-orange-700)]">
                        <span className="font-semibold">{lead.prospectName}</span>{" "}
                        —{" "}
                        {t("manager.agencySettings.retention.oldLead", {
                          years: Math.round(echeances.durees.leadProspectionJours / 365),
                        })}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(echeances.fichesSansBail.length > 0 || echeances.bauxClosDepuisLongtemps.length > 0) && (
                      <button type="button" onClick={() => navigate("/tenants")} className={BOUTON_TRAIT}>
                        {t("manager.agencySettings.retention.seeTenants")}
                      </button>
                    )}
                    {echeances.leadsAnciens.length > 0 && (
                      <button type="button" onClick={() => navigate("/leads")} className={BOUTON_TRAIT}>
                        {t("manager.agencySettings.retention.seeLeads")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </SectionReglage>

            {/*
              Fermer toutes les sessions est le seul recours quand on soupçonne
              qu'un jeton circule — ordinateur partagé, téléphone perdu. La demande
              invalide aussi la session courante (voir logoutAllDevices côté
              backend), d'où la déconnexion locale immédiate qui suit.
            */}
            <SectionReglage id="agency-securite" numero={numero("agency-securite")} titre={t("manager.agencySettings.security.title")}>
              <p className="text-sm text-slate-600">{t("manager.agencySettings.security.description")}</p>
              {logoutAllError && (
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {logoutAllError}
                </p>
              )}
              <Bulle texte={t("manager.tips.agencyLogoutAll")}>
                <button type="button" onClick={handleLogoutAll} disabled={loggingOutAll} className={`mt-4 ${BOUTON_TRAIT}`}>
                  {loggingOutAll ? t("manager.agencySettings.security.logoutAllPending") : t("manager.agencySettings.security.logoutAllButton")}
                </button>
              </Bulle>
            </SectionReglage>

            {/*
              Un geste par compte de connexion, pas par agence : un collaborateur
              (voir team.controller.ts) active/désactive SA PROPRE 2FA ici, jamais
              celle du propriétaire — c'est pourquoi cette carte n'est pas réservée
              à `estProprietaire`, contrairement à la gestion de l'équipe ci-dessous.
            */}
            <SectionReglage id="agency-2fa" numero={numero("agency-2fa")} titre={t("manager.agencySettings.twoFactor.title")}>
              <p className="text-sm text-slate-600">{t("manager.agencySettings.twoFactor.description")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {user?.twoFactorEnabled ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                      <CheckCircle2 size={14} /> {t("manager.agencySettings.twoFactor.enabled")}
                    </span>
                    <Bulle texte={t("manager.tips.agencyTwoFactorDisable")}>
                      <button type="button" onClick={() => setShowTwoFactorDisable(true)} className={BOUTON_ROSE}>
                        {t("manager.agencySettings.twoFactor.disableButton")}
                      </button>
                    </Bulle>
                  </>
                ) : (
                  <Bulle texte={t("manager.tips.agencyTwoFactorEnable")}>
                    <button type="button" onClick={() => setShowTwoFactorSetup(true)} className={BOUTON_TRAIT}>
                      {t("manager.agencySettings.twoFactor.enableButton")}
                    </button>
                  </Bulle>
                )}
              </div>
            </SectionReglage>

            {showTwoFactorSetup && <TwoFactorSetupModal onSuccess={handleTwoFactorEnabled} onClose={() => setShowTwoFactorSetup(false)} />}
            {showTwoFactorDisable && <TwoFactorDisableModal onSuccess={handleTwoFactorDisabled} onClose={() => setShowTwoFactorDisable(false)} />}

            {estProprietaire && (
              <SectionReglage id="agency-equipe" numero={numero("agency-equipe")} titre={t("manager.agencySettings.team.title")}>
                <p className="text-sm text-slate-600">{t("manager.agencySettings.team.description")}</p>

                {!formuleEntreprise ? (
                  <div className="mt-4 border-l-2 border-orange-700 bg-slate-50 p-4 text-sm text-slate-700">
                    <p>{t("manager.agencySettings.team.upsell")}</p>
                    <Link to="/subscription" className="mt-1 inline-block border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
                      {t("manager.agencySettings.team.upsellCta")}
                    </Link>
                  </div>
                ) : (
                  <>
                    {teamError && (
                      <p className="mt-3 text-sm text-red-600" role="alert">
                        {teamError}
                      </p>
                    )}

                    <Bulle texte={t("manager.tips.agencyTeamInvite")}>
                      <form onSubmit={handleInvite} className="mt-4 flex flex-wrap items-end gap-2">
                        <div className="min-w-[220px] flex-1">
                          <label htmlFor="team-invite-email" className={ETIQUETTE}>
                            {t("manager.agencySettings.team.emailLabel")}
                          </label>
                          <input
                            id="team-invite-email"
                            type="email"
                            required
                            maxLength={254}
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder={t("manager.agencySettings.team.emailPlaceholder")}
                            className={CHAMP}
                          />
                        </div>
                        <div className="min-w-[180px]">
                          <label htmlFor="team-invite-role" className={ETIQUETTE}>
                            {t("manager.agencySettings.team.roleLabel")}
                          </label>
                          <select
                            id="team-invite-role"
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                            className={CHAMP}
                          >
                            {ROLES_EQUIPE.map((r) => (
                              <option key={r} value={r}>
                                {t(`manager.agencySettings.team.roles.${r}.label`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="submit"
                          disabled={inviting}
                          className="cursor-pointer border border-ink-900 bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
                        >
                          {inviting ? t("manager.agencySettings.team.inviting") : t("manager.agencySettings.team.inviteButton")}
                        </button>
                      </form>
                    </Bulle>
                    <p className="mt-2 text-xs text-slate-600">{t(`manager.agencySettings.team.roles.${inviteRole}.description`)}</p>
                    {inviteError && (
                      <p className="mt-2 text-sm text-red-600" role="alert">
                        {inviteError}
                      </p>
                    )}
                    {inviteSuccess && (
                      <p role="status" className="mt-2 text-sm text-emerald-700">
                        {inviteSuccess}
                      </p>
                    )}

                    {teamMembers.length === 0 ? (
                      <p className="mt-4 text-sm text-slate-600">{t("manager.agencySettings.team.empty")}</p>
                    ) : (
                      <ul className="mt-4 divide-y divide-slate-300 border border-slate-300 px-4">
                        {teamMembers.map((member) => (
                          <MembreEquipe key={member.id} member={member} onChangeRole={handleChangeRole} onRemove={handleRemove} onResend={handleResend} />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </SectionReglage>
            )}

            <SectionReglage id="agency-danger" numero={numero("agency-danger")} titre={t("manager.agencySettings.dangerZone.title")} danger>
              <p className="text-sm text-slate-600">{t("manager.agencySettings.dangerZone.description")}</p>
              <Bulle texte={t("manager.tips.agencyDeleteAccount")}>
                <button type="button" onClick={() => setShowDeleteModal(true)} className={`mt-4 ${BOUTON_ROSE}`}>
                  {t("manager.agencySettings.dangerZone.deleteButton")}
                </button>
              </Bulle>
            </SectionReglage>

            {showDeleteModal && <DeleteAccountModal onSuccess={handleAccountDeleted} onClose={() => setShowDeleteModal(false)} />}
          </div>
        </div>
      )}
    </div>
  );
}
