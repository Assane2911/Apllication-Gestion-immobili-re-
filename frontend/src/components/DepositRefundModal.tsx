import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import type { ComparaisonEdl, Contract, RoomCondition } from "../types";
import CadreModale from "./CadreModale";
import { BOUTON_ANNULER, BOUTON_PLEIN, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

interface DepositRefundModalProps {
  contract: Contract;
  onSuccess: () => void;
  onClose: () => void;
}

interface DeductionRow {
  label: string;
  amount: string;
}

const ETAT_CLE: Record<RoomCondition, string> = { BON: "conditionGood", MOYEN: "conditionFair", MAUVAIS: "conditionPoor" };

export default function DepositRefundModal({ contract, onSuccess, onClose }: DepositRefundModalProps) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [rows, setRows] = useState<DeductionRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Constat de sortie comparé à l'entrée : rappelé à côté de la saisie, sans jamais en tirer de montant.
  const [constat, setConstat] = useState<ComparaisonEdl | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const { data } = await api.get<ComparaisonEdl | null>(`/contracts/${contract.id}/exit-comparison`);
        if (!annule && data && Array.isArray(data.rooms) && Array.isArray(data.keys)) setConstat(data);
      } catch {
        // Le rappel est un plus : sans lui, la restitution se saisit comme avant.
      }
    })();
    return () => {
      annule = true;
    };
  }, [contract.id]);

  const piecesDegradees = constat?.rooms.filter((r) => r.variation === "DEGRADE") ?? [];
  const clesManquantes = constat?.keys.filter((k) => k.missing > 0) ?? [];

  // Les lignes à moitié remplies (ajoutées puis abandonnées) ne comptent pas :
  // seules celles avec un motif ET un montant positif entrent dans le calcul
  // et dans ce qui sera envoyé à l'API.
  const deductionsValides = rows
    .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }))
    .filter((r) => r.label.length > 0 && r.amount > 0);
  const totalDeductions = deductionsValides.reduce((somme, d) => somme + d.amount, 0);
  const refundedAmount = contract.deposit - totalDeductions;
  const depasseLeDepot = totalDeductions > contract.deposit;

  function addRow(label = "") {
    setRows([...rows, { label, amount: "" }]);
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

  const pourcentRetenu = contract.deposit > 0 ? Math.round((totalDeductions / contract.deposit) * 100) : 0;

  return (
    <CadreModale titre={t("components.depositRefundModal.title")} titreId="deposit-refund-title" sousTitre={contract.property?.title} onClose={onClose} fermable={!saving} largeur="lg">
      <p className="font-mono text-xs text-slate-700">{t("components.depositRefundModal.depositAmount", { amount: formatMoney(contract.deposit, contract.currency) })}</p>

      {constat && (
        <section aria-label={t("components.depositRefundModal.exitFindings.title")} className="mt-4 space-y-2 border border-slate-300 bg-slate-50 p-3">
          <p className={ETIQUETTE}>{t("components.depositRefundModal.exitFindings.title")}</p>
          {piecesDegradees.length === 0 && clesManquantes.length === 0 ? (
            <p className="text-xs font-semibold text-ink-900">{t("components.depositRefundModal.exitFindings.none")}</p>
          ) : (
            <>
              <p className="text-xs text-slate-600">{t("components.depositRefundModal.exitFindings.intro")}</p>
              <ul className="divide-y divide-slate-200 border border-slate-200 bg-white">
                {piecesDegradees.map((p) => (
                  <li key={`piece-${p.name}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{p.name}</p>
                      <p className="text-slate-600">
                        {t("components.depositRefundModal.exitFindings.states", {
                          from: t(`manager.inspections.${ETAT_CLE[p.entry!.condition]}`),
                          to: t(`manager.inspections.${ETAT_CLE[p.exit!.condition]}`),
                        })}{" "}
                        — <span className="break-words">{p.exit!.notes.trim() || t("components.depositRefundModal.exitFindings.noNote")}</span>
                      </p>
                    </div>
                    <button type="button" onClick={() => addRow(t("components.depositRefundModal.exitFindings.roomLabel", { room: p.name }))} className="cursor-pointer border border-slate-400 bg-white px-2 py-1 font-semibold text-ink-900 hover:border-ink-900">
                      {t("components.depositRefundModal.exitFindings.add")}
                    </button>
                  </li>
                ))}
                {clesManquantes.map((k) => (
                  <li key={`cle-${k.label}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{k.label}</p>
                      <p className="text-slate-600">{t("components.depositRefundModal.exitFindings.missing", { count: k.missing })}</p>
                    </div>
                    <button type="button" onClick={() => addRow(t("components.depositRefundModal.exitFindings.keyLabel", { label: k.label }))} className="cursor-pointer border border-slate-400 bg-white px-2 py-1 font-semibold text-ink-900 hover:border-ink-900">
                      {t("components.depositRefundModal.exitFindings.add")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="mt-4 space-y-2">
        <p className={ETIQUETTE}>{t("components.depositRefundModal.deductionsTitle")}</p>
        {rows.length === 0 && <p className="text-xs font-semibold text-ink-900">{t("components.depositRefundModal.noDeductions")}</p>}
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              aria-label={t("components.depositRefundModal.deductionLabel")}
              type="text"
              value={row.label}
              onChange={(e) => updateRow(index, "label", e.target.value)}
              placeholder={t("components.depositRefundModal.deductionLabel")}
              className={`${CHAMP} min-w-0 flex-1 !py-1.5 !text-xs`}
            />
            <input
              aria-label={t("components.depositRefundModal.deductionAmount")}
              type="number"
              min="0"
              step="0.01"
              value={row.amount}
              onChange={(e) => updateRow(index, "amount", e.target.value)}
              placeholder={t("components.depositRefundModal.deductionAmount")}
              className={`${CHAMP} !w-28 shrink-0 !py-1.5 !text-xs`}
            />
            <button type="button" onClick={() => removeRow(index)} aria-label={t("components.depositRefundModal.removeDeduction")} className="cursor-pointer p-1 text-rose-700 hover:text-rose-900">
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={() => addRow()} className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-ink-900 underline decoration-ink-900/40 hover:text-orange-700">
            <Plus size={13} aria-hidden="true" /> {t("components.depositRefundModal.addDeduction")}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("components.depositRefundModal.quickLabel")}</span>
          {(["cleaning", "painting", "repairs"] as const).map((cle) => (
            <button key={cle} type="button" onClick={() => addRow(t(`components.depositRefundModal.quick.${cle}`))} className="cursor-pointer border border-slate-400 bg-white px-2 py-0.5 text-xs text-ink-900 hover:border-ink-900">
              + {t(`components.depositRefundModal.quick.${cle}`)}
            </button>
          ))}
        </div>
      </div>

      <dl className={`mt-4 grid grid-cols-2 gap-px border ${depasseLeDepot ? "border-rose-400 bg-rose-400" : "border-slate-300 bg-slate-300"}`}>
        <div className="bg-white p-3">
          <dt className={ETIQUETTE}>{t("components.depositRefundModal.totalDeductions")}</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{formatMoney(totalDeductions, contract.currency)}</dd>
          <dd className="text-xs text-slate-600">{t("components.depositRefundModal.retained", { percent: pourcentRetenu })}</dd>
        </div>
        <div className={`p-3 text-right ${depasseLeDepot ? "bg-rose-50" : "bg-slate-50"}`}>
          <dt className={ETIQUETTE}>{t("components.depositRefundModal.refundedAmount")}</dt>
          <dd className={`text-xl font-bold tabular-nums ${depasseLeDepot ? "text-rose-700" : "text-ink-900"}`}>{formatMoney(Math.max(0, refundedAmount), contract.currency)}</dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className={`mt-3 ${ERREUR}`}>
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-3 border-t border-slate-300 pt-4">
        <button type="button" onClick={onClose} className={BOUTON_ANNULER}>
          {t("common.actions.cancel")}
        </button>
        <button type="button" onClick={handleSubmit} disabled={saving || depasseLeDepot} className={BOUTON_PLEIN}>
          {saving ? t("components.depositRefundModal.validating") : t("components.depositRefundModal.validate")}
        </button>
      </div>
    </CadreModale>
  );
}
