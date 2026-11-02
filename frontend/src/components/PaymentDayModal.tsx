import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import CadreModale from "./CadreModale";
import { AIDE, BOUTON_ANNULER, BOUTON_PLEIN, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

/** Options du jour d'échéance : 1 à 28 (valables tous les mois) et « dernier jour du mois » (31). */
export const JOURS_ECHEANCE = [...Array.from({ length: 28 }, (_, i) => i + 1), 31];

interface PaymentDayModalProps {
  contractId: string;
  /** Jour actuellement enregistré sur le contrat ; `null` : le jour de la date de début. */
  paymentDay: number | null;
  /** Jour du mois de la date de début du bail (UTC, comme le serveur). */
  startDay: number;
  onSuccess: () => void;
  onClose: () => void;
}

/** Modification du jour d'échéance d'un contrat existant (non encore signé par le locataire). */
export default function PaymentDayModal({ contractId, paymentDay, startDay, onSuccess, onClose }: PaymentDayModalProps) {
  const { t } = useTranslation();
  const [valeur, setValeur] = useState(paymentDay === null ? "" : String(paymentDay));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.put(`/contracts/${contractId}`, { paymentDay: valeur === "" ? null : Number(valeur) });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <CadreModale titre={t("components.paymentDayModal.title")} titreId="payment-day-title" onClose={onClose} fermable={!saving} largeur="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="payment-day-select" className={ETIQUETTE}>
            {t("manager.contracts.fields.paymentDay")}
          </label>
          <select id="payment-day-select" value={valeur} onChange={(e) => setValeur(e.target.value)} className={CHAMP}>
            <option value="">
              {t("manager.contracts.fields.paymentDayStart")} ({startDay})
            </option>
            {JOURS_ECHEANCE.map((jour) => (
              <option key={jour} value={jour}>
                {jour === 31 ? t("manager.contracts.fields.paymentDayLast") : t("manager.contracts.fields.paymentDayOption", { day: jour })}
              </option>
            ))}
          </select>
          <p className={AIDE}>{t("components.paymentDayModal.hint")}</p>
        </div>
        {error && (
          <p role="alert" className={ERREUR}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
          <button type="button" onClick={onClose} disabled={saving} className={BOUTON_ANNULER}>
            {t("common.actions.cancel")}
          </button>
          <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
            {saving ? t("components.paymentDayModal.saving") : t("components.paymentDayModal.save")}
          </button>
        </div>
      </form>
    </CadreModale>
  );
}
