import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useDialogue } from "../hooks/useDialogue";

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

  const dialogue = useDialogue({ onClose, titreId: "payment-day-title", fermable: !saving });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        {...dialogue}
        className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-contour-200"
      >
        <div className="flex items-start justify-between">
          <h3 id="payment-day-title" className="text-lg font-bold text-slate-900">
            {t("components.paymentDayModal.title")}
          </h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t("common.actions.close")} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="payment-day-select" className="block text-xs font-semibold text-slate-700 mb-1">
              {t("manager.contracts.fields.paymentDay")}
            </label>
            <select
              id="payment-day-select"
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("manager.contracts.fields.paymentDayStart")} ({startDay})</option>
              {JOURS_ECHEANCE.map((jour) => (
                <option key={jour} value={jour}>
                  {jour === 31 ? t("manager.contracts.fields.paymentDayLast") : t("manager.contracts.fields.paymentDayOption", { day: jour })}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-600">{t("components.paymentDayModal.hint")}</p>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
              {t("common.actions.cancel")}
            </button>
            <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg">
              {saving ? t("components.paymentDayModal.saving") : t("components.paymentDayModal.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
