import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import Badge from "../../components/Badge";
import { useCurrency } from "../../context/CurrencyContext";
import type { Invoice, PaymentMethod } from "../../types";

const monthNames = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

const methods: { key: PaymentMethod; label: string; hint: string }[] = [
  { key: "STRIPE", label: "💳 Carte bancaire", hint: "Paiement sécurisé par Stripe" },
  { key: "MOBILE_MONEY", label: "📱 Mobile Money", hint: "Orange Money / MTN Money" },
  { key: "BANK_TRANSFER", label: "🏦 Virement bancaire", hint: "Déclarez votre virement, validation par le gestionnaire" },
  { key: "DEMO", label: "🧪 Mode démo", hint: "Paiement simulé, confirmation immédiate" },
];

export default function TenantInvoicesPage() {
  const { formatMoney } = useCurrency();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bankRef, setBankRef] = useState("");

  function load() {
    api.get<Invoice[]>("/invoices/mine").then((res) => setInvoices(res.data));
  }

  useEffect(load, []);

  async function pay(invoiceId: string, method: PaymentMethod) {
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/pay`, { method, bankReference: bankRef || undefined });
      setMessage(data.payment.message);
      setPayingId(null);
      setBankRef("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">Mes loyers</h2>
      {message && <p className="text-sm bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2">{message}</p>}
      {error && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</p>}

      <div className="space-y-3">
        {invoices.map((inv) => (
          <div key={inv.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-medium text-slate-900">{monthNames[inv.periodMonth - 1]} {inv.periodYear} — {inv.contract?.property?.title}</p>
                <p className="text-xs text-slate-500">Échéance : {new Date(inv.dueDate).toLocaleDateString("fr-FR")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-slate-900">{formatMoney(inv.amount, inv.currency)}</span>
                <Badge status={inv.status} />
                {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                  <button
                    onClick={() => setPayingId(payingId === inv.id ? null : inv.id)}
                    className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                  >
                    Payer
                  </button>
                )}
              </div>
            </div>

            {payingId === inv.id && (
              <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {methods.map((m) => (
                  <div key={m.key} className="border border-slate-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-slate-800">{m.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.hint}</p>
                    {m.key === "BANK_TRANSFER" && (
                      <input
                        placeholder="Référence du virement"
                        value={bankRef}
                        onChange={(e) => setBankRef(e.target.value)}
                        className="w-full mt-2 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                    )}
                    <button
                      onClick={() => pay(inv.id, m.key)}
                      className="mt-2 w-full text-xs bg-slate-900 hover:bg-slate-800 text-white rounded-lg py-1.5"
                    >
                      Choisir ce moyen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {invoices.length === 0 && <p className="text-slate-400 text-sm text-center py-8">Aucune facture pour le moment</p>}
      </div>
    </div>
  );
}
