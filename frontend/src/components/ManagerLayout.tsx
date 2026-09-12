import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/auth";
import { CurrencySelector } from "../context/CurrencyContext";
import { useTheme } from "../context/theme";
import GlobalSearch from "./GlobalSearch";
import LanguageSwitcher from "./LanguageSwitcher";
import NotificationBell from "./NotificationBell";
import TrialBanner from "./TrialBanner";

const navItems = [
  { to: "/dashboard", key: "dashboard", icon: "📊" },
  { to: "/properties", key: "properties", icon: "🏠" },
  { to: "/tenants", key: "tenants", icon: "👥" },
  { to: "/contracts", key: "contracts", icon: "📄" },
  { to: "/invoices", key: "invoices", icon: "💳" },
  { to: "/expenses", key: "expenses", icon: "💰" },
  { to: "/messages", key: "messages", icon: "💬" },
  { to: "/issues", key: "issues", icon: "🛠️" },
  { to: "/activity-log", key: "activityLog", icon: "🕒" },
  { to: "/agency", key: "agency", icon: "🏢" },
  { to: "/subscription", key: "subscription", icon: "💎" },
] as const;

export default function ManagerLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const sub = user?.subscription;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-30 sm:hidden transition-opacity"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed sm:sticky inset-y-0 sm:top-0 left-0 z-40 w-64 h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 border-r border-slate-800/80 flex flex-col shrink-0 shadow-xl transform transition-transform duration-200 ease-in-out ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } sm:translate-x-0`}
      >
        <div className="shrink-0 px-5 py-5 border-b border-slate-800/80">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow-md shadow-brand-900/30" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm font-bold leading-tight truncate">{t("common.appName")}</h1>
                </div>
                <p className="text-[11px] text-slate-400 truncate">{t("components.managerLayout.subtitle")}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={toggleTheme}
                className="shrink-0 w-8 h-8 rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
                title={theme === "dark" ? t("common.theme.toLight") : t("common.theme.toDark")}
                aria-label={t("common.theme.toggleAria")}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
                aria-label={t("components.managerLayout.closeMenuAria")}
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {sub?.isTrialActive && (
            <div className="mt-3 bg-gradient-to-r from-brand-950/80 to-slate-900 border border-brand-500/30 rounded-lg px-3 py-1.5 text-[11px] text-brand-200 flex items-center justify-between shadow-2xs">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-400" />
                </span>
                <span>{t("components.managerLayout.trialFree")}</span>
              </div>
              <span className="font-bold text-white bg-brand-600/40 px-1.5 py-0.5 rounded text-[10px]">{sub.trialDaysRemaining} j</span>
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-slate-800/80">
            <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
              {t("nav.currencyLabel")}
            </label>
            <CurrencySelector className="w-full [&>select]:w-full" />
          </div>
          <div className="mt-2">
            <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
              {t("common.language.label")}
            </label>
            <LanguageSwitcher className="w-full [&>select]:w-full" />
          </div>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1" onClick={() => setMobileNavOpen(false)}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium shadow-xs shadow-brand-500/25"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              <span className="truncate">{t(`nav.manager.${item.key}`)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0 px-4 py-4 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-2.5 min-w-0 p-1.5 rounded-xl bg-slate-900/50 border border-slate-800/60">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm">
              {(user?.email?.[0] || "?").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-200 font-medium truncate">{user?.email}</p>
              <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                {t("nav.manager.dashboard")}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-2.5 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 bg-slate-900/40 border border-slate-800 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 transition-all cursor-pointer"
          >
            <LogOut size={13} />
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="sm:hidden shrink-0 w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            aria-label={t("components.managerLayout.openMenuAria")}
          >
            <Menu size={18} />
          </button>
          <GlobalSearch />
          <NotificationBell />
        </div>
        <TrialBanner />
        <Outlet />
      </main>
    </div>
  );
}
