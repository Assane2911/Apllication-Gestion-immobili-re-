import {
  Briefcase,
  Building2,
  ClipboardCheck,
  CreditCard,
  FileText,
  Gem,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Moon,
  PhoneCall,
  Receipt,
  Sun,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import Bulle from "./Bulle";
import { useAuth } from "../context/auth";
import { CurrencySelector } from "../context/CurrencyContext";
import { useTheme } from "../context/theme";
import GlobalSearch from "./GlobalSearch";
import LanguageSwitcher from "./LanguageSwitcher";
import NotificationBell from "./NotificationBell";
import TrialBanner from "./TrialBanner";
import BoutonSuggestion from "./BoutonSuggestion";

const navItems = [
  { to: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { to: "/properties", key: "properties", icon: Home },
  { to: "/tenants", key: "tenants", icon: Users },
  { to: "/proprietaires", key: "owners", icon: Briefcase },
  { to: "/contracts", key: "contracts", icon: FileText },
  { to: "/etats-des-lieux", key: "inspections", icon: ClipboardCheck },
  { to: "/invoices", key: "invoices", icon: CreditCard },
  { to: "/annonces", key: "listings", icon: Megaphone },
  { to: "/leads", key: "leads", icon: PhoneCall },
  { to: "/expenses", key: "expenses", icon: Wallet },
  { to: "/bilan-fiscal", key: "fiscal", icon: Receipt },
  { to: "/messages", key: "messages", icon: MessageCircle },
  { to: "/issues", key: "issues", icon: Wrench },
  { to: "/activity-log", key: "activityLog", icon: History },
  { to: "/agency", key: "agency", icon: Building2 },
  { to: "/subscription", key: "subscription", icon: Gem },
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
        className={`fixed sm:sticky inset-y-0 sm:top-0 left-0 z-40 w-64 h-screen bg-gradient-to-b from-ink-950 via-ink-900 to-ink-950 text-slate-100 border-r border-ink-700/80 flex flex-col shrink-0 shadow-xl transform transition-transform duration-200 ease-in-out ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } sm:translate-x-0`}
      >
        <div className="shrink-0 px-5 py-5 border-b border-ink-700/80">
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
              <Bulle texte={t("common.theme.tip")} className="contents">
              <button
                onClick={toggleTheme}
                className="shrink-0 w-8 h-8 rounded-lg bg-ink-800/70 hover:bg-ink-800 border border-ink-700/80 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
                aria-label={t("common.theme.toggleAria")}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              </Bulle>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-ink-800/70 hover:bg-ink-800 border border-ink-700/80 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
                aria-label={t("components.managerLayout.closeMenuAria")}
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {sub?.isTrialActive && (
            <div className="mt-3 bg-gradient-to-r from-brand-950/80 to-ink-900 border border-brand-500/30 rounded-lg px-3 py-1.5 text-[11px] text-brand-200 flex items-center justify-between shadow-2xs">
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
          <div className="mt-3 pt-3 border-t border-ink-700/80">
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
            // La bulle s'ouvre à DROITE : dans une barre latérale, au-dessus
            // recouvrirait l'entrée précédente, c'est-à-dire une autre cible
            // cliquable.
            <Bulle key={item.to} texte={t(`nav.tips.${item.key}`)} position="droite" className="block">
            <NavLink
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium shadow-xs shadow-brand-500/25"
                    : "text-slate-300 hover:bg-ink-800/60 hover:text-white"
                }`
              }
            >
              <item.icon size={17} strokeWidth={1.9} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{t(`nav.manager.${item.key}`)}</span>
            </NavLink>
            </Bulle>
          ))}
        </nav>
        <div className="shrink-0 px-4 py-4 border-t border-ink-700/80 bg-ink-950/40">
          <div className="flex items-center gap-2.5 min-w-0 p-1.5 rounded-xl bg-ink-900/50 border border-ink-700/60">
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
            className="mt-2.5 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 bg-ink-900/40 border border-ink-700 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 transition-all cursor-pointer"
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

      {/* Une idée arrive en travaillant, devant l'écran qui la provoque :
          le bouton est donc présent sur tout l'espace, pas rangé dans une
          page de contact. */}
      <BoutonSuggestion />
    </div>
  );
}
