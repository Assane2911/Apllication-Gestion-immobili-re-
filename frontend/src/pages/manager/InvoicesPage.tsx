import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import Badge from "../../components/Badge";
import type { Invoice, InvoiceStatus } from "../../types";

const monthNames = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

const methodLabels: Record<string, string> = {
  STRIPE: "Carte (Stripe)",
  MOBILE_MONEY: "Mobile Money",
  BANK_TRANSFER: "Virement",
  DEMO: "Démo",
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<InvoiceStatus | "ALL">("ALL");
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

  const filtered = filter === "ALL" ? invoices : invoices.filter((i) => i.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Paiements de loyer</h2>
          <p className="text-sm text-slate-500 mt-1">Suivi des mensualités versées par les locataires</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as InvoiceStatus | "ALL")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="ALL">Toutes les factures</option>
          <option value="PENDING">En attente</option>
          <option value="LATE">En retard</option>
          <option value="PAID">Réglées</option>
          <option value="CANCELLED">Annulées</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Période</th>
              <th className="px-4 py-3 font-medium">Locataire</th>
              <th className="px-4 py-3 font-medium">Bien</th>
              <th className="px-4 py-3 font-medium">Montant</th>
              <th className="px-4 py-3 font-medium">Échéance</th>
              <th className="px-4 py-3 font-medium">Moyen</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3 text-slate-900">{monthNames[inv.periodMonth - 1]} {inv.periodYear}</td>
                <td className="px-4 py-3 text-slate-600">{inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}</td>
                <td className="px-4 py-3 text-slate-600">{inv.contract?.property?.title}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{inv.amount} €</td>
                <td className="px-4 py-3 text-slate-600">{new Date(inv.dueDate).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-600">{inv.paymentMethod ? methodLabels[inv.paymentMethod] : "—"}</td>
                <td className="px-4 py-3"><Badge status={inv.status} /></td>
                <td className="px-4 py-3 text-right">
                  {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                    <button onClick={() => markPaid(inv)} className="text-brand-600 hover:underline text-xs">
                      Marquer réglée
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Aucune facture pour ce filtre</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
