import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import type { CrgSynthesis, PayoutMethod } from "../types";

const MOYENS: PayoutMethod[] = ["BANK_TRANSFER", "MOBILE_MONEY", "CASH", "CHEQUE", "OTHER"];

/** Date du jour au format AAAA-MM-JJ, dans le fuseau du navigateur. */
function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ReversementsSectionProps {
  crg: CrgSynthesis;
  /** Gestionnaire : saisie et suppression possibles. Propriétaire : lecture seule. */
  edition?: { ownerId: string; onChange: () => void };
}

/**
 * Reversements du mois au propriétaire : ce qui a été versé, et ce qui reste par devise. Côté
 * gestionnaire, un formulaire enregistre un versement (montant proposé : le reste dû).
 */
export default function ReversementsSection({ crg, edition }: ReversementsSectionProps) {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const devises = Object.keys(crg.totalNetByCurrency).sort();
  const reste = crg.resteAReverserByCurrency ?? {};
  const reverse = crg.totalReverseByCurrency ?? {};
  const reversements = crg.reversements ?? [];

  const [choix, setCurrency] = useState(devises[0] ?? "");
  // Un autre mois peut ne plus avoir la devise choisie : on retombe sur la première disponible.
  const currency = devises.includes(choix) ? choix : (devises[0] ?? "");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(aujourdhui());
  const [method, setMethod] = useState<PayoutMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [notifyOwner, setNotifyOwner] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Montant proposé : ce qui reste à reverser dans la devise choisie (rafraîchi à chaque CRG).
  useEffect(() => {
    const r = crg.resteAReverserByCurrency?.[currency] ?? 0;
    setAmount(r > 0 ? String(r) : "");
  }, [crg, currency]);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    if (!edition) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/crg/${edition.ownerId}/payouts`, {
        month: crg.month,
        year: crg.year,
        currency,
        amount: Number(amount.replace(",", ".")),
        paidAt,
        method,
        reference: reference.trim() || null,
        notifyOwner,
      });
      setReference("");
      edition.onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function supprimer(id: string) {
    if (!edition || !window.confirm(t("components.payouts.confirmDelete"))) return;
    setError(null);
    try {
      await api.delete(`/crg/${edition.ownerId}/payouts/${id}`);
      edition.onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const champ = "w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm";
  const etiquette = "block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1";
  const resteDevise = reste[currency] ?? 0;

  return (
    <section aria-labelledby="reversements-titre" className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800">
        <h3 id="reversements-titre" className="font-bold text-slate-900 dark:text-slate-100 text-sm">
          {t("components.payouts.title")}
        </h3>
      </div>

      <div className="p-4 space-y-4">
        {devises.length > 0 && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {devises.map((d) => {
              const r = reste[d] ?? 0;
              return (
                <li key={d} className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t("components.payouts.summary", { net: formatMoney(crg.totalNetByCurrency[d] ?? 0, d), paid: formatMoney(reverse[d] ?? 0, d) })}
                  </p>
                  <p className={`font-bold ${r < 0 ? "text-red-700 dark:text-red-300" : r === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-slate-900 dark:text-slate-100"}`}>
                    {r < 0
                      ? // Rien n'a été versé : le net est négatif (charges supérieures aux loyers), ce n'est pas un « trop-versé ».
                        (reverse[d] ?? 0) === 0
                        ? t("components.payouts.chargesExceed", { amount: formatMoney(-r, d) })
                        : t("components.payouts.overpaid", { amount: formatMoney(-r, d) })
                      : r === 0
                        ? // Net nul et rien versé : il n'y avait rien à reverser, ce n'est pas « entièrement reversé ».
                          (crg.totalNetByCurrency[d] ?? 0) === 0 && (reverse[d] ?? 0) === 0
                          ? t("components.payouts.nothing")
                          : t("components.payouts.settled")
                        : t("components.payouts.remaining", { amount: formatMoney(r, d) })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {reversements.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("components.payouts.none")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {reversements.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  {new Date(r.paidAt).toLocaleDateString(i18n.language)} · {t(`components.payouts.methods.${r.method}`)}
                  {r.reference && <span className="text-slate-500 dark:text-slate-400"> · {r.reference}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatMoney(r.amount, r.currency)}</span>
                  {edition && (
                    <button type="button" onClick={() => supprimer(r.id)} aria-label={t("components.payouts.delete")} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {edition && devises.length > 0 && (
          <form onSubmit={enregistrer} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="sm:col-span-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{t("components.payouts.formTitle")}</h4>
            {devises.length > 1 && (
              <div>
                <label htmlFor="payout-currency" className={etiquette}>{t("components.payouts.currency")}</label>
                <select id="payout-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={champ}>
                  {devises.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="payout-amount" className={etiquette}>{t("components.payouts.amount")}</label>
              <input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={champ} />
            </div>
            <div>
              <label htmlFor="payout-date" className={etiquette}>{t("components.payouts.date")}</label>
              <input id="payout-date" type="date" max={aujourdhui()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={champ} />
            </div>
            <div>
              <label htmlFor="payout-method" className={etiquette}>{t("components.payouts.method")}</label>
              <select id="payout-method" value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)} className={champ}>
                {MOYENS.map((m) => <option key={m} value={m}>{t(`components.payouts.methods.${m}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="payout-reference" className={etiquette}>{t("components.payouts.reference")}</label>
              <input id="payout-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className={champ} />
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={notifyOwner} onChange={(e) => setNotifyOwner(e.target.checked)} />
              {t("components.payouts.notify")}
            </label>
            {error && <p role="alert" className="sm:col-span-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={saving || resteDevise <= 0 || !amount}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg"
              >
                {saving ? t("components.payouts.saving") : t("components.payouts.save")}
              </button>
            </div>
          </form>
        )}
        {!edition && error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
