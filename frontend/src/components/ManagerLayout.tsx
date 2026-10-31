import {
  BookOpen,
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
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
import { useTheme } from "../context/theme";
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

const navItems = [
  { to: "/dashboard", key: "dashboard" },
  { to: "/properties", key: "properties" },
  { to: "/tenants", key: "tenants" },
  { to: "/proprietaires", key: "owners" },
  { to: "/contracts", key: "contracts" },
  { to: "/etats-des-lieux", key: "inspections" },
  { to: "/invoices", key: "invoices" },
  { to: "/annonces", key: "listings" },
  { to: "/leads", key: "leads" },
  { to: "/expenses", key: "expenses" },
  { to: "/assurances", key: "insurance" },
  { to: "/bilan-fiscal", key: "fiscal" },
  { to: "/messages", key: "messages" },
  { to: "/issues", key: "issues" },
  { to: "/prestataires", key: "vendors" },
  { to: "/activity-log", key: "activityLog" },
  { to: "/import", key: "import" },
  { to: "/agency", key: "agency" },
  { to: "/subscription", key: "subscription" },
  { to: "/parrainage", key: "referral" },
] as const;

export default function ManagerLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { demanderDeconnexion, dialogue: dialogueDeconnexion } = useConfirmationDeconnexion();
  const { theme, toggleTheme } = useTheme();
  const sub = user?.subscription;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const libellePage = /^\/proprietaires\/[^/]+\/crg$/.test(chemin) ? t("nav.owner.crg") : entree ? t(`nav.manager.${entree.key}`) : null;

  return (
    <div className="min-h-screen flex">
      {libellePage && <title>{`${libellePage} | ${t("common.appName")}`}</title>}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-30 sm:hidden transition-opacity"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed sm:sticky inset-y-0 sm:top-0 left-0 z-40 w-64 h-dvh sm:h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-r-[1.5px] border-ink-900 dark:border-slate-300/40 flex flex-col shrink-0 shadow-xl transform transition-transform duration-200 ease-in-out ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } sm:translate-x-0`}
      >
        <div aria-hidden="true" className="bande-motif h-3.5 shrink-0" />
        <div className="shrink-0 px-5 py-5 border-b-[1.5px] border-ink-900 dark:border-slate-300/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <Logo />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm font-extrabold leading-tight truncate">{t("common.appName")}</h1>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 truncate">{t("components.managerLayout.subtitle")}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Bulle texte={t("common.theme.tip")} className="contents">
              <button
                onClick={toggleTheme}
                className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                aria-label={t("common.theme.toggleAria")}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              </Bulle>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                aria-label={t("components.managerLayout.closeMenuAria")}
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {sub?.isTrialActive && (
            <div className="mt-3 bg-brand-50 dark:bg-slate-800 border border-ocre/60 rounded-sm px-3 py-1.5 text-[11px] text-slate-800 dark:text-slate-200 flex items-center justify-between shadow-2xs">
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
          <div className="mt-3 pt-3 border-t border-slate-300 dark:border-slate-700">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold block mb-1">
              {t("nav.currencyLabel")}
            </span>
            <CurrencySelector className="w-full [&>select]:w-full" />
          </div>
          <div className="mt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-semibold block mb-1">
              {t("common.language.label")}
            </span>
            <LanguageSwitcher className="w-full [&>select]:w-full" variant={theme === "dark" ? "dark" : "light"} />
          </div>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-0.5" onClick={() => setMobileNavOpen(false)}>
          {navItems.map((item, index) => (
            // La bulle s'ouvre à DROITE : dans une barre latérale, au-dessus
            // recouvrirait l'entrée précédente, c'est-à-dire une autre cible
            // cliquable.
            <Bulle key={item.to} texte={t(`nav.tips.${item.key}`)} position="droite" className="block">
            <NavLink
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) =>
                `flex items-baseline gap-3 px-3 py-2 text-sm border-b border-slate-300/70 dark:border-slate-700/60 transition-colors duration-150 ${
                  isActive
                    ? "bg-ink-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                    : "text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`
              }
            >
              <span aria-hidden="true" className="w-5 shrink-0 font-mono text-[11px] opacity-80">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="truncate">{t(`nav.manager.${item.key}`)}</span>
            </NavLink>
            </Bulle>
          ))}
        </nav>
        <div className="shrink-0 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t-[1.5px] border-ink-900 dark:border-slate-300/40 bg-slate-50 dark:bg-slate-950/40">
          <div className="flex items-center gap-2.5 min-w-0 p-1.5 bg-white dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700">
            <div className="w-8 h-8 bg-ink-900 dark:bg-slate-100 flex items-center justify-center text-xs font-bold text-white dark:text-slate-900 shrink-0">
              {(user?.email?.[0] || "?").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-900 dark:text-slate-200 font-medium truncate">{user?.email}</p>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                {t("nav.manager.dashboard")}
              </p>
            </div>
          </div>
          <button
            onClick={demanderDeconnexion}
            className="mt-2.5 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-400 bg-white dark:bg-slate-900/40 border border-slate-300 dark:border-slate-700 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-400 hover:border-rose-500/30 transition-all cursor-pointer"
          >
            <LogOut size={13} />
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      {/* Hors de la barre latérale : sa transformation ferait d'elle le repère d'un élément en `fixed`. */}
      {dialogueDeconnexion}
      <main data-surface="app" className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="sm:hidden shrink-0 w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-contour-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
      </main>

      {/* Une idée arrive en travaillant, devant l'écran qui la provoque :
          le bouton est donc présent sur tout l'espace, pas rangé dans une
          page de contact. */}
      <BoutonSuggestion
        aCote={
          peutVoirLeGuide(user) && (
            <Link
              to="/guide-demarrage"
              className="flex items-center gap-2 rounded-full bg-white/95 dark:bg-slate-800/95 hover:bg-white dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border border-contour-200 dark:border-slate-600 text-xs font-semibold px-4 py-2.5 shadow-lg backdrop-blur-sm transition-colors"
            >
              <BookOpen size={14} aria-hidden="true" /> {t("nav.manager.guide")}
            </Link>
          )
        }
      />
    </div>
  );
}
