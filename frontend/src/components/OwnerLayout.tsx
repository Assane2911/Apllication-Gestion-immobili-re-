import { LayoutDashboard, Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import EnteteEspace from "./EnteteEspace";
import BoutonSuggestion from "./BoutonSuggestion";

const navItems = [
  { to: "/proprietaire", key: "home", icon: LayoutDashboard },
  { to: "/proprietaire/crg", key: "crg", icon: Receipt },
] as const;

/**
 * Coquille de l'Espace propriétaire — même structure que TenantLayout.tsx
 * (header sticky, sélecteurs langue/devise, thème, déconnexion). Deux entrées
 * de navigation : le résumé financier en lecture seule (périmètre initial),
 * et le CRG mensuel (compte-rendu de gestion, ajouté ensuite) — toujours pas
 * un portail à onglets multiples au sens large.
 */
export default function OwnerLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Titre d'onglet propre à la page : voir TenantLayout.
  const { pathname } = useLocation();
  const pageCourante = navItems.find((item) => item.to === pathname.replace(/\/+$/, ""));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      {pageCourante && <title>{`${t(`nav.owner.${pageCourante.key}`)} | ${t("common.appName")}`}</title>}
      <EnteteEspace
        largeur="4xl"
        titre={t("components.ownerLayout.title")}
        badge={t("nav.ownerSpace")}
        sousTitre={user?.ownerName ?? user?.email}
        onglets={navItems.map((item) => ({ to: item.to, label: t(`nav.owner.${item.key}`), tip: t(`nav.tipsOwner.${item.key}`), icon: item.icon, end: true }))}
      />

      <main data-surface="app" className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>

      {/* Une idée arrive en travaillant, devant l'écran qui la provoque :
          le bouton est donc présent sur tout l'espace, pas rangé dans une
          page de contact. */}
      <BoutonSuggestion />
    </div>
  );
}
