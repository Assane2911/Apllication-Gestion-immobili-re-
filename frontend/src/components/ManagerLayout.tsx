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
import Bulle from "./Bulle";
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

const CLE_REPLI = "menu-gestionnaire-replie";
const lireRepli = () => {
  try {
    return localStorage.getItem(CLE_REPLI) === "1";
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
  // Replié : une colonne d'icônes sur ordinateur (le tiroir du téléphone reste toujours déployé).
  const [replie, setReplie] = useState(lireRepli);
  const basculerRepli = () =>
    setReplie((actuel) => {
      try {
        localStorage.setItem(CLE_REPLI, actuel ? "0" : "1");
      } catch {
        /* le réglage n'est alors pas retenu, sans gravité */
      }
      return !actuel;
    });
  const masquerSiReplie = replie ? "sm:hidden" : "";
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
      <aside
        className={`fixed sm:sticky inset-y-0 sm:top-0 left-0 z-40 w-64 ${replie ? "sm:w-16" : "sm:w-64"} h-dvh sm:h-screen bg-white text-slate-900 border-r-[1.5px] border-ink-900 flex flex-col shrink-0 shadow-xl transform transition-[transform,width] duration-200 ease-in-out ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } sm:translate-x-0`}
      >
        <div aria-hidden="true" className="bande-motif h-3.5 shrink-0" />
        <div className={`shrink-0 px-5 py-5 border-b-[1.5px] border-ink-900 ${replie ? "sm:px-3" : ""}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <Logo />
              </div>
              <div className={`min-w-0 ${masquerSiReplie}`}>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm font-extrabold leading-tight truncate">{t("common.appName")}</h1>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600 truncate">{t("components.managerLayout.subtitle")}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setMobileNavOpen(false)}
                className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 hover:text-slate-900 transition-colors cursor-pointer"
                aria-label={t("components.managerLayout.closeMenuAria")}
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {sub?.isTrialActive && (
            <div className={`mt-3 bg-brand-50 border border-ocre/60 rounded-sm px-3 py-1.5 text-[11px] text-slate-800 flex items-center justify-between shadow-2xs ${masquerSiReplie}`}>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ocre opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-ocre" />
                </span>
                <span>{t("components.managerLayout.trialFree")}</span>
              </div>
              <span className="font-mono font-medium text-white bg-ocre px-1.5 py-0.5 rounded-sm text-[10px]">{sub.trialDaysRemaining} j</span>
            </div>
          )}
          <div className={`mt-3 pt-3 border-t border-slate-300 ${masquerSiReplie}`}>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">
              {t("nav.currencyLabel")}
            </span>
            <CurrencySelector className="w-full [&>select]:w-full" />
          </div>
          <div className={`mt-2 ${masquerSiReplie}`}>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 font-semibold block mb-1">
              {t("common.language.label")}
            </span>
            <LanguageSwitcher className="w-full [&>select]:w-full" />
          </div>
        </div>
        <nav className={`flex-1 min-h-0 overflow-y-auto py-3 ${replie ? "px-3 sm:px-2" : "px-3"}`} onClick={() => setMobileNavOpen(false)}>
          {groupes.map((groupe, rang) => (
            <div key={groupe.cle} className={rang > 0 ? "mt-4" : ""}>
              <p className={`px-3 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${masquerSiReplie}`}>
                {t(`nav.groups.${groupe.cle}`)}
              </p>
              {/* Replié, un simple filet sépare les rubriques. */}
              {rang > 0 && <div aria-hidden="true" className={`mb-2 hidden border-t border-slate-300 ${replie ? "sm:block" : ""}`} />}
              <div className="space-y-0.5">
                {groupe.items.map((item) => {
                  const libelle = t(`nav.manager.${item.key}`);
                  return (
                    // La bulle s'ouvre à DROITE : dans une barre latérale, au-dessus recouvrirait l'entrée précédente,
                    // c'est-à-dire une autre cible cliquable. Repliée, elle donne le nom de la page (l'icône seule ne le dit pas).
                    <Bulle key={item.to} texte={replie ? libelle : t(`nav.tips.${item.key}`)} position="droite" className="block">
                      <NavLink
                        to={item.to}
                        end={item.to === "/dashboard"}
                        aria-label={replie ? libelle : undefined}
                        className={({ isActive }) =>
                          `group relative flex items-center gap-3 px-3 py-2 text-[13px] rounded-sm transition-colors duration-200 ${replie ? "sm:justify-center sm:px-0" : ""} ${
                            isActive ? "bg-brand-50 text-ink-900 font-semibold" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* Trait orange à gauche de la page courante, comme la barre d'état du menu de Supabase. */}
                            <span aria-hidden="true" className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-ocre transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-0"}`} />
                            <item.icone size={17} strokeWidth={isActive ? 2.1 : 1.8} aria-hidden="true" className={`shrink-0 transition-colors duration-200 ${isActive ? "text-ink-900" : "text-slate-500 group-hover:text-ink-900"}`} />
                            <span className={`truncate ${masquerSiReplie}`}>{libelle}</span>
                          </>
                        )}
                      </NavLink>
                    </Bulle>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <button
          type="button"
          onClick={basculerRepli}
          aria-pressed={replie}
          aria-label={replie ? t("nav.expand") : t("nav.collapse")}
          className="hidden sm:flex shrink-0 items-center gap-3 border-t border-slate-300 px-6 py-2.5 text-[13px] text-slate-600 hover:bg-slate-100 hover:text-ink-900 transition-colors cursor-pointer"
        >
          {replie ? <ChevronsRight size={17} aria-hidden="true" className="mx-auto" /> : <ChevronsLeft size={17} aria-hidden="true" />}
          <span className={masquerSiReplie}>{t("nav.collapse")}</span>
        </button>
        <div className={`shrink-0 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t-[1.5px] border-ink-900 bg-slate-50 ${replie ? "sm:px-2" : ""}`}>
          <div className={`flex items-center gap-2.5 min-w-0 p-1.5 bg-white border border-slate-300 ${replie ? "sm:justify-center" : ""}`}>
            <div className="w-8 h-8 bg-ink-900 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {(user?.email?.[0] || "?").toUpperCase()}
            </div>
            <div className={`min-w-0 flex-1 ${masquerSiReplie}`}>
              <p className="text-xs text-slate-900 font-medium truncate">{user?.email}</p>
              <p className="text-[10px] text-emerald-700 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                {t("nav.manager.dashboard")}
              </p>
            </div>
          </div>
          <button
            onClick={demanderDeconnexion}
            aria-label={replie ? t("nav.logout") : undefined}
            title={replie ? t("nav.logout") : undefined}
            className="mt-2.5 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-rose-500/10 hover:text-rose-700 hover:border-rose-500/30 transition-all cursor-pointer"
          >
            <LogOut size={13} />
            <span className={masquerSiReplie}>{t("nav.logout")}</span>
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
