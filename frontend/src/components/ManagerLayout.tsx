import { Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CurrencySelector } from "../context/CurrencyContext";
import { useTheme } from "../context/ThemeContext";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import TrialBanner from "./TrialBanner";

const navItems = [
  { to: "/", label: "Tableau de bord", icon: "📊" },
  { to: "/properties", label: "Biens", icon: "🏠" },
  { to: "/tenants", label: "Locataires", icon: "👥" },
  { to: "/contracts", label: "Contrats", icon: "📄" },
  { to: "/invoices", label: "Paiements", icon: "💳" },
  { to: "/expenses", label: "Dépenses & Rentabilité", icon: "💰" },
  { to: "/messages", label: "Messagerie", icon: "💬" },
  { to: "/issues", label: "Incidents", icon: "🛠️" },
  { to: "/activity-log", label: "Journal d'activité", icon: "🕒" },
  { to: "/agency", label: "Mon Agence", icon: "🏢" },
  { to: "/subscription", label: "Mon Abonnement", icon: "💎" },
];

export default function ManagerLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const sub = user?.subscription;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-30 sm:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed sm:static inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-100 flex flex-col shrink-0 overflow-y-auto transform transition-transform duration-200 ease-in-out ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } sm:translate-x-0`}
      >
        <div className="px-5 py-6 border-b border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src="/app-icon.png" alt="Logo" className="w-9 h-9 rounded-xl shadow-md" />
              <div>
                <h1 className="text-sm font-bold leading-tight">ImmoPlatform Pro</h1>
                <p className="text-[11px] text-slate-400">Espace gestionnaire</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={toggleTheme}
                className="shrink-0 w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
                aria-label="Basculer le thème clair/sombre"
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                aria-label="Fermer le menu"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {sub?.isTrialActive && (
            <div className="mt-2.5 bg-brand-900/60 border border-brand-500/30 rounded-lg px-2.5 py-1 text-[11px] text-brand-200 flex items-center justify-between">
              <span>Essai gratuit</span>
              <span className="font-bold text-white">{sub.trialDaysRemaining} j</span>
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-slate-800">
            <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
              Monnaie de règlement
            </label>
            <CurrencySelector className="w-full" />
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1" onClick={() => setMobileNavOpen(false)}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-800 text-sm">
          <p className="text-slate-300 truncate">{user?.email}</p>
          <button onClick={logout} className="mt-2 text-xs text-slate-400 hover:text-white underline">
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="sm:hidden shrink-0 w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300"
            aria-label="Ouvrir le menu"
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
