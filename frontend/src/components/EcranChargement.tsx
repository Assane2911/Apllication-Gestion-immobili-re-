import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { useHistorique } from "../context/historique";
import LogoAnime from "./LogoAnime";

const BOUTON =
  "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";

/** Boutons « Retour » et « Suivant ». Séparés du reste : ils ont besoin du routeur, que l'écran peut ne pas avoir. */
function BoutonsNavigation() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { peutReculer, peutAvancer } = useHistorique();

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => (peutReculer ? navigate(-1) : navigate("/"))}
        className={`${BOUTON} border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800`}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t("common.loader.back")}
      </button>
      <button
        type="button"
        disabled={!peutAvancer}
        onClick={() => navigate(1)}
        className={`${BOUTON} border-brand-600 bg-brand-600 text-white enabled:hover:bg-brand-500`}
      >
        {t("common.loader.next")}
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Écran affiché pendant le chargement d'une page : le logo se dessine, et deux boutons évitent de rester coincé sur
 * une page lente — « Retour » (à l'accueil quand il n'y a pas de page précédente, plutôt que de ne rien faire) et
 * « Suivant » (inactif tant qu'on n'est pas revenu en arrière, voir HistoriqueContext).
 *
 * L'écran n'apparaît qu'au bout d'un court instant (`.ecran-chargement`) : un chargement qui dure à peine plus d'un
 * battement de cils ne fait ainsi clignoter ni logo ni boutons.
 */
export default function EcranChargement({ className = "min-h-[60vh]" }: { className?: string }) {
  const { t } = useTranslation();
  const dansUnRouteur = useInRouterContext();

  return (
    <div role="status" aria-live="polite" className={`ecran-chargement flex flex-col items-center justify-center gap-4 px-6 text-center ${className}`}>
      <LogoAnime />
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{t("common.loader.loading")}</p>
      {dansUnRouteur && <BoutonsNavigation />}
    </div>
  );
}
