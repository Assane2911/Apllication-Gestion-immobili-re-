import { Moon, Sun } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CurrencySelector } from "../context/CurrencyContext";
import { useTheme } from "../context/ThemeContext";

const navItems = [
  { to: "/portail", label: "Mon logement", icon: "🏠" },
  { to: "/portail/paiements", label: "Mes loyers", icon: "💳" },
  { to: "/portail/messages", label: "Messagerie", icon: "💬" },
  { to: "/portail/incidents", label: "Signaler un problème", icon: "📷" },
];

export default function TenantLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-slate-900 dark:text-slate-100">Espace locataire</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{user?.tenantName ?? user?.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <CurrencySelector />
            <button
              onClick={toggleTheme}
              className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors"
              title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
              aria-label="Basculer le thème clair/sombre"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={logout} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline">
              Se déconnecter
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
              {item.icon} {item.label}
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
