import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";

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
 * Ne gère QUE l'appel API + ses états ; `onSuccess` (déconnexion + redirection)
 * reste à la charge de l'appelant, qui connaît le contexte de navigation.
 */
export default function DeleteAccountModal({ onSuccess, onClose }: DeleteAccountModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmationAttendue = t("components.deleteAccountModal.confirmWord");
  const confirmationValide = confirmText.trim().toUpperCase() === confirmationAttendue.toUpperCase();

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmationValide) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete("/auth/account", { data: { password } });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">
              {t("components.deleteAccountModal.title")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t("components.deleteAccountModal.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-semibold"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-red-800 dark:text-red-300 font-semibold">
            {t("components.deleteAccountModal.warningTitle")}
          </p>
          <ul className="text-xs text-red-700 dark:text-red-300 mt-2 space-y-1 list-disc list-inside">
            <li>{t("components.deleteAccountModal.warningProperties")}</li>
            <li>{t("components.deleteAccountModal.warningTenants")}</li>
            <li>{t("components.deleteAccountModal.warningContracts")}</li>
            <li>{t("components.deleteAccountModal.warningDocuments")}</li>
          </ul>
        </div>

        <form onSubmit={handleDelete} className="mt-4 space-y-4">
          <div>
            <label htmlFor="delete-account-confirm" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t("components.deleteAccountModal.confirmLabel", { word: confirmationAttendue })}
            </label>
            <input
              id="delete-account-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmationAttendue}
              autoComplete="off"
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label htmlFor="delete-account-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t("components.deleteAccountModal.passwordLabel")}
            </label>
            <input
              id="delete-account-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-red-500"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={deleting || !confirmationValide || password.length === 0}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
            >
              {deleting
                ? t("components.deleteAccountModal.deleting")
                : t("components.deleteAccountModal.confirmButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
