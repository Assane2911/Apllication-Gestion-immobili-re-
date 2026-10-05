import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";

interface TwoFactorSetupModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

/**
 * Enrôlement à la double authentification (TOTP), en deux temps côté serveur
 * (voir twoFactor.controller.ts) : `setup` génère un secret encore sans
 * effet (totpEnabledAt reste vide), `confirm` prouve qu'il a bien été scanné
 * en exigeant le code qu'affiche l'application d'authentification — c'est ce
 * second appel, et lui seul, qui active réellement la 2FA.
 *
 * Les codes de secours ne sont renvoyés qu'une fois, par `confirm` : cet
 * écran est la seule occasion de les noter, d'où l'étape dédiée avant de
 * fermer (onSuccess n'est appelé qu'après que le gestionnaire ait cliqué
 * "Terminé", jamais automatiquement).
 */
export default function TwoFactorSetupModal({ onSuccess, onClose }: TwoFactorSetupModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"loading" | "qr" | "backupCodes" | "error">("loading");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    api
      .post("/auth/2fa/setup")
      .then(({ data }) => {
        setQrCodeDataUrl(data.qrCodeDataUrl);
        setSecret(data.secret);
        setStep("qr");
      })
      .catch((err) => {
        setError(apiErrorMessage(err));
        setStep("error");
      });
    // Un seul enrôlement par ouverture de la modale : setup() est appelé une
    // fois au montage, jamais ré-exécuté par un re-rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/2fa/confirm", { code: code.trim() });
      setBackupCodes(data.backupCodes);
      setStep("backupCodes");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t("components.twoFactorSetup.title")}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {step === "backupCodes" ? t("components.twoFactorSetup.subtitleBackupCodes") : t("components.twoFactorSetup.subtitle")}
            </p>
          </div>
          {step === "qr" && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={t("common.actions.close")}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {step === "loading" && (
          <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">{t("components.twoFactorSetup.loading")}</p>
        )}

        {step === "error" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
                {t("common.actions.close")}
              </button>
            </div>
          </div>
        )}

        {step === "qr" && (
          <form onSubmit={handleConfirm} className="mt-4 space-y-4">
            {qrCodeDataUrl && (
              <div className="flex justify-center">
                <img
                  src={qrCodeDataUrl}
                  alt={t("components.twoFactorSetup.qrAlt")}
                  className="w-44 h-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-2"
                />
              </div>
            )}

            {secret && (
              <div>
                <p className="text-xs text-slate-600 dark:text-slate-400 text-center">
                  {t("components.twoFactorSetup.manualEntryHint")}
                </p>
                <p className="mt-1 text-center font-mono text-sm tracking-wider text-slate-900 dark:text-slate-100 break-all">
                  {secret}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="two-factor-setup-code" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("components.twoFactorSetup.codeLabel")}
              </label>
              <input
                id="two-factor-setup-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full text-sm text-center tracking-[0.3em] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
                placeholder={t("components.twoFactorSetup.codePlaceholder")}
              />
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} disabled={confirming} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
                {t("common.actions.cancel")}
              </button>
              <button
                type="submit"
                disabled={confirming}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
              >
                {confirming ? t("components.twoFactorSetup.confirming") : t("components.twoFactorSetup.confirmButton")}
              </button>
            </div>
          </form>
        )}

        {step === "backupCodes" && (
          <div className="mt-4 space-y-4">
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
              <p className="text-sm text-amber-800 dark:text-amber-300 font-semibold">
                {t("components.twoFactorSetup.backupCodesWarning")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((backupCode) => (
                <div
                  key={backupCode}
                  className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-center tracking-wider"
                >
                  {backupCode}
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onSuccess}
                className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
              >
                {t("components.twoFactorSetup.done")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
