import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useAuth } from "../context/auth";
import GoogleSignInButton from "./GoogleSignInButton";
import CadreModale from "./CadreModale";
import { BOUTON_ANNULER, BOUTON_DANGER, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

interface DeleteAccountModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

/**
 * Modale de suppression définitive du compte gestionnaire (audit sept. 2026 —
 * droit à l'effacement promis par la politique de confidentialité, voir
 * PolitiqueConfidentialitePage.tsx §8). Action irréversible : confirmée par
 * ressaisie du mot de passe actuel plutôt qu'une simple case à cocher.
 *
 * Cas particulier des comptes créés uniquement via "Se connecter avec Google"
 * (user.hasPassword === false, voir auth.controller.ts::deleteMyAccount) : ils
 * n'ont jamais eu de vrai mot de passe à ressaisir, donc la confirmation
 * demande à la place une reconnexion Google fraîche (même bouton que sur la
 * page de connexion), dont le jeton est revérifié côté serveur.
 *
 * Ne gère QUE l'appel API + ses états ; `onSuccess` (déconnexion + redirection)
 * reste à la charge de l'appelant, qui connaît le contexte de navigation.
 */
export default function DeleteAccountModal({ onSuccess, onClose }: DeleteAccountModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isGoogleOnly = user?.hasPassword === false;

  const [password, setPassword] = useState("");
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmationAttendue = t("components.deleteAccountModal.confirmWord");
  const confirmationValide = confirmText.trim().toUpperCase() === confirmationAttendue.toUpperCase();
  const preuveIdentiteFournie = isGoogleOnly ? googleCredential !== null : password.length > 0;

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmationValide || !preuveIdentiteFournie) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete("/auth/account", {
        data: isGoogleOnly ? { googleCredential } : { password },
      });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <CadreModale
      titre={t("components.deleteAccountModal.title")}
      titreId="delete-account-title"
      sousTitre={t("components.deleteAccountModal.subtitle")}
      onClose={onClose}
      fermable={!deleting}
      largeur="lg"
      danger
    >
      <div className={ERREUR}>
        <p className="text-sm font-semibold">{t("components.deleteAccountModal.warningTitle")}</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          <li>{t("components.deleteAccountModal.warningProperties")}</li>
          <li>{t("components.deleteAccountModal.warningTenants")}</li>
          <li>{t("components.deleteAccountModal.warningContracts")}</li>
          <li>{t("components.deleteAccountModal.warningDocuments")}</li>
        </ul>
      </div>

      <form onSubmit={handleDelete} className="mt-4 space-y-4">
        <div>
          <label htmlFor="delete-account-confirm" className={ETIQUETTE}>
            {t("components.deleteAccountModal.confirmLabel", { word: confirmationAttendue })}
          </label>
          <input
            id="delete-account-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={confirmationAttendue}
            autoComplete="off"
            className={CHAMP}
          />
        </div>

        {isGoogleOnly ? (
          <div>
            <span className={ETIQUETTE}>{t("components.deleteAccountModal.googleLabel")}</span>
            <p className="mb-2 text-xs text-slate-600">{t("components.deleteAccountModal.googleHint")}</p>
            <GoogleSignInButton
              onCredential={(credential) => {
                setGoogleCredential(credential);
                setError(null);
              }}
              onError={() => setError(t("auth.google.error"))}
              locale={i18n.language}
            />
            {googleCredential && <p className="mt-2 text-xs font-semibold text-ink-900">{t("components.deleteAccountModal.googleConfirmed")}</p>}
          </div>
        ) : (
          <div>
            <label htmlFor="delete-account-password" className={ETIQUETTE}>
              {t("components.deleteAccountModal.passwordLabel")}
            </label>
            <input
              id="delete-account-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={CHAMP}
            />
          </div>
        )}

        {error && (
          <p role="alert" className={ERREUR}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
          <button type="button" onClick={onClose} disabled={deleting} className={BOUTON_ANNULER}>
            {t("common.actions.cancel")}
          </button>
          <button type="submit" disabled={deleting || !confirmationValide || !preuveIdentiteFournie} className={BOUTON_DANGER}>
            {deleting ? t("components.deleteAccountModal.deleting") : t("components.deleteAccountModal.confirmButton")}
          </button>
        </div>
      </form>
    </CadreModale>
  );
}
