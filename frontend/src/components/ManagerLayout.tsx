import {
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  ClipboardCheck,
  CreditCard,
  FileText,
  Gift,
  HardHat,
  History,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";
import MenuLateral, { type GroupeMenu } from "./MenuLateral";
import { useAuth } from "../context/auth";
import { peutVoirLeGuide } from "../utils/accesGuide";
import { CurrencySelector } from "../context/CurrencyContext";
import { useConfirmationDeconnexion } from "../hooks/useConfirmationDeconnexion";
import GlobalSearch from "./GlobalSearch";
import BoutonsHistorique from "./BoutonsHistorique";
import LanguageSwitcher from "./LanguageSwitcher";
import NotificationBell from "./NotificationBell";
import TrialBanner from "./TrialBanner";
import BoutonSuggestion from "./BoutonSuggestion";

// Pages sans entrée dans le menu latéral, mais qui titrent l'onglet : le guide
// de démarrage s'ouvre depuis le raccourci à côté de « Une suggestion ? ».
const pagesHorsMenu = [{ to: "/guide-demarrage", key: "guide" }];

// Le menu est rangé par rubriques, comme le tableau de bord de Supabase : une icône par page, des intitulés de rubrique
// discrets, et la possibilité de le replier en une colonne d'icônes pour laisser la place au travail.
const groupes: ReadonlyArray<GroupeMenu> = [
  { cle: "overview", items: [{ to: "/dashboard", key: "dashboard", icone: LayoutDashboard }] },
  {
    cle: "portfolio",
    items: [
      { to: "/properties", key: "properties", icone: Building2 },
      { to: "/proprietaires", key: "owners", icone: Briefcase },
      { to: "/tenants", key: "tenants", icone: Users },
      { to: "/contracts", key: "contracts", icone: FileText },
      { to: "/etats-des-lieux", key: "inspections", icone: ClipboardCheck },
    ],
  },
  {
    cle: "rental",
    items: [
      { to: "/annonces", key: "listings", icone: Megaphone },
      { to: "/leads", key: "leads", icone: Inbox },
      { to: "/messages", key: "messages", icone: MessageSquare },
    ],
  },
  {
    cle: "finance",
    items: [
      { to: "/invoices", key: "invoices", icone: Receipt },
      { to: "/expenses", key: "expenses", icone: Wallet },
      { to: "/assurances", key: "insurance", icone: ShieldCheck },
      { to: "/bilan-fiscal", key: "fiscal", icone: Calculator },
    ],
  },
  {
    cle: "operations",
    items: [
      { to: "/issues", key: "issues", icone: Wrench },
      { to: "/prestataires", key: "vendors", icone: HardHat },
      { to: "/activity-log", key: "activityLog", icone: History },
      { to: "/import", key: "import", icone: Upload },
    ],
  },
  {
    cle: "account",
    items: [
      { to: "/agency", key: "agency", icone: Settings },
      { to: "/subscription", key: "subscription", icone: CreditCard },
      { to: "/parrainage", key: "referral", icone: Gift },
    ],
  },
];
const navItems = groupes.flatMap((groupe) => groupe.items);


export default function ManagerLayout() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { demanderDeconnexion, dialogue: dialogueDeconnexion } = useConfirmationDeconnexion();
  const sub = user?.subscription;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fermerMenuMobile = useCallback(() => setMobileNavOpen(false), []);
  // Titre d'onglet propre à la page (React 19 remonte ce <title> dans <head>) : sans lui, les vingt pages de
  // l'espace s'appelaient pareil, et un lecteur d'écran n'annonçait aucun changement de page. L'entrée de
  // navigation la plus précise gagne ; le compte-rendu de gestion d'un propriétaire a son propre libellé.
  const { pathname } = useLocation();
  const chemin = pathname.replace(/\/+$/, "");
  const entree = [...navItems, ...pagesHorsMenu].sort((a, b) => b.to.length - a.to.length).find((item) => chemin === item.to || chemin.startsWith(`${item.to}/`));
  const groupeDeLaPage = groupes.find((g) => g.items.some((item) => item === entree));
  const rangFeuille = navItems.findIndex((item) => item === entree);
  const moisEnCours = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(new Date());
  const libellePage = /^\/proprietaires\/[^/]+\/crg$/.test(chemin) ? t("nav.owner.crg") : entree ? t(`nav.manager.${entree.key}`) : null;

  return (
    <div className="min-h-screen flex">
      {libellePage && <title>{`${libellePage} | ${t("common.appName")}`}</title>}
      <MenuLateral
        groupes={groupes}
        prefixeLibelles="nav.manager"
        prefixeRubriques="nav.groups"
        racine="/dashboard"
        sousTitre={t("components.managerLayout.subtitle")}
        cleStockage="menu-gestionnaire-epingle"
        email={user?.email}
        ouvertMobile={mobileNavOpen}
        onFermerMobile={fermerMenuMobile}
        onDeconnexion={demanderDeconnexion}
        enPied={
          <>
            {sub?.isTrialActive && (
              <div className="mb-2 mx-1 bg-brand-50 border border-ocre/60 rounded-sm px-3 py-1.5 text-[11px] text-slate-800 flex items-center justify-between">
                <span>{t("components.managerLayout.trialFree")}</span>
                <span className="font-mono font-medium text-white bg-ocre px-1.5 py-0.5 rounded-sm text-[10px]">{sub.trialDaysRemaining} j</span>
              </div>
            )}
            <div className="mb-2 mx-1 flex w-full flex-col gap-2">
              <div className="min-w-0 w-full">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">{t("nav.currencyLabel")}</span>
                <CurrencySelector className="w-full [&>select]:w-full" />
              </div>
              <div className="min-w-0 w-full">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">{t("common.language.label")}</span>
                <LanguageSwitcher className="w-full [&>select]:w-full" />
              </div>
            </div>
          </>
        }
      />
      {/* Hors de la barre latérale : sa transformation ferait d'elle le repère d'un élément en `fixed`. */}
      {dialogueDeconnexion}
      <main data-surface="app" className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="sm:hidden shrink-0 w-9 h-9 rounded-xl bg-white border border-contour-200 flex items-center justify-center text-slate-600 shadow-2xs hover:bg-slate-50 transition-colors"
            aria-label={t("components.managerLayout.openMenuAria")}
          >
            <Menu size={18} />
          </button>
          <BoutonsHistorique />
          <GlobalSearch />
          <NotificationBell />
        </div>
        {/* Fil d'Ariane décoratif (rubrique / page) : le texte vient d'attributs, il ne double ni le titre ni le menu. */}
        {groupeDeLaPage && entree && (
          <p
            aria-hidden="true"
            data-groupe={`${t(`nav.groups.${groupeDeLaPage.cle}`)}  /  `}
            data-page={t(`nav.manager.${entree.key}`)}
            className="mb-4 font-mono text-[11px] uppercase tracking-wider text-slate-600 before:content-[attr(data-groupe)] after:font-bold after:text-ink-900 after:content-[attr(data-page)]"
          />
        )}
        <TrialBanner />
        <Outlet />
        {/* Cartouche de feuille, en pied de plan : repère décoratif (numéro de l'entrée du menu, mois en cours). */}
        {rangFeuille >= 0 && (
          <div
            aria-hidden="true"
            className="mt-10 mb-14 flex items-stretch justify-between border-[1.5px] border-ink-900 bg-white font-mono text-[10px] uppercase tracking-wider text-slate-600"
          >
            <span className="border-r-[1.5px] border-ink-900 px-3 py-1.5">{t("common.appName")}</span>
            <span className="hidden flex-1 bande-motif opacity-25 sm:block" />
            <span className="border-l-[1.5px] border-ink-900 px-3 py-1.5">{moisEnCours}</span>
            <span className="border-l-[1.5px] border-ink-900 bg-ink-900 px-3 py-1.5 text-white">
              {t("common.sheet")} {String(rangFeuille + 1).padStart(2, "0")} / {String(navItems.length).padStart(2, "0")}
            </span>
          </div>
        )}
      </main>

      {/* Une idée arrive en travaillant, devant l'écran qui la provoque :
          le bouton est donc présent sur tout l'espace, pas rangé dans une
          page de contact. */}
      <BoutonSuggestion
        aCote={
          peutVoirLeGuide(user) && (
            <Link
              to="/guide-demarrage"
              className="flex items-center gap-2 rounded-full bg-white hover:bg-slate-50 text-slate-800 border border-contour-200 text-xs font-semibold px-4 py-2.5 shadow-md transition-colors"
            >
              <BookOpen size={14} aria-hidden="true" /> {t("nav.manager.guide")}
            </Link>
          )
        }
      />
    </div>
  );
}
