import { LayoutDashboard, Menu, Receipt } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth";
import { useConfirmationDeconnexion } from "../hooks/useConfirmationDeconnexion";
import BoutonSuggestion from "./BoutonSuggestion";
import BoutonsHistorique from "./BoutonsHistorique";
import LanguageSwitcher from "./LanguageSwitcher";
import CartouchePlan from "./CartouchePlan";
import MenuLateral, { type GroupeMenu } from "./MenuLateral";

// Même menu latéral que l'espace gestionnaire (colonne d'icônes qui s'ouvre au survol), rangé en deux rubriques.
const groupes: ReadonlyArray<GroupeMenu> = [
  { cle: "overview", items: [{ to: "/proprietaire", key: "home", icone: LayoutDashboard }] },
  { cle: "reports", items: [{ to: "/proprietaire/crg", key: "crg", icone: Receipt }] },
];
const navItems = groupes.flatMap((groupe) => groupe.items);

/**
 * Coquille de l'Espace propriétaire : le même menu latéral que les espaces gestionnaire et administration. Deux entrées :
 * le résumé financier en lecture seule (périmètre initial), et le CRG mensuel (compte-rendu de gestion, ajouté ensuite).
 */
export default function OwnerLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { demanderDeconnexion, dialogue: dialogueDeconnexion } = useConfirmationDeconnexion();
  const [menuMobileOuvert, setMenuMobileOuvert] = useState(false);
  const fermerMenuMobile = useCallback(() => setMenuMobileOuvert(false), []);
  // Titre d'onglet propre à la page : voir TenantLayout.
  const { pathname } = useLocation();
  const entree = navItems.find((item) => item.to === pathname.replace(/\/+$/, ""));
  const groupeDeLaPage = groupes.find((g) => g.items.some((item) => item === entree));

  return (
    <div className="min-h-screen flex">
      {entree && <title>{`${t(`nav.owner.${entree.key}`)} | ${t("common.appName")}`}</title>}
      <MenuLateral
        groupes={groupes}
        prefixeLibelles="nav.owner"
        prefixeRubriques="nav.ownerGroups"
        racine="/proprietaire"
        sousTitre={t("components.ownerLayout.title")}
        cleStockage="menu-proprietaire-epingle"
        email={user?.ownerName ?? user?.email}
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
      <main data-surface="app" className="flex-1 min-w-0 px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => setMenuMobileOuvert(true)}
              className="sm:hidden shrink-0 w-9 h-9 rounded-xl bg-white border border-contour-200 flex items-center justify-center text-slate-600 shadow-2xs hover:bg-slate-50 transition-colors"
              aria-label={t("components.managerLayout.openMenuAria")}
            >
              <Menu size={18} />
            </button>
            <BoutonsHistorique />
          </div>
          {/* Fil d'Ariane décoratif (rubrique / page) : le texte vient d'attributs, il ne double ni le titre ni le menu. */}
          {groupeDeLaPage && entree && (
            <p
              aria-hidden="true"
              data-groupe={`${t(`nav.ownerGroups.${groupeDeLaPage.cle}`)}  /  `}
              data-page={t(`nav.owner.${entree.key}`)}
              className="mb-4 font-mono text-[11px] uppercase tracking-wider text-slate-600 before:content-[attr(data-groupe)] after:font-bold after:text-ink-900 after:content-[attr(data-page)]"
            />
          )}
          <Outlet />
          {entree && (
            <CartouchePlan espace={t("nav.ownerSpace")} page={t(`nav.owner.${entree.key}`)} rang={navItems.indexOf(entree) + 1} total={navItems.length} />
          )}
        </div>
      </main>

      {/* Une idée arrive en travaillant, devant l'écran qui la provoque :
          le bouton est donc présent sur tout l'espace, pas rangé dans une
          page de contact. */}
      <BoutonSuggestion />
    </div>
  );
}
