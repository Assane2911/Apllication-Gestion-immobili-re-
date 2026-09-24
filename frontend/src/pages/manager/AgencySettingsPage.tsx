import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import ChampTelephone from "../../components/ChampTelephone";
import DeleteAccountModal from "../../components/DeleteAccountModal";
import { useAuth } from "../../context/auth";
import type { AgencySettings, RetentionEcheances } from "../../types";

export default function AgencySettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  function handleAccountDeleted() {
    logout();
    navigate("/login", { replace: true });
  }

  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState("");

  async function handleLogoutAll() {
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
  });

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
        });
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await api.put<AgencySettings>("/agency", form);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.agencySettings.title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t("manager.agencySettings.subtitle")}
        </p>
      </div>

      {loadError ? (
        // Le formulaire n'est PAS rendu tant que l'état initial est inconnu :
        // c'est ce qui empêche d'enregistrer du vide par-dessus des données
        // qu'on n'a simplement pas réussi à lire.
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300 text-sm px-4 py-3 rounded-xl">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-xs font-semibold underline"
          >
            {t("common.actions.retry")}
          </button>
        </div>
      ) : (
      <>
      {success && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <span>✅</span> {t("manager.agencySettings.success")}
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="agency-agencyName" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("manager.agencySettings.fields.agencyName")}
              </label>
              <input
                id="agency-agencyName"
                required
                value={form.agencyName}
                onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
                placeholder={t("manager.agencySettings.fields.agencyNamePlaceholder")}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label htmlFor="agency-siretOrId" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("manager.agencySettings.fields.siretOrId")}
              </label>
              <input
                id="agency-siretOrId"
                value={form.siretOrId}
                onChange={(e) => setForm({ ...form, siretOrId: e.target.value })}
                placeholder={t("manager.agencySettings.fields.siretOrIdPlaceholder")}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="agency-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("manager.agencySettings.fields.email")}
              </label>
              <input
                id="agency-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={t("manager.agencySettings.fields.emailPlaceholder")}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label htmlFor="agency-phone" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("manager.agencySettings.fields.phone")}
              </label>
              <ChampTelephone id="agency-phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
          </div>

          <div>
            <label htmlFor="agency-address" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t("manager.agencySettings.fields.address")}
            </label>
            <input
              id="agency-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder={t("manager.agencySettings.fields.addressPlaceholder")}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="md:col-span-2">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {t("manager.agencySettings.fields.bankSectionTitle")}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t("manager.agencySettings.fields.bankSectionHint")}
              </p>
            </div>
            <div>
              <label htmlFor="agency-iban" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("manager.agencySettings.fields.iban")}
              </label>
              <input
                id="agency-iban"
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value })}
                placeholder={t("manager.agencySettings.fields.ibanPlaceholder")}
                className="w-full text-sm font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="agency-bic" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("manager.agencySettings.fields.bic")}
              </label>
              <input
                id="agency-bic"
                value={form.bic}
                onChange={(e) => setForm({ ...form, bic: e.target.value })}
                placeholder={t("manager.agencySettings.fields.bicPlaceholder")}
                className="w-full text-sm font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="agency-legalNotice" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t("manager.agencySettings.fields.legalNotice")}
            </label>
            <textarea
              id="agency-legalNotice"
              rows={3}
              value={form.legalNotice}
              onChange={(e) => setForm({ ...form, legalNotice: e.target.value })}
              placeholder={t("manager.agencySettings.fields.legalNoticePlaceholder")}
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-6 py-2.5 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              {saving ? t("manager.agencySettings.saving") : t("manager.agencySettings.save")}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          {t("manager.agencySettings.retention.title")}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          {t("manager.agencySettings.retention.description")}
        </p>
        {echeancesError && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-3" role="alert">
            {echeancesError}
          </p>
        )}
        {echeances && echeances.total === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
            {t("manager.agencySettings.retention.none")}
          </p>
        )}
        {echeances && echeances.total > 0 && (
          <>
            <ul className="mt-4 space-y-2">
              {echeances.fichesSansBail.map((fiche) => (
                <li key={fiche.id} className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-semibold">
                    {fiche.firstName} {fiche.lastName}
                  </span>{" "}
                  — {t("manager.agencySettings.retention.noBail", { days: echeances.durees.ficheSansBailJours })}
                </li>
              ))}
              {echeances.bauxClosDepuisLongtemps.map((fiche) => (
                <li key={fiche.id} className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-semibold">
                    {fiche.firstName} {fiche.lastName}
                  </span>{" "}
                  —{" "}
                  {t("manager.agencySettings.retention.leaseEnded", {
                    years: Math.round(echeances.durees.apresFinDeBailJours / 365),
                  })}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => navigate("/tenants")}
              className="mt-4 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
            >
              {t("manager.agencySettings.retention.seeTenants")}
            </button>
          </>
        )}
      </div>

      {/*
        Fermer toutes les sessions est le seul recours quand on soupçonne
        qu'un jeton circule — ordinateur partagé, téléphone perdu. La demande
        invalide aussi la session courante (voir logoutAllDevices côté
        backend), d'où la déconnexion locale immédiate qui suit.
      */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          {t("manager.agencySettings.security.title")}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          {t("manager.agencySettings.security.description")}
        </p>
        {logoutAllError && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-3" role="alert">
            {logoutAllError}
          </p>
        )}
        <button
          type="button"
          onClick={handleLogoutAll}
          disabled={loggingOutAll}
          className="mt-4 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
        >
          {loggingOutAll
            ? t("manager.agencySettings.security.logoutAllPending")
            : t("manager.agencySettings.security.logoutAllButton")}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-900/50 shadow-sm p-6">
        <h3 className="text-sm font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">
          {t("manager.agencySettings.dangerZone.title")}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          {t("manager.agencySettings.dangerZone.description")}
        </p>
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="mt-4 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
        >
          {t("manager.agencySettings.dangerZone.deleteButton")}
        </button>
      </div>

      {showDeleteModal && (
        <DeleteAccountModal onSuccess={handleAccountDeleted} onClose={() => setShowDeleteModal(false)} />
      )}
      </>
      )}
    </div>
  );
}
