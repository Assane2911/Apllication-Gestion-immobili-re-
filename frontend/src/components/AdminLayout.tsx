import { Building2, Landmark, LayoutDashboard, Lightbulb, Megaphone, Menu, ScrollText, Settings } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import { useConfirmationDeconnexion } from "../hooks/useConfirmationDeconnexion";
import LanguageSwitcher from "./LanguageSwitcher";
import MenuLateral, { type GroupeMenu } from "./MenuLateral";

// Même menu latéral que l'espace gestionnaire (colonne d'icônes qui s'ouvre au survol), rangé en quatre rubriques.
const groupes: ReadonlyArray<GroupeMenu> = [
  { cle: "overview", items: [{ to: "/admin", key: "dashboard", icone: LayoutDashboard }] },
  {
    cle: "platform",
    items: [
      { to: "/admin/gestionnaires", key: "managers", icone: Building2 },
      { to: "/admin/annonces", key: "listings", icone: Megaphone },
      { to: "/admin/virements", key: "transfers", icone: Landmark },
    ],
  },
  {
    cle: "supervision",
    items: [
      { to: "/admin/journal", key: "audit", icone: ScrollText },
      { to: "/admin/suggestions", key: "suggestions", icone: Lightbulb },
    ],
  },
  { cle: "configuration", items: [{ to: "/admin/parametres", key: "settings", icone: Settings }] },
];
const navItems = groupes.flatMap((groupe) => groupe.items);

/** Layout de l'espace administration de la plateforme (distinct du gestionnaire/locataire). */
export default function AdminLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { demanderDeconnexion, dialogue: dialogueDeconnexion } = useConfirmationDeconnexion();
  const [menuMobileOuvert, setMenuMobileOuvert] = useState(false);
  const fermerMenuMobile = useCallback(() => setMenuMobileOuvert(false), []);
  // Titre d'onglet propre à la page (React 19 remonte ce <title> dans <head>), comme dans l'espace gestionnaire :
  // sans lui, les sept pages d'administration s'appelaient pareil. L'entrée la plus précise gagne (la fiche d'un
  // gestionnaire, /admin/gestionnaires/:id, garde le libellé « Gestionnaires »).
  const { pathname } = useLocation();
  const chemin = pathname.replace(/\/+$/, "");
  const entree = [...navItems].sort((a, b) => b.to.length - a.to.length).find((item) => chemin === item.to || chemin.startsWith(`${item.to}/`));
  const libellePage = entree ? t(`admin.nav.${entree.key}`) : null;
  const groupeDeLaPage = groupes.find((g) => g.items.some((item) => item === entree));

  return (
    <div className="min-h-screen flex">
      {libellePage && <title>{`${libellePage} | ${t("common.appName")}`}</title>}
      <MenuLateral
        groupes={groupes}
        prefixeLibelles="admin.nav"
        prefixeRubriques="admin.groups"
        racine="/admin"
        sousTitre={t("components.adminLayout.title")}
        cleStockage="menu-administration-epingle"
        email={user?.email}
        ouvertMobile={menuMobileOuvert}
        onFermerMobile={fermerMenuMobile}
        onDeconnexion={demanderDeconnexion}
        enPied={
          <div className="mb-2 mx-1 w-full">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">{t("common.language.label")}</span>
            <LanguageSwitcher className="w-full [&>select]:w-full" />
          </div>
        }
      />
      {/* Hors du menu : sa transformation ferait de lui le repère d'un élément en `fixed`. */}
      {dialogueDeconnexion}
      <main data-surface="app" className="flex-1 min-w-0 px-4 py-6">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => setMenuMobileOuvert(true)}
            className="sm:hidden mb-4 w-9 h-9 rounded-xl bg-white border border-contour-200 flex items-center justify-center text-slate-600 shadow-2xs hover:bg-slate-50 transition-colors"
            aria-label={t("components.managerLayout.openMenuAria")}
          >
            <Menu size={18} />
          </button>
          {/* Fil d'Ariane décoratif (rubrique / page) : le texte vient d'attributs, il ne double ni le titre ni le menu. */}
          {groupeDeLaPage && entree && (
            <p
              aria-hidden="true"
              data-groupe={`${t(`admin.groups.${groupeDeLaPage.cle}`)}  /  `}
              data-page={t(`admin.nav.${entree.key}`)}
              className="mb-4 font-mono text-[11px] uppercase tracking-wider text-slate-600 before:content-[attr(data-groupe)] after:font-bold after:text-ink-900 after:content-[attr(data-page)]"
            />
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
