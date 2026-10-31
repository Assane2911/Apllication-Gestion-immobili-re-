import { ChevronsLeft, ChevronsRight, LogOut, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { enregistrerCoucheRetour } from "../utils/couchesRetour";
import Logo from "./Logo";

export interface EntreeMenu {
  to: string;
  key: string;
  icone: LucideIcon;
}
export interface GroupeMenu {
  cle: string;
  items: ReadonlyArray<EntreeMenu>;
}

interface Props {
  groupes: ReadonlyArray<GroupeMenu>;
  /** Préfixe des libellés de page (`nav.manager` → `nav.manager.dashboard`). */
  prefixeLibelles: string;
  /** Préfixe des noms de rubrique (`nav.groups` → `nav.groups.finance`), lus par les lecteurs d'écran. */
  prefixeRubriques: string;
  /** Page d'accueil de l'espace : seule à n'être « active » que sur son adresse exacte. */
  racine: string;
  sousTitre: string;
  /** Clé du réglage « menu déployé en permanence », propre à chaque espace. */
  cleStockage: string;
  email?: string;
  ouvertMobile: boolean;
  onFermerMobile: () => void;
  onDeconnexion: () => void;
  /** Blocs du pied de menu (essai, monnaie, langue…) : ils n'apparaissent que menu ouvert. */
  enPied?: ReactNode;
}

const lireEpingle = (cle: string) => {
  try {
    return localStorage.getItem(cle) === "1";
  } catch {
    return false;
  }
};

/**
 * Menu latéral des espaces (gestionnaire, administration), sur le modèle du tableau de bord de Supabase : une colonne
 * d'icônes qui se déploie par-dessus le contenu quand la souris (ou le clavier) l'atteint et se referme quand elle la
 * quitte. « Garder le menu déployé » l'épingle ouvert. Sur téléphone, c'est un tiroir toujours déployé.
 * Rend aussi la réserve de place de la colonne et le voile du tiroir : le parent n'a qu'à poser le contenu à côté.
 */
export default function MenuLateral({ groupes, prefixeLibelles, prefixeRubriques, racine, sousTitre, cleStockage, email, ouvertMobile, onFermerMobile, onDeconnexion, enPied }: Props) {
  const { t } = useTranslation();
  const [epingle, setEpingle] = useState(() => lireEpingle(cleStockage));
  const [survol, setSurvol] = useState(false);
  const ouvert = epingle || survol;
  const basculerEpingle = () =>
    setEpingle((actuel) => {
      try {
        localStorage.setItem(cleStockage, actuel ? "0" : "1");
      } catch {
        /* le réglage n'est alors pas retenu, sans gravité */
      }
      return !actuel;
    });
  // Texte qui n'a sa place que menu ouvert : il s'efface en colonne d'icônes.
  const etiquette = ouvert ? "" : "sm:opacity-0 sm:pointer-events-none";

  // Le bouton retour d'Android referme le tiroir ouvert avant de changer de page (voir useBoutonRetourAndroid).
  useEffect(() => {
    if (!ouvertMobile) return;
    return enregistrerCoucheRetour(onFermerMobile);
  }, [ouvertMobile, onFermerMobile]);

  return (
    <>
      {ouvertMobile && <div className="fixed inset-0 bg-slate-950/60 z-30 sm:hidden transition-opacity" onClick={onFermerMobile} aria-hidden="true" />}
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
        } ${ouvertMobile ? "translate-x-0" : "-translate-x-full"} sm:translate-x-0`}
      >
        <div className="shrink-0 h-16 px-3.5 flex items-center justify-between gap-3 border-b border-slate-300">
          <div className="flex items-center gap-3 min-w-0">
            <Logo />
            <div className={`min-w-0 whitespace-nowrap transition-opacity duration-150 ${etiquette}`}>
              <h1 className="text-sm font-extrabold leading-tight truncate">{t("common.appName")}</h1>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600 truncate">{sousTitre}</p>
            </div>
          </div>
          <button
            onClick={onFermerMobile}
            className="sm:hidden shrink-0 w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 hover:text-slate-900 transition-colors"
            aria-label={t("components.managerLayout.closeMenuAria")}
          >
            <X size={15} />
          </button>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2" onClick={onFermerMobile}>
          {groupes.map((groupe, rang) => (
            // Des filets séparent les rubriques, sans intitulé, comme dans Supabase ; le nom reste lu par les lecteurs d'écran.
            <div key={groupe.cle} role="group" aria-label={t(`${prefixeRubriques}.${groupe.cle}`)} className={rang > 0 ? "mt-2 pt-2 border-t border-slate-300" : ""}>
              <div className="space-y-0.5">
                {groupe.items.map((item) => (
                  // Pas de bulle d'aide ici : le menu se déploie au survol et donne déjà le nom de la page.
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === racine}
                    className={({ isActive }) =>
                      `group flex items-center gap-3.5 h-11 px-3.5 text-sm whitespace-nowrap rounded-md transition-colors duration-150 ${
                        isActive ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icone size={20} strokeWidth={isActive ? 1.9 : 1.6} aria-hidden="true" className={`shrink-0 ${isActive ? "text-ink-900" : "text-slate-600 group-hover:text-ink-900"}`} />
                        <span className={`truncate transition-opacity duration-150 ${etiquette}`}>{t(`${prefixeLibelles}.${item.key}`)}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-slate-300 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-white">
          {enPied && <div className={`w-full ${ouvert ? "" : "sm:hidden"}`}>{enPied}</div>}
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
          <div className="flex items-center gap-3.5 h-11 px-2 whitespace-nowrap min-w-0" title={email}>
            <div className="w-8 h-8 bg-ink-900 flex items-center justify-center text-xs font-bold text-white shrink-0">{(email?.[0] || "?").toUpperCase()}</div>
            <div className={`min-w-0 transition-opacity duration-150 ${etiquette}`}>
              <p className="text-xs text-slate-900 font-medium truncate">{email}</p>
            </div>
          </div>
          <button
            onClick={onDeconnexion}
            className="w-full h-11 flex items-center gap-3.5 px-3.5 rounded-md text-sm text-slate-700 whitespace-nowrap hover:bg-rose-500/10 hover:text-rose-700 transition-colors cursor-pointer"
          >
            <LogOut size={20} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />
            <span className={`transition-opacity duration-150 ${etiquette}`}>{t("nav.logout")}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
