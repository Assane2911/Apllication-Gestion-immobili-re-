import { CreditCard, Home, MessageCircle, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import EnteteEspace from "./EnteteEspace";
import BoutonSuggestion from "./BoutonSuggestion";
import NotificationBell from "./NotificationBell";

const navItems = [
  { to: "/portail", key: "home", icon: Home },
  { to: "/portail/paiements", key: "payments", icon: CreditCard },
  { to: "/portail/messages", key: "messages", icon: MessageCircle },
  { to: "/portail/incidents", key: "issues", icon: Wrench },
] as const;

export default function TenantLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Titre d'onglet propre à la page (React 19 remonte ce <title> dans <head>) : sans lui, toutes les pages
  // du portail s'appelaient pareil, et un lecteur d'écran n'annonçait aucun changement de page.
  const { pathname } = useLocation();
  const pageCourante = navItems.find((item) => item.to === pathname.replace(/\/+$/, ""));

  return (
    <div className="min-h-screen">
      {pageCourante && <title>{`${t(`nav.tenant.${pageCourante.key}`)} | ${t("common.appName")}`}</title>}
      <EnteteEspace
        largeur="4xl"
        titre={t("components.tenantLayout.title")}
        badge={t("components.tenantLayout.badge")}
        sousTitre={user?.tenantName ?? user?.email}
        onglets={navItems.map((item) => ({ to: item.to, label: t(`nav.tenant.${item.key}`), tip: t(`nav.tipsTenant.${item.key}`), icon: item.icon, end: true }))}
        actionsAvant={<NotificationBell endpoint="/notifications/mine" i18nPrefix="tenant.notificationBell" />}
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
