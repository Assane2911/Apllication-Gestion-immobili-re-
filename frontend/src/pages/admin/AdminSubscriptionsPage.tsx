import { Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, liste } from "../../api/client";
import { useCurrency } from "../../context/currency";
import EmptyState from "../../components/EmptyState";

interface PendingBankTransfer {
  id: string;
  userId: string;
  managerEmail: string;
  plan: string;
  amount: number;
  currency: string;
  billingCycle: string;
  paymentRef: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export default function AdminSubscriptionsPage() {
  const { t, i18n } = useTranslation();
  // Chaque ligne porte sa propre devise : le montant d'un abonnement réglé en
  // FCFA ne doit pas s'afficher en euros au moment où l'admin valide le virement.
  const { formatMoney } = useCurrency();
  const [rows, setRows] = useState<PendingBankTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  function load() {
    setLoadError(null);
    api
      .get<PendingBankTransfer[]>("/admin/subscriptions/pending-bank-transfers")
      .then((res) => setRows(liste<PendingBankTransfer>(res.data)))
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function confirm(row: PendingBankTransfer) {
    if (!window.confirm(t("admin.subscriptions.confirmPrompt", { email: row.managerEmail, amount: formatMoney(row.amount, row.currency) }))) {
      return;
    }
    setConfirmingId(row.id);
    try {
      await api.post(`/admin/subscriptions/${row.id}/confirm-bank-transfer`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setConfirmingId(null);
    }
  }

  // Pour une demande de test ou un virement annoncé mais jamais reçu : ne
  // donne jamais accès (contrairement à confirm), retire simplement la ligne
  // de la liste des virements en attente. Sans cette action, la seule
  // alternative était de laisser la ligne PENDING indéfiniment ou de
  // confirmer à tort un paiement fictif.
  async function reject(row: PendingBankTransfer) {
    if (!window.confirm(t("admin.subscriptions.rejectPrompt", { email: row.managerEmail, amount: formatMoney(row.amount, row.currency) }))) {
      return;
    }
    setRejectingId(row.id);
    try {
      await api.post(`/admin/subscriptions/${row.id}/reject-bank-transfer`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("admin.subscriptions.title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("admin.subscriptions.subtitle")}</p>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={load} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {!loading && !loadError && rows.length === 0 && (
        <EmptyState
          icon={Landmark}
          title={t("admin.subscriptions.emptyTitle")}
          description={t("admin.subscriptions.emptyDescription")}
        />
      )}

      {rows.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[10px]">
                  <th className="py-2.5">{t("admin.subscriptions.table.manager")}</th>
                  <th className="py-2.5">{t("admin.subscriptions.table.plan")}</th>
                  <th className="py-2.5">{t("admin.subscriptions.table.cycle")}</th>
                  <th className="py-2.5">{t("admin.subscriptions.table.amount")}</th>
                  <th className="py-2.5">{t("admin.subscriptions.table.reference")}</th>
                  <th className="py-2.5">{t("admin.subscriptions.table.since")}</th>
                  <th className="py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.id} className="text-slate-700 dark:text-slate-300">
                    <td className="py-3 font-semibold">{row.managerEmail}</td>
                    <td className="py-3">{row.plan}</td>
                    <td className="py-3">
                      {row.billingCycle === "ANNUAL" ? t("admin.subscriptions.annual") : t("admin.subscriptions.monthly")}
                    </td>
                    <td className="py-3 font-bold">{formatMoney(row.amount, row.currency)}</td>
                    <td className="py-3 text-slate-500 dark:text-slate-400">{row.paymentRef || "—"}</td>
                    <td className="py-3">{new Date(row.createdAt).toLocaleDateString(i18n.language)}</td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => reject(row)}
                        disabled={confirmingId === row.id || rejectingId === row.id}
                        className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap mr-2"
                      >
                        {rejectingId === row.id
                          ? t("admin.subscriptions.rejecting")
                          : t("admin.subscriptions.rejectButton")}
                      </button>
                      <button
                        onClick={() => confirm(row)}
                        disabled={confirmingId === row.id || rejectingId === row.id}
                        className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {confirmingId === row.id
                          ? t("admin.subscriptions.confirming")
                          : t("admin.subscriptions.confirmButton")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
