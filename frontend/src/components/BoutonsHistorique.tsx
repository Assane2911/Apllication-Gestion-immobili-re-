import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useHistorique } from "../context/historique";
import Bulle from "./Bulle";

const BOUTON =
  "w-9 h-9 shrink-0 rounded-xl border border-contour-200 bg-white text-slate-600 flex items-center justify-center transition-colors cursor-pointer enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35";

/**
 * « Retour » et « Suivant » dans l'historique de navigation de l'application (voir HistoriqueContext). L'application
 * mobile n'a pas les boutons du navigateur, et sur ordinateur ils manquent à qui circule dans l'espace de gestion.
 *
 * « Retour » est inactif sans page précédente (renvoyer à l'accueil depuis l'accueil ne ferait que recharger la
 * page), « Suivant » tant qu'on n'est pas revenu en arrière : il n'y a alors rien devant.
 *
 * À placer dans le routeur.
 */
export default function BoutonsHistorique({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { peutReculer, peutAvancer } = useHistorique();

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Bulle texte={t("common.tips.back")}>
        <button type="button" disabled={!peutReculer} onClick={() => navigate(-1)} aria-label={t("common.history.back")} className={BOUTON}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
      </Bulle>
      <Bulle texte={t("common.tips.next")}>
        <button type="button" disabled={!peutAvancer} onClick={() => navigate(1)} aria-label={t("common.history.next")} className={BOUTON}>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </Bulle>
    </div>
  );
}
