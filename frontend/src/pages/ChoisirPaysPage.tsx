import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import SelecteurPays from "../components/SelecteurPays";
import { useAuth } from "../context/auth";
import { useTheme } from "../context/theme";
import { useConfirmationDeconnexion } from "../hooks/useConfirmationDeconnexion";
import { homePathForRole } from "../utils/roleHome";

/**
 * Choix du pays de l'agence, pour un gestionnaire qui n'en a pas encore : compte créé par « Se connecter avec Google »
 * (qui n'a pas de formulaire où le demander), ou d'avant ce champ. Le pays fixe les règles de location appliquées à
 * l'agence et la devise du compte ; il se choisit une seule fois (le serveur refuse un second choix, voir
 * updateCountry côté backend). ProtectedRoute envoie ici tout gestionnaire dont le pays est `null`.
 */
export default function ChoisirPaysPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { demanderDeconnexion, dialogue } = useConfirmationDeconnexion();
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Déjà choisi (retour sur cette adresse, ou onglet resté ouvert) : rien à demander.
  if (user?.country) return <Navigate to={homePathForRole("MANAGER")} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!country) {
      setError(t("auth.register.countryRequiredError"));
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/country", { country });
      // Le profil en mémoire n'a pas le pays tant qu'il n'est pas relu : sans cela, ProtectedRoute renverrait ici.
      const profil = await refreshUser();
      if (!profil?.country) {
        setError(t("auth.countryChoice.reloadError"));
        return;
      }
      navigate(homePathForRole("MANAGER"), { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950 flex flex-col items-center justify-center px-6 py-12 relative">
      <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
        <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow" />
        <LanguageSwitcher variant={theme === "dark" ? "dark" : "light"} />
      </div>

      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center">{t("auth.countryChoice.title")}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 text-center mt-1.5">{t("auth.countryChoice.subtitle")}</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="choix-pays" className="block text-xs font-medium text-slate-700 dark:text-slate-400 mb-1.5">
              {t("auth.countryChoice.label")}
            </label>
            <SelecteurPays
              id="choix-pays"
              value={country}
              onChange={setCountry}
              placeholder={t("auth.countryChoice.placeholder")}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
            />
            <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">{t("auth.countryChoice.warning")}</p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-semibold shadow-lg shadow-brand-600/30 transition-colors cursor-pointer"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? t("auth.countryChoice.submitting") : t("auth.countryChoice.submit")}
          </button>
        </form>

        <button
          type="button"
          onClick={demanderDeconnexion}
          className="mt-6 w-full text-center text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
        >
          {t("nav.logout")}
        </button>
      </main>
      {dialogue}
    </div>
  );
}
