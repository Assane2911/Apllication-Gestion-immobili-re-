import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import Badge from "../../components/Badge";
import { useCurrency } from "../../context/CurrencyContext";
import type { Invoice, InvoiceStatus } from "../../types";

const monthNames = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

const methodLabels: Record<string, string> = {
  STRIPE: "Carte (Stripe)",
  MOBILE_MONEY: "Mobile Money",
  BANK_TRANSFER: "Virement",
  DEMO: "Démo",
};

export default function InvoicesPage() {
  const { formatMoney } = useCurrency();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<InvoiceStatus | "ALL">("ALL");
  const [sendingMonthly, setSendingMonthly] = useState(false);
  const [sendingSingleId, setSendingSingleId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Invoice[]>("/invoices").then((res) => setInvoices(res.data));
  }

  useEffect(load, []);

  async function markPaid(inv: Invoice) {
    try {
      await api.post(`/invoices/${inv.id}/mark-paid`, { paymentMethod: "BANK_TRANSFER" });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleSendMonthlyReminders() {
    if (!window.confirm("Envoyer immédiatement l'avis d'échéance à tous les locataires pour le mois en cours (date limite de paiement : 5 du mois) ?")) {
      return;
    }
    setSendingMonthly(true);
    setFeedback(null);
    setError(null);

    try {
      const { data } = await api.post<{ message: string; sent: number }>("/invoices/send-monthly-reminders");
      setFeedback(`✅ ${data.message}`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSendingMonthly(false);
    }
  }

  async function handleSendSingleReminder(inv: Invoice) {
    setSendingSingleId(inv.id);
    setFeedback(null);
    setError(null);

    try {
      const { data } = await api.post<{ message: string }>(`/invoices/${inv.id}/send-reminder`);
      setFeedback(`✅ ${data.message}`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSendingSingleId(null);
    }
  }

  const filtered = filter === "ALL" ? invoices : invoices.filter((i) => i.status === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Paiements de loyer</h2>
          <p className="text-sm text-slate-500 mt-1">Suivi des mensualités et alertes d'échéances locataires</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as InvoiceStatus | "ALL")}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white shadow-sm"
          >
            <option value="ALL">Toutes les factures</option>
            <option value="PENDING">En attente</option>
            <option value="LATE">En retard</option>
            <option value="PAID">Réglées</option>
            <option value="CANCELLED">Annulées</option>
          </select>

          <button
            onClick={handleSendMonthlyReminders}
            disabled={sendingMonthly}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <span>📢</span>
            <span>{sendingMonthly ? "Envoi en cours..." : "Envoyer alertes du 1er du mois"}</span>
          </button>
        </div>
      </div>

      {/* Bannière informationnelle sur le rappel automatique du 1er */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-xs text-blue-900">
        <span className="text-base leading-none">⏰</span>
        <div className="space-y-0.5">
          <p className="font-semibold">Automatisation des alertes mensuelles (Le 1er de chaque mois)</p>
          <p className="text-blue-700">
            Un email d'avis d'échéance est <strong>automatiquement envoyé à chaque locataire le 1er du mois à 8h00</strong> pour lui rappeler de régler son loyer <strong>au plus tard le 5 du mois</strong>. Vous pouvez également déclencher l'envoi manuellement ci-dessus.
          </p>
        </div>
      </div>

      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-medium">
          {feedback}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 font-medium">Période</th>
              <th className="px-4 py-3 font-medium">Locataire</th>
              <th className="px-4 py-3 font-medium">Bien</th>
              <th className="px-4 py-3 font-medium">Montant</th>
              <th className="px-4 py-3 font-medium">Échéance</th>
              <th className="px-4 py-3 font-medium">Moyen</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3.5 text-slate-900 font-medium">
                  {monthNames[inv.periodMonth - 1]} {inv.periodYear}
                </td>
                <td className="px-4 py-3.5 text-slate-700">
                  <p className="font-medium">{inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}</p>
                  <p className="text-[11px] text-slate-400">{inv.contract?.tenant?.email}</p>
                </td>
                <td className="px-4 py-3.5 text-slate-600">{inv.contract?.property?.title}</td>
                <td className="px-4 py-3.5 font-bold text-slate-900">{formatMoney(inv.amount, inv.currency)}</td>
                <td className="px-4 py-3.5 text-slate-600">
                  <span className="text-xs">{new Date(inv.dueDate).toLocaleDateString("fr-FR")}</span>
                  <span className="block text-[10px] text-amber-700 font-medium">(Limite au 5)</span>
                </td>
                <td className="px-4 py-3.5 text-slate-600 text-xs">
                  {inv.paymentMethod ? methodLabels[inv.paymentMethod] : "—"}
                </td>
                <td className="px-4 py-3.5">
                  <Badge status={inv.status} />
                </td>
                <td className="px-4 py-3.5 text-right space-x-2 whitespace-nowrap">
                  {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                    <>
                      <button
                        onClick={() => handleSendSingleReminder(inv)}
                        disabled={sendingSingleId === inv.id}
                        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
                        title="Envoyer un rappel de paiement par email"
                      >
                        {sendingSingleId === inv.id ? "Envoi..." : "📧 Relancer"}
                      </button>
                      <button
                        onClick={() => markPaid(inv)}
                        className="text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-2.5 py-1 rounded-lg font-medium transition-colors"
                      >
                        Marquer réglée
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Aucune facture pour ce filtre
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
