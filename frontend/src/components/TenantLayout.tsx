import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CurrencySelector } from "../context/CurrencyContext";
import { useTheme } from "../context/ThemeContext";
import LanguageSwitcher from "./LanguageSwitcher";

const navItems = [
  { to: "/portail", key: "home", icon: "🏠" },
  { to: "/portail/paiements", key: "payments", icon: "💳" },
  { to: "/portail/messages", key: "messages", icon: "💬" },
  { to: "/portail/incidents", key: "issues", icon: "📷" },
] as const;

export default function TenantLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-slate-900 dark:text-slate-100">{t("components.tenantLayout.title")}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{user?.tenantName ?? user?.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <CurrencySelector />
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
        <div className="max-w-4xl mx-auto px-4 flex gap-1 pb-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`
              }
            >
              {item.icon} {t(`nav.tenant.${item.key}`)}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
