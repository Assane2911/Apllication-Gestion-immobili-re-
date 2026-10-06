import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import type { Contract } from "../types";

interface DepositRefundModalProps {
  contract: Contract;
  onSuccess: () => void;
  onClose: () => void;
}

interface DeductionRow {
  label: string;
  amount: string;
}

export default function DepositRefundModal({ contract, onSuccess, onClose }: DepositRefundModalProps) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [rows, setRows] = useState<DeductionRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Les lignes à moitié remplies (ajoutées puis abandonnées) ne comptent pas :
  // seules celles avec un motif ET un montant positif entrent dans le calcul
  // et dans ce qui sera envoyé à l'API.
  const deductionsValides = rows
    .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }))
    .filter((r) => r.label.length > 0 && r.amount > 0);
  const totalDeductions = deductionsValides.reduce((somme, d) => somme + d.amount, 0);
  const refundedAmount = contract.deposit - totalDeductions;
  const depasseLeDepot = totalDeductions > contract.deposit;

  function addRow() {
    setRows([...rows, { label: "", amount: "" }]);
  }

  function updateRow(index: number, field: keyof DeductionRow, value: string) {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (depasseLeDepot) {
      setError(t("components.depositRefundModal.exceedsDeposit"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put(`/contracts/${contract.id}/deposit-refund`, { deductions: deductionsValides });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 transition-all duration-200 max-h-[90vh] overflow-y-auto ${
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("components.depositRefundModal.title")}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{contract.property?.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label={t("common.actions.close")}>
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 mt-4">
          {t("components.depositRefundModal.depositAmount", { amount: formatMoney(contract.deposit, contract.currency) })}
        </p>

        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("components.depositRefundModal.deductionsTitle")}</p>
          {rows.length === 0 && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{t("components.depositRefundModal.noDeductions")}</p>
          )}
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={row.label}
                onChange={(e) => updateRow(index, "label", e.target.value)}
                placeholder={t("components.depositRefundModal.deductionLabel")}
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.amount}
                onChange={(e) => updateRow(index, "amount", e.target.value)}
                placeholder={t("components.depositRefundModal.deductionAmount")}
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                aria-label={t("components.depositRefundModal.removeDeduction")}
                className="text-red-500 hover:text-red-700 dark:hover:text-red-400 p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="text-xs text-brand-600 dark:text-brand-400 font-semibold hover:underline inline-flex items-center gap-1"
          >
            <Plus size={13} aria-hidden="true" /> {t("components.depositRefundModal.addDeduction")}
          </button>
        </div>

        <div className={`mt-4 rounded-xl border p-3 text-center ${depasseLeDepot ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"}`}>
          <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-400">
            {t("components.depositRefundModal.refundedAmount")}
          </span>
          <div className={`text-xl font-bold ${depasseLeDepot ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
            {formatMoney(Math.max(0, refundedAmount), contract.currency)}
          </div>
        </div>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || depasseLeDepot}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
          >
            {saving ? t("components.depositRefundModal.validating") : t("components.depositRefundModal.validate")}
          </button>
        </div>
      </div>
    </div>
  );
}
