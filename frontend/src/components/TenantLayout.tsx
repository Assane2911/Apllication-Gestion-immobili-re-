import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CurrencySelector } from "../context/CurrencyContext";

const navItems = [
  { to: "/portail", label: "Mon logement", icon: "🏠" },
  { to: "/portail/paiements", label: "Mes loyers", icon: "💳" },
  { to: "/portail/messages", label: "Messagerie", icon: "💬" },
  { to: "/portail/incidents", label: "Signaler un problème", icon: "📷" },
];

export default function TenantLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-slate-900">Espace locataire</h1>
            <p className="text-xs text-slate-500">{user?.tenantName ?? user?.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <CurrencySelector />
            <button onClick={logout} className="text-xs text-slate-500 hover:text-slate-800 underline">
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
                  isActive ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
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
