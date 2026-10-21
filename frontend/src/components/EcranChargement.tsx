import { useTranslation } from "react-i18next";
import { useInRouterContext } from "react-router-dom";
import BoutonsHistorique from "./BoutonsHistorique";
import LogoAnime from "./LogoAnime";

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
      {dansUnRouteur && <BoutonsHistorique variante="texte" accueilSiVide />}
    </div>
  );
}
