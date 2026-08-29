import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CurrencySelector } from "../context/CurrencyContext";
import TrialBanner from "./TrialBanner";

const navItems = [
  { to: "/", label: "Tableau de bord", icon: "📊" },
  { to: "/properties", label: "Biens", icon: "🏠" },
  { to: "/tenants", label: "Locataires", icon: "👥" },
  { to: "/contracts", label: "Contrats", icon: "📄" },
  { to: "/invoices", label: "Paiements", icon: "💳" },
  { to: "/issues", label: "Incidents", icon: "🛠️" },
  { to: "/subscription", label: "Mon Abonnement", icon: "💎" },
];

export default function ManagerLayout() {
  const { user, logout } = useAuth();
  const sub = user?.subscription;

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col shrink-0">
        <div className="px-5 py-6 border-b border-slate-800">
          <h1 className="text-lg font-semibold">Gestion Immobilière</h1>
          <p className="text-xs text-slate-400 mt-1">Espace gestionnaire</p>
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
        <nav className="flex-1 px-3 py-4 space-y-1">
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
      <main className="flex-1 min-w-0 p-6 lg:p-8">
        <TrialBanner />
        <Outlet />
      </main>
    </div>
  );
}
