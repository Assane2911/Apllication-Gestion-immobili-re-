import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import type { PlatformSettings } from "../../types";

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({ iban: "", bic: "" });

  useEffect(() => {
    // Même correctif que les paramètres d'agence : un chargement échoué
    // affichait un RIB vide, qu'un enregistrement aurait écrasé. Celui-ci est
    // le compte sur lequel les gestionnaires virent leurs abonnements.
    api
      .get<PlatformSettings>("/admin/settings")
      .then((res) => {
        setForm({
          iban: res.data.iban || "",
          bic: res.data.bic || "",
        });
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await api.put<PlatformSettings>("/admin/settings", form);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("admin.settings.title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("admin.settings.subtitle")}</p>
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
          <span>✅</span> {t("admin.settings.success")}
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
              <label htmlFor="platform-iban" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("admin.settings.fields.iban")}
              </label>
              <input
                id="platform-iban"
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value })}
                placeholder={t("admin.settings.fields.ibanPlaceholder")}
                className="w-full text-sm font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label htmlFor="platform-bic" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("admin.settings.fields.bic")}
              </label>
              <input
                id="platform-bic"
                value={form.bic}
                onChange={(e) => setForm({ ...form, bic: e.target.value })}
                placeholder={t("admin.settings.fields.bicPlaceholder")}
                className="w-full text-sm font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-6 py-2.5 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              {saving ? t("admin.settings.saving") : t("admin.settings.save")}
            </button>
          </div>
        </form>
      </div>
      </>
      )}
    </div>
  );
}
