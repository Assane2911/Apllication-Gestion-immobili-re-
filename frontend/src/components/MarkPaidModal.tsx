import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import type { MoyenSaisiAlaMain } from "../types";
import CadreModale from "./CadreModale";
import ChampDate from "./ChampDate";
import { AIDE, AVIS, BOUTON_ANNULER, BOUTON_PLEIN, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

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
  const solde = montantValide && !partiel;

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

  const champ = CHAMP;
  const etiquette = ETIQUETTE;

  return (
    <CadreModale
      titre={t("components.markPaidModal.title")}
      titreId="mark-paid-title"
      sousTitre={t("components.markPaidModal.intro", { name: tenantName, amount: amountLabel })}
      onClose={onClose}
      fermable={!saving}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className={AVIS}>{partiel ? t("components.markPaidModal.warningPartial") : t("components.markPaidModal.warning")}</p>

        <div>
          <label htmlFor="mark-paid-amount" className={etiquette}>
            {t("components.markPaidModal.amountLabel")}
          </label>
          <div className="flex gap-2">
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
            {!solde && (
              <button type="button" onClick={() => setMontant(String(remaining))} className={`${BOUTON_TRAIT} shrink-0`}>
                {t("components.markPaidModal.settle")}
              </button>
            )}
          </div>
          <p className={AIDE}>{t("components.markPaidModal.amountHint", { remaining: formatMoney(remaining, currency) })}</p>
          {partiel && (
            <p className="mt-1 font-mono text-xs font-semibold text-orange-700">
              {t("components.markPaidModal.afterPayment", { amount: formatMoney(Math.round((remaining - montantSaisi) * 100) / 100, currency) })}
            </p>
          )}
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
          <ChampDate id="mark-paid-date" required max={aujourdhui} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={champ} />
          <p className={AIDE}>{t("components.markPaidModal.dateHint")}</p>
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
          <p role="alert" className={ERREUR}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
          <button type="button" onClick={onClose} disabled={saving} className={BOUTON_ANNULER}>
            {t("common.actions.cancel")}
          </button>
          <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
            {saving ? t("components.markPaidModal.saving") : partiel ? t("components.markPaidModal.confirmPartial") : t("components.markPaidModal.confirmButton")}
          </button>
        </div>
      </form>
    </CadreModale>
  );
}
