import { useTranslation } from "react-i18next";
import Dialogue from "./Dialogue";

/**
 * Fenêtre de confirmation avant de fermer la session. Le bouton « Se déconnecter » est collé à d'autres sur
 * téléphone : un appui involontaire fermait la session sans rien demander.
 *
 * « Annuler » reçoit le focus et Échap équivaut à « Annuler » : sans réponse claire, on ne déconnecte pas. Même
 * fenêtre que l'avertissement d'inactivité (InactiviteSession), au-dessus de tout le reste.
 */
export default function DialogueDeconnexion({ onAnnuler, onConfirmer }: { onAnnuler: () => void; onConfirmer: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-slate-900/60 p-4">
      <Dialogue
        onClose={onAnnuler}
        titreId="deconnexion-titre"
        className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-contour-200"
      >
        <h2 id="deconnexion-titre" className="text-base font-bold text-slate-900">
          {t("components.deconnexion.title")}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{t("components.deconnexion.message")}</p>
        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onAnnuler}
            data-autofocus
            className="text-sm font-semibold px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            {t("components.deconnexion.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
          >
            {t("nav.logout")}
          </button>
        </div>
      </Dialogue>
    </div>
  );
}
