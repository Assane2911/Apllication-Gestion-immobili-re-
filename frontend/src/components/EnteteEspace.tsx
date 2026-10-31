import { LogOut, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import Logo from "./Logo";
import { useTheme } from "../context/theme";
import { useConfirmationDeconnexion } from "../hooks/useConfirmationDeconnexion";
import { useMediaQuery } from "../hooks/useMediaQuery";
import Bulle from "./Bulle";
import BoutonsHistorique from "./BoutonsHistorique";
import LanguageSwitcher from "./LanguageSwitcher";

export interface OngletEspace {
  to: string;
  label: string;
  /** Intitulé affiché sur téléphone quand `label` est trop long ; le lien garde `label` comme nom accessible. */
  labelCourt?: string;
  /** Texte de l'infobulle. */
  tip: string;
  icon: LucideIcon;
  end?: boolean;
}

interface EnteteEspaceProps {
  largeur: "4xl" | "5xl";
  titre: string;
  /** Pastille à côté du titre, masquée sur téléphone. */
  badge?: string;
  /** Nom de la personne connectée (ou son email). */
  sousTitre?: string;
  onglets: OngletEspace[];
  /** Commandes propres à un espace (ex. la cloche de notifications), placées avant le thème. */
  actionsAvant?: ReactNode;
}

const LARGEURS = { "4xl": "max-w-4xl", "5xl": "max-w-5xl" } as const;

// Classes écrites en entier (et non composées) pour que Tailwind les trouve à la compilation.
const FONDUS = {
  aucun: "",
  droite: "max-sm:mask-[linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]",
  gauche: "max-sm:mask-[linear-gradient(to_right,transparent,black_1.5rem)]",
  deux: "max-sm:mask-[linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]",
} as const;

/**
 * En-tête des espaces administrateur, propriétaire et locataire : identité à gauche, commandes (langue, thème,
 * déconnexion) à droite, puis les onglets.
 *
 * Sur téléphone, le tout tient en DEUX lignes bien rangées, au lieu de se répartir sur quatre ou cinq au gré du
 * retour à la ligne : la ligne de commandes reste unique (langue en code court, déconnexion en icône, le titre se
 * tronque plutôt que de repousser les boutons), et les onglets forment une rangée qui défile, l'onglet actif étant
 * toujours ramené dans la zone visible.
 */
export default function EnteteEspace({ largeur, titre, badge, sousTitre, onglets, actionsAvant }: EnteteEspaceProps) {
  const { t } = useTranslation();
  const { demanderDeconnexion, dialogue } = useConfirmationDeconnexion();
  const { theme, toggleTheme } = useTheme();
  const telephone = useMediaQuery("(max-width: 639px)");
  const { pathname } = useLocation();
  const barre = useRef<HTMLElement>(null);

  // Fondus de la rangée : du côté où des onglets sont cachés, et seulement de ce côté. L'onglet actif étant ramené au
  // centre, c'est souvent le premier, à gauche, qui est caché en partie : sans fondu, il paraissait coupé par erreur.
  const [bords, setBords] = useState({ gauche: false, droite: false });
  const mesurerBords = useCallback(() => {
    const n = barre.current;
    if (!n) return;
    const gauche = n.scrollLeft > 1;
    const droite = n.scrollLeft + n.clientWidth < n.scrollWidth - 1;
    setBords((b) => (b.gauche === gauche && b.droite === droite ? b : { gauche, droite }));
  }, []);
  useEffect(() => {
    const n = barre.current;
    if (!n) return;
    n.addEventListener("scroll", mesurerBords, { passive: true });
    window.addEventListener("resize", mesurerBords);
    return () => {
      n.removeEventListener("scroll", mesurerBords);
      window.removeEventListener("resize", mesurerBords);
    };
  }, [mesurerBords]);

  // Sur téléphone, les onglets défilent : celui de la page courante doit rester visible.
  useEffect(() => {
    const actif = barre.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (actif && typeof actif.scrollIntoView === "function") actif.scrollIntoView({ block: "nearest", inline: "center" });
    mesurerBords();
  }, [pathname, mesurerBords]);

  const colonne = LARGEURS[largeur];

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-contour-200/80 dark:border-slate-800/80 shadow-2xs">
        <div className={`${colonne} mx-auto px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="hidden min-[380px]:block" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight max-sm:line-clamp-2 sm:truncate">{titre}</h1>
                {badge && (
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-200/60 dark:border-brand-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {badge}
                  </span>
                )}
              </div>
              {sousTitre && <p className="text-xs text-slate-600 dark:text-slate-400 font-medium truncate">{sousTitre}</p>}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1.5 sm:gap-2.5 flex-wrap justify-end">
            <LanguageSwitcher compact={telephone} variant={theme === "dark" ? "dark" : "light"} />
            {actionsAvant}
            <Bulle texte={t("common.theme.tip")} className="contents">
              <button
                onClick={toggleTheme}
                className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-contour-200/80 dark:border-slate-700/80 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                aria-label={t("common.theme.toggleAria")}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </Bulle>
            {/* Rose au repos (pas seulement au survol, inutilisable au doigt) : un bouton qui se fondait parmi les
                icônes voisines pouvait passer inaperçu. Icône seule sur téléphone, avec le libellé pour les lecteurs
                d'écran ; texte visible dès 640 px. */}
            <Bulle texte={t("common.tips.logout")} className="contents">
              <button
                onClick={demanderDeconnexion}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 min-w-8 h-8 px-2 sm:px-2.5 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-400 bg-rose-50/80 dark:bg-rose-500/10 border border-rose-200/70 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20 hover:border-rose-300 dark:hover:border-rose-500/40 transition-all cursor-pointer"
              >
                <LogOut size={14} aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t("nav.logout")}</span>
              </button>
            </Bulle>
          </div>
        </div>

        <div className={`${colonne} mx-auto px-4 sm:px-6 pb-2.5 flex items-center gap-2`}>
          <BoutonsHistorique />
          <nav
            ref={barre}
            aria-label={titre}
            className={`flex-1 min-w-0 flex gap-1.5 overflow-x-auto no-scrollbar ${FONDUS[bords.gauche ? (bords.droite ? "deux" : "gauche") : bords.droite ? "droite" : "aucun"]}`}
          >
            {onglets.map((onglet) => (
              // Barre HORIZONTALE : la bulle s'ouvre au-dessus (position par défaut). C'est la barre latérale du
              // gestionnaire qui fait exception avec « droite ».
              <Bulle key={onglet.to} texte={onglet.tip} className="inline-flex shrink-0">
                <NavLink
                  to={onglet.to}
                  end={onglet.end}
                  aria-label={telephone && onglet.labelCourt ? onglet.label : undefined}
                  className={({ isActive }) =>
                    `px-3 py-2 sm:py-1.5 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 shrink-0 ${
                      isActive
                        ? "bg-linear-to-r from-brand-600 to-brand-700 text-white shadow-xs shadow-brand-500/25 font-semibold"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                    }`
                  }
                >
                  <onglet.icon size={15} strokeWidth={1.9} className="shrink-0" aria-hidden="true" />
                  <span>{telephone && onglet.labelCourt ? onglet.labelCourt : onglet.label}</span>
                </NavLink>
              </Bulle>
            ))}
          </nav>
        </div>
      </header>
      {/* Hors de l'en-tête : son flou d'arrière-plan ferait de lui le repère d'un élément en `fixed`. */}
      {dialogue}
    </>
  );
}
