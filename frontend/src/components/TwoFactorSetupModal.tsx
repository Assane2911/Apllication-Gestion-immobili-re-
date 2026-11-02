import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import CadreModale from "./CadreModale";
import { AVIS, BOUTON_ANNULER, BOUTON_PLEIN, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

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
  const [codesCopies, setCodesCopies] = useState(false);

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

  async function copierCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCodesCopies(true);
    } catch {
      // Presse-papiers indisponible : les codes restent affichés, à noter à la main.
    }
  }

  return (
    <CadreModale
      titre={t("components.twoFactorSetup.title")}
      titreId="two-factor-setup-title"
      sousTitre={step === "backupCodes" ? t("components.twoFactorSetup.subtitleBackupCodes") : t("components.twoFactorSetup.subtitle")}
      onClose={onClose}
      fermable={!confirming}
      largeur="lg"
      boutonFermer={step === "qr"}
    >
      {step === "loading" && <p className="text-sm text-slate-600">{t("components.twoFactorSetup.loading")}</p>}

      {step === "error" && (
        <div className="space-y-4">
          <p role="alert" className={ERREUR}>
            {error}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={BOUTON_TRAIT}>
              {t("common.actions.close")}
            </button>
          </div>
        </div>
      )}

      {step === "qr" && (
        <form onSubmit={handleConfirm} className="space-y-4">
          {qrCodeDataUrl && (
            <div className="flex justify-center">
              <img src={qrCodeDataUrl} alt={t("components.twoFactorSetup.qrAlt")} className="h-44 w-44 border border-slate-400 bg-white p-2" />
            </div>
          )}

          {secret && (
            <div>
              <p className="text-center text-xs text-slate-600">{t("components.twoFactorSetup.manualEntryHint")}</p>
              <p className="mt-1 break-all text-center font-mono text-sm tracking-wider text-slate-900">{secret}</p>
            </div>
          )}

          <div>
            <label htmlFor="two-factor-setup-code" className={ETIQUETTE}>
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
              className={`${CHAMP} text-center font-mono tracking-[0.3em]`}
              placeholder={t("components.twoFactorSetup.codePlaceholder")}
            />
          </div>

          {error && (
            <p role="alert" className={ERREUR}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
            <button type="button" onClick={onClose} disabled={confirming} className={BOUTON_ANNULER}>
              {t("common.actions.cancel")}
            </button>
            <button type="submit" disabled={confirming} className={BOUTON_PLEIN}>
              {confirming ? t("components.twoFactorSetup.confirming") : t("components.twoFactorSetup.confirmButton")}
            </button>
          </div>
        </form>
      )}

      {step === "backupCodes" && (
        <div className="space-y-4">
          <p className={AVIS}>
            <span className="text-sm font-semibold">{t("components.twoFactorSetup.backupCodesWarning")}</span>
          </p>

          <div className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 font-mono text-sm">
            {backupCodes.map((backupCode) => (
              <div key={backupCode} className="bg-slate-50 px-3 py-2 text-center tracking-wider text-slate-900">
                {backupCode}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 pt-4">
            <button type="button" onClick={copierCodes} className={BOUTON_TRAIT}>
              {codesCopies ? t("components.twoFactorSetup.codesCopied") : t("components.twoFactorSetup.copyCodes")}
            </button>
            <button type="button" onClick={onSuccess} className={BOUTON_PLEIN}>
              {t("components.twoFactorSetup.done")}
            </button>
          </div>
        </div>
      )}
    </CadreModale>
  );
}
