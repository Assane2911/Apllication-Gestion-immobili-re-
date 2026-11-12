import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useAuth } from "../context/auth";
import GoogleSignInButton from "./GoogleSignInButton";
import CadreModale from "./CadreModale";
import { BOUTON_ANNULER, BOUTON_DANGER, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

interface TwoFactorDisableModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

/**
 * Désactivation de la double authentification — même principe de
 * confirmation que DeleteAccountModal (ressaisie du mot de passe, ou
 * reconnexion Google fraîche pour un compte Google-only) : un jeton déjà en
 * poche ne doit pas suffire, à lui seul, à annuler toute la protection —
 * et le second facteur lui-même (code de l'application, ou code de secours)
 * est exigé en plus.
 */
export default function TwoFactorDisableModal({ onSuccess, onClose }: TwoFactorDisableModalProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isGoogleOnly = user?.hasPassword === false;

  const [password, setPassword] = useState("");
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deux preuves : l'identité (mot de passe ou Google) ET le second facteur lui-même (code de l'application, ou code de secours).
  const preuveIdentiteFournie = (isGoogleOnly ? googleCredential !== null : password.length > 0) && code.trim().length >= 6;

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!preuveIdentiteFournie) return;
    setDisabling(true);
    setError(null);
    try {
      await api.post("/auth/2fa/disable", isGoogleOnly ? { googleCredential, code: code.trim() } : { password, code: code.trim() });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setDisabling(false);
    }
  }

  return (
    <CadreModale
      titre={t("components.twoFactorDisable.title")}
      titreId="two-factor-disable-title"
      sousTitre={t("components.twoFactorDisable.subtitle")}
      onClose={onClose}
      fermable={!disabling}
      largeur="lg"
      danger
    >
      <form onSubmit={handleDisable} className="space-y-4">
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
            <label htmlFor="two-factor-disable-password" className={ETIQUETTE}>
              {t("components.deleteAccountModal.passwordLabel")}
            </label>
            <input
              id="two-factor-disable-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={CHAMP}
            />
          </div>
        )}

        <div>
          <label htmlFor="two-factor-disable-code" className={ETIQUETTE}>
            {t("components.twoFactorDisable.codeLabel")}
          </label>
          <input
            id="two-factor-disable-code"
            type="text"
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            maxLength={12}
            className={CHAMP}
          />
          <p className="mt-1 text-xs text-slate-600">{t("components.twoFactorDisable.codeHint")}</p>
        </div>

        {error && (
          <p role="alert" className={ERREUR}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
          <button type="button" onClick={onClose} disabled={disabling} className={BOUTON_ANNULER}>
            {t("common.actions.cancel")}
          </button>
          <button type="submit" disabled={disabling || !preuveIdentiteFournie} className={BOUTON_DANGER}>
            {disabling ? t("components.twoFactorDisable.disabling") : t("components.twoFactorDisable.confirmButton")}
          </button>
        </div>
      </form>
    </CadreModale>
  );
}
