import {
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  CreditCard,
  FileText,
  Gift,
  HardHat,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
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
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import Logo from "./Logo";
import { useAuth } from "../context/auth";
import { peutVoirLeGuide } from "../utils/accesGuide";
import { enregistrerCoucheRetour } from "../utils/couchesRetour";
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
const groupes: ReadonlyArray<{ cle: string; items: ReadonlyArray<{ to: string; key: string; icone: LucideIcon }> }> = [
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

const CLE_EPINGLE = "menu-gestionnaire-epingle";
const lireEpingle = () => {
  try {
    return localStorage.getItem(CLE_EPINGLE) === "1";
  } catch {
    return false;
  }
};

export default function ManagerLayout() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { demanderDeconnexion, dialogue: dialogueDeconnexion } = useConfirmationDeconnexion();
  const sub = user?.subscription;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Comme le menu de Supabase : une colonne d'icônes qui s'ouvre quand la souris la survole (ou qu'un élément du menu a
  // le focus) et se referme quand elle la quitte. « Garder le menu déployé » l'épingle ouvert. Le tiroir du téléphone
  // reste toujours déployé.
  const [epingle, setEpingle] = useState(lireEpingle);
  const [survol, setSurvol] = useState(false);
  const ouvert = epingle || survol;
  const basculerEpingle = () =>
    setEpingle((actuel) => {
      try {
        localStorage.setItem(CLE_EPINGLE, actuel ? "0" : "1");
      } catch {
        /* le réglage n'est alors pas retenu, sans gravité */
      }
      return !actuel;
    });
  // Texte et blocs qui n'ont leur place que menu ouvert : ils s'effacent en colonne d'icônes.
  const etiquette = ouvert ? "" : "sm:opacity-0 sm:pointer-events-none";
  const seulementOuvert = ouvert ? "" : "sm:hidden";
  // Le bouton retour d'Android referme le menu ouvert avant de changer de page (voir useBoutonRetourAndroid).
  useEffect(() => {
    if (!mobileNavOpen) return;
    return enregistrerCoucheRetour(() => setMobileNavOpen(false));
  }, [mobileNavOpen]);
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
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 z-30 sm:hidden transition-opacity"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Réserve la place de la colonne ; le menu, lui, se déploie par-dessus le contenu. */}
      <div aria-hidden="true" className={`hidden sm:block shrink-0 transition-[width] duration-200 ${epingle ? "w-64" : "w-16"}`} />
      <aside
        onMouseEnter={() => setSurvol(true)}
        onMouseLeave={(e) => {
          // Une liste déroulante ouverte (monnaie, langue) sort du menu : on ne referme pas sous le choix de la personne.
          if (document.activeElement instanceof HTMLSelectElement && e.currentTarget.contains(document.activeElement)) return;
          setSurvol(false);
        }}
        onFocus={() => setSurvol(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvol(false);
        }}
        className={`fixed inset-y-0 left-0 z-40 w-64 ${ouvert ? "sm:w-64" : "sm:w-16"} h-dvh bg-white text-slate-900 border-r border-slate-300 flex flex-col overflow-hidden transform transition-[transform,width,box-shadow] duration-200 ease-in-out ${
          ouvert && !epingle ? "sm:shadow-xl" : "shadow-xl sm:shadow-none"
        } ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"} sm:translate-x-0`}
      >
        <div className="shrink-0 h-16 px-3.5 flex items-center justify-between gap-3 border-b border-slate-300">
          <div className="flex items-center gap-3 min-w-0">
            <Logo />
            <div className={`min-w-0 whitespace-nowrap transition-opacity duration-150 ${etiquette}`}>
              <h1 className="text-sm font-extrabold leading-tight truncate">{t("common.appName")}</h1>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600 truncate">{t("components.managerLayout.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 hover:text-slate-900 transition-colors"
            aria-label={t("components.managerLayout.closeMenuAria")}
          >
            <X size={15} />
          </button>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2" onClick={() => setMobileNavOpen(false)}>
          {groupes.map((groupe, rang) => (
            // Des filets séparent les rubriques, sans intitulé, comme dans Supabase ; le nom reste lu par les lecteurs d'écran.
            <div key={groupe.cle} role="group" aria-label={t(`nav.groups.${groupe.cle}`)} className={rang > 0 ? "mt-2 pt-2 border-t border-slate-300" : ""}>
              <div className="space-y-0.5">
                {groupe.items.map((item) => (
                  // Pas de bulle d'aide ici : le menu se déploie au survol et donne déjà le nom de la page.
                  <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/dashboard"}
                      className={({ isActive }) =>
                        `group flex items-center gap-3.5 h-11 px-3.5 text-sm whitespace-nowrap rounded-md transition-colors duration-150 ${
                          isActive ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icone size={20} strokeWidth={isActive ? 1.9 : 1.6} aria-hidden="true" className={`shrink-0 ${isActive ? "text-ink-900" : "text-slate-600 group-hover:text-ink-900"}`} />
                          <span className={`truncate transition-opacity duration-150 ${etiquette}`}>{t(`nav.manager.${item.key}`)}</span>
                        </>
                      )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-slate-300 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-white">
          {sub?.isTrialActive && (
            <div className={`mb-2 mx-1 bg-brand-50 border border-ocre/60 rounded-sm px-3 py-1.5 text-[11px] text-slate-800 flex items-center justify-between ${seulementOuvert}`}>
              <span>{t("components.managerLayout.trialFree")}</span>
              <span className="font-mono font-medium text-white bg-ocre px-1.5 py-0.5 rounded-sm text-[10px]">{sub.trialDaysRemaining} j</span>
            </div>
          )}
          <div className={`mb-2 mx-1 grid w-full grid-cols-2 gap-2 ${seulementOuvert}`}>
            <div className="min-w-0 w-full">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">{t("nav.currencyLabel")}</span>
              <CurrencySelector className="w-full [&>select]:w-full" />
            </div>
            <div className="min-w-0 w-full">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">{t("common.language.label")}</span>
              <LanguageSwitcher className="w-full [&>select]:w-full" />
            </div>
          </div>
          <button
            type="button"
            onClick={basculerEpingle}
            aria-pressed={epingle}
            aria-label={epingle ? t("nav.collapse") : t("nav.expand")}
            className="hidden sm:flex w-full h-11 items-center gap-3.5 px-3.5 rounded-md text-sm text-slate-700 whitespace-nowrap hover:bg-slate-100 hover:text-ink-900 transition-colors cursor-pointer"
          >
            {epingle ? <ChevronsLeft size={20} strokeWidth={1.6} aria-hidden="true" className="shrink-0" /> : <ChevronsRight size={20} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />}
            <span className={`transition-opacity duration-150 ${etiquette}`}>{epingle ? t("nav.collapse") : t("nav.expand")}</span>
          </button>
          <div className="flex items-center gap-1">
            <div className="flex flex-1 min-w-0 items-center gap-3.5 h-11 px-2 whitespace-nowrap" title={user?.email}>
              <div className="w-8 h-8 bg-ink-900 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {(user?.email?.[0] || "?").toUpperCase()}
              </div>
              <div className={`min-w-0 transition-opacity duration-150 ${etiquette}`}>
                <p className="text-xs text-slate-900 font-medium truncate">{user?.email}</p>
              </div>
            </div>
          </div>
          <button
            onClick={demanderDeconnexion}
            className="w-full h-11 flex items-center gap-3.5 px-3.5 rounded-md text-sm text-slate-700 whitespace-nowrap hover:bg-rose-500/10 hover:text-rose-700 transition-colors cursor-pointer"
          >
            <LogOut size={20} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />
            <span className={`transition-opacity duration-150 ${etiquette}`}>{t("nav.logout")}</span>
          </button>
        </div>
      </aside>
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
