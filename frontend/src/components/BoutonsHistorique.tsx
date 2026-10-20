import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useHistorique } from "../context/historique";
import Bulle from "./Bulle";

interface BoutonsHistoriqueProps {
  /**
   * « icone » : deux boutons carrés pour les en-têtes. « texte » : deux boutons avec leur libellé, pour l'écran de
   * chargement.
   */
  variante: "icone" | "texte";
  /**
   * Sans page précédente, « Retour » mène à l'accueil au lieu d'être inactif. Pour l'écran de chargement, où il sert
   * de sortie à une page qui ne vient pas ; dans un en-tête, renvoyer à l'accueil depuis l'accueil ne ferait que
   * recharger la page.
   */
  accueilSiVide?: boolean;
  className?: string;
}

const BOUTON_TEXTE =
  "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";
const BOUTON_ICONE =
  "w-9 h-9 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35";

/**
 * « Retour » et « Suivant » dans l'historique de navigation de l'application (voir HistoriqueContext). L'application
 * mobile n'a pas les boutons du navigateur, et sur ordinateur ils manquent à qui circule dans l'espace de gestion.
 * « Suivant » reste inactif tant qu'on n'est pas revenu en arrière : il n'y a alors rien devant.
 *
 * À placer dans le routeur.
 */
export default function BoutonsHistorique({ variante, accueilSiVide = false, className = "" }: BoutonsHistoriqueProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { peutReculer, peutAvancer } = useHistorique();

  const reculer = () => {
    if (peutReculer) navigate(-1);
    else if (accueilSiVide) navigate("/");
  };
  const retourActif = peutReculer || accueilSiVide;

  if (variante === "texte") {
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        <button
          type="button"
          disabled={!retourActif}
          onClick={reculer}
          className={`${BOUTON_TEXTE} border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-800`}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("common.loader.back")}
        </button>
        <button
          type="button"
          disabled={!peutAvancer}
          onClick={() => navigate(1)}
          className={`${BOUTON_TEXTE} border-brand-600 bg-brand-600 text-white enabled:hover:bg-brand-500`}
        >
          {t("common.loader.next")}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Bulle texte={t("common.tips.back")}>
        <button type="button" disabled={!retourActif} onClick={reculer} aria-label={t("common.loader.back")} className={BOUTON_ICONE}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
      </Bulle>
      <Bulle texte={t("common.tips.next")}>
        <button type="button" disabled={!peutAvancer} onClick={() => navigate(1)} aria-label={t("common.loader.next")} className={BOUTON_ICONE}>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </Bulle>
    </div>
  );
}
