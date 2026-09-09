import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";
import { useAuth } from "../context/auth";
import { useTheme } from "../context/theme";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * Layout minimal pour l'espace administration de la plateforme (distinct du
 * gestionnaire/locataire) : pas de barre de navigation à onglets, une seule
 * page pour l'instant (validation des virements bancaires en attente).
 */
export default function AdminLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-slate-900 dark:text-slate-100">{t("components.adminLayout.title")}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              onClick={toggleTheme}
              className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors"
              title={theme === "dark" ? t("common.theme.toLight") : t("common.theme.toDark")}
              aria-label={t("common.theme.toggleAria")}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={logout} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline">
              {t("nav.logout")}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
