import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import type { MoyenSaisiAlaMain } from "../types";
import { useDialogue } from "../hooks/useDialogue";

const MOYENS: MoyenSaisiAlaMain[] = ["BANK_TRANSFER", "CASH", "CHEQUE", "MOBILE_MONEY"];

interface MarkPaidModalProps {
  invoiceId: string;
  /** Nom du locataire et montant déjà formaté, pour rappeler QUI et COMBIEN. */
  tenantName: string;
  amountLabel: string;
  /** Reste dû de la facture : montant proposé par défaut, et plafond. */
  remaining: number;
  currency?: string;
  onSuccess: () => void;
  onClose: () => void;
}

/** « AAAA-MM-JJ » du jour LOCAL de l'utilisateur (toISOString donnerait le jour UTC). */
function aujourdhuiLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Marquer un loyer réglé à la main : moyen, date réelle d'encaissement et
 * référence. Le geste est SANS RETOUR (PAYÉE est un état terminal côté serveur)
 * et envoie la quittance au locataire : la fenêtre rappelle qui et combien, et
 * dit que la date choisie classe le loyer dans les bilans — un loyer reçu le
 * 28 décembre et saisi le 2 janvier doit être daté du 28.
 */
export default function MarkPaidModal({ invoiceId, tenantName, amountLabel, remaining, currency, onSuccess, onClose }: MarkPaidModalProps) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const aujourdhui = aujourdhuiLocal();
  const [method, setMethod] = useState<MoyenSaisiAlaMain>("BANK_TRANSFER");
  const [montant, setMontant] = useState(String(remaining));
  const [paidAt, setPaidAt] = useState(aujourdhui);
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const montantSaisi = Number(montant.replace(",", "."));
  const montantValide = Number.isFinite(montantSaisi) && montantSaisi > 0 && montantSaisi <= remaining + 0.005;
  const partiel = montantValide && montantSaisi < remaining - 0.005;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!montantValide) {
      setError(t("components.markPaidModal.amountInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/invoices/${invoiceId}/mark-paid`, {
        paymentMethod: method,
        amount: montantSaisi,
        paidAt: paidAt || aujourdhui,
        ...(reference.trim() ? { paymentRef: reference.trim() } : {}),
      });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
      setSaving(false);
    }
  }

  const champ =
    "w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500";
  const etiquette = "block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1";

  const dialogue = useDialogue({ onClose, titreId: "mark-paid-title", fermable: !saving });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        {...dialogue}
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id="mark-paid-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t("components.markPaidModal.title")}
            </h3>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
              {t("components.markPaidModal.intro", { name: tenantName, amount: amountLabel })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label={t("common.actions.close")}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-2">
            {partiel ? t("components.markPaidModal.warningPartial") : t("components.markPaidModal.warning")}
          </p>

          <div>
            <label htmlFor="mark-paid-amount" className={etiquette}>
              {t("components.markPaidModal.amountLabel")}
            </label>
            <input
              id="mark-paid-amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              required
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className={champ}
            />
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              {t("components.markPaidModal.amountHint", { remaining: formatMoney(remaining, currency) })}
            </p>
          </div>

          <div>
            <label htmlFor="mark-paid-method" className={etiquette}>
              {t("components.markPaidModal.methodLabel")}
            </label>
            <select id="mark-paid-method" value={method} onChange={(e) => setMethod(e.target.value as MoyenSaisiAlaMain)} className={champ}>
              {MOYENS.map((m) => (
                <option key={m} value={m}>
                  {t(`common.paymentMethods.${m}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mark-paid-date" className={etiquette}>
              {t("components.markPaidModal.dateLabel")}
            </label>
            <input
              id="mark-paid-date"
              type="date"
              required
              max={aujourdhui}
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className={champ}
            />
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("components.markPaidModal.dateHint")}</p>
          </div>

          <div>
            <label htmlFor="mark-paid-ref" className={etiquette}>
              {t("components.markPaidModal.referenceLabel")}
            </label>
            <input
              id="mark-paid-ref"
              type="text"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("components.markPaidModal.referencePlaceholder")}
              className={champ}
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
              {t("common.actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
            >
              {saving
                ? t("components.markPaidModal.saving")
                : partiel
                ? t("components.markPaidModal.confirmPartial")
                : t("components.markPaidModal.confirmButton")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
