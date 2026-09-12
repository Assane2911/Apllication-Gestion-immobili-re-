import { LogOut, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/auth";
import { CurrencySelector } from "../context/CurrencyContext";
import { useTheme } from "../context/theme";
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
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 shadow-2xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold shadow-xs shadow-brand-500/20">
              <img src="/app-icon.png" alt="Logo" className="w-full h-full object-cover rounded-xl" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight">
                  {t("components.tenantLayout.title")}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-200/60 dark:border-brand-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Espace résident
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {user?.tenantName ?? user?.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5">
            <LanguageSwitcher />
            <CurrencySelector />
            <button
              onClick={toggleTheme}
              className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
              title={theme === "dark" ? t("common.theme.toLight") : t("common.theme.toDark")}
              aria-label={t("common.theme.toggleAria")}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-transparent hover:border-rose-200 dark:hover:border-rose-500/20 transition-all cursor-pointer"
              title={t("nav.logout")}
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">{t("nav.logout")}</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-1.5 pb-2.5 overflow-x-auto no-scrollbar">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-150 flex items-center gap-1.5 shrink-0 ${
                  isActive
                    ? "bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-xs shadow-brand-500/25 font-semibold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{t(`nav.tenant.${item.key}`)}</span>
            </NavLink>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
