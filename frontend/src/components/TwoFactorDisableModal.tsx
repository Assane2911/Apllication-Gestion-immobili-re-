import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useAuth } from "../context/auth";
import GoogleSignInButton from "./GoogleSignInButton";

interface TwoFactorDisableModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

/**
 * Désactivation de la double authentification — même principe de
 * confirmation que DeleteAccountModal (ressaisie du mot de passe, ou
 * reconnexion Google fraîche pour un compte Google-only) : un jeton déjà en
 * poche ne doit pas suffire, à lui seul, à annuler toute la protection.
 */
export default function TwoFactorDisableModal({ onSuccess, onClose }: TwoFactorDisableModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isGoogleOnly = user?.hasPassword === false;

  const [password, setPassword] = useState("");
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preuveIdentiteFournie = isGoogleOnly ? googleCredential !== null : password.length > 0;

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!preuveIdentiteFournie) return;
    setDisabling(true);
    setError(null);
    try {
      await api.post("/auth/2fa/disable", isGoogleOnly ? { googleCredential } : { password });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setDisabling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t("components.twoFactorDisable.title")}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {t("components.twoFactorDisable.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={disabling}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label={t("common.actions.close")}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleDisable} className="mt-4 space-y-4">
          {isGoogleOnly ? (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("components.deleteAccountModal.googleLabel")}
              </label>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                {t("components.deleteAccountModal.googleHint")}
              </p>
              <GoogleSignInButton
                onCredential={(credential) => {
                  setGoogleCredential(credential);
                  setError(null);
                }}
                onError={() => setError(t("auth.google.error"))}
                locale={i18n.language}
              />
              {googleCredential && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">
                  {t("components.deleteAccountModal.googleConfirmed")}
                </p>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="two-factor-disable-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("components.deleteAccountModal.passwordLabel")}
              </label>
              <input
                id="two-factor-disable-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={disabling} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
              {t("common.actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={disabling || !preuveIdentiteFournie}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
            >
              {disabling ? t("components.twoFactorDisable.disabling") : t("components.twoFactorDisable.confirmButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
