import { useTranslation } from "react-i18next";
import Dialogue from "./Dialogue";
import { BOUTON_DANGER, BOUTON_TRAIT } from "./styleFormulaire";

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
        className="w-full max-w-sm border-2 border-ink-900 bg-white p-6"
      >
        <h2 id="deconnexion-titre" className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">
          {t("components.deconnexion.title")}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{t("components.deconnexion.message")}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-300 pt-4">
          <button
            type="button"
            onClick={onAnnuler}
            data-autofocus
            className={BOUTON_TRAIT}
          >
            {t("components.deconnexion.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            className={BOUTON_DANGER}
          >
            {t("nav.logout")}
          </button>
        </div>
      </Dialogue>
    </div>
  );
}
