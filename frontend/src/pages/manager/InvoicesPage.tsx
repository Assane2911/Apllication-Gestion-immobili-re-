import { CheckCircle2, Clock, Download, Megaphone, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, apiErrorMessage, liste } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import Pagination from "../../components/Pagination";
import { useCurrency } from "../../context/currency";
import type { Invoice, InvoiceStatus, PaginatedResponse } from "../../types";
import Bulle from "../../components/Bulle";

function monthLabel(locale: string, monthIndex1to12: number) {
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2000, monthIndex1to12 - 1, 1));
}

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<InvoiceStatus | "ALL">("ALL");
  const [sendingMonthly, setSendingMonthly] = useState(false);
  const [sendingSingleId, setSendingSingleId] = useState<string | null>(null);
  const [marquageEnCours, setMarquageEnCours] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeReceiptInvoice, setActiveReceiptInvoice] = useState<Invoice | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const methodLabels: Record<string, string> = {
    STRIPE: t("common.paymentMethods.STRIPE"),
    PAYDUNYA: t("common.paymentMethods.PAYDUNYA"),
    BANK_TRANSFER: t("common.paymentMethods.BANK_TRANSFER"),
    DEMO: t("common.paymentMethods.DEMO"),
  };

  function load() {
    api
      .get<PaginatedResponse<Invoice>>("/invoices", {
        params: { page, pageSize: PAGE_SIZE, ...(filter !== "ALL" ? { status: filter } : {}) },
      })
      .then((res) => {
        setInvoices(liste<Invoice>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(load, [page, filter]);

  function handleFilterChange(value: InvoiceStatus | "ALL") {
    setFilter(value);
    setPage(1);
  }

  /**
   * Marquer une facture réglée à la main.
   *
   * Le geste est SANS RETOUR, et il l'est par décision : `PAID` est un état
   * terminal, `cancelInvoice` refuse explicitement une facture réglée, et
   * aucun chemin du serveur ne ramène jamais une facture à `PENDING`. Il
   * déclenche en outre l'envoi immédiat de la quittance au locataire — un
   * document qui, en droit, atteste du paiement. Une fois parti, rien ne le
   * rappelle.
   *
   * Le bouton n'avait pourtant ni confirmation ni verrou, alors que l'envoi
   * groupé de rappels, juste en dessous, en demande une. Il est de surcroît
   * voisin immédiat du bouton « Relancer » : le clic de travers est réaliste,
   * et son prix est un loyer jamais perçu qui compte dans les encaissements,
   * fausse le bilan fiscal et le compte-rendu du propriétaire, et sort le
   * locataire des relances.
   */
  async function markPaid(inv: Invoice) {
    if (marquageEnCours) return;
    const locataire = inv.contract?.tenant;
    const nom = locataire ? `${locataire.firstName} ${locataire.lastName}` : "";
    if (!window.confirm(t("manager.invoices.confirmMarkPaid", { name: nom, amount: formatMoney(inv.amount, inv.currency) }))) {
      return;
    }

    setMarquageEnCours(inv.id);
    try {
      await api.post(`/invoices/${inv.id}/mark-paid`, { paymentMethod: "BANK_TRANSFER" });
      setError(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setMarquageEnCours(null);
    }
  }

  async function handleSendMonthlyReminders() {
    if (!window.confirm(t("manager.invoices.confirmSendMonthly"))) {
      return;
    }
    setSendingMonthly(true);
    setFeedback(null);
    setError(null);

    try {
      const { data } = await api.post<{ message: string; sent: number }>("/invoices/send-monthly-reminders");
      setFeedback(data.message);
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
      setFeedback(data.message);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSendingSingleId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("manager.invoices.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.invoices.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            aria-label={t("manager.invoices.filterByStatus")}
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as InvoiceStatus | "ALL")}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 dark:text-slate-100 shadow-sm"
          >
            <option value="ALL">{t("manager.invoices.filterAll")}</option>
            <option value="PENDING">{t("common.status.PENDING")}</option>
            <option value="LATE">{t("common.status.LATE")}</option>
            <option value="PAID">{t("common.status.PAID")}</option>
            <option value="CANCELLED">{t("common.status.CANCELLED")}</option>
          </select>

          <Bulle texte={t("manager.tips.invoiceSendMonthly")}>
          <button
            onClick={handleSendMonthlyReminders}
            disabled={sendingMonthly}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Megaphone size={14} className="shrink-0" aria-hidden="true" />
            <span>{sendingMonthly ? t("manager.invoices.sendingMonthly") : t("manager.invoices.sendMonthlyAlerts")}</span>
          </button>
          </Bulle>
        </div>
      </div>

      {/* Bannière informationnelle sur le rappel automatique du 1er */}
      <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4 flex items-start gap-3 text-xs text-blue-900 dark:text-blue-200">
        <Clock size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-semibold">{t("manager.invoices.infoBannerTitle")}</p>
          <p className="text-blue-700 dark:text-blue-300">
            <Trans i18nKey="manager.invoices.infoBannerBody" components={{ 1: <strong /> }} />
          </p>
        </div>
      </div>

      {feedback && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" />
          {feedback}
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs">
          {error}
        </div>
      )}

      {/* Vue tableau (écrans sm et plus) */}
      <div className="hidden sm:block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-left border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.period")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.tenant")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.property")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.amount")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.dueDate")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.method")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.invoices.table.status")}</th>
              <th className="px-4 py-3 font-medium text-right">{t("manager.invoices.table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3.5 text-slate-900 dark:text-slate-100 font-medium">
                  {monthLabel(i18n.language, inv.periodMonth)} {inv.periodYear}
                </td>
                <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                  <p className="font-medium">{inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{inv.contract?.tenant?.email}</p>
                </td>
                <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">{inv.contract?.property?.title}</td>
                <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-slate-100">{formatMoney(inv.amount, inv.currency)}</td>
                <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                  <span className="text-xs">{new Date(inv.dueDate).toLocaleDateString(i18n.language)}</span>
                  <span className="block text-[10px] text-amber-700 dark:text-amber-400 font-medium">{t("manager.invoices.dueDateLimit")}</span>
                </td>
                <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400 text-xs">
                  {inv.paymentMethod ? methodLabels[inv.paymentMethod] : "—"}
                </td>
                <td className="px-4 py-3.5">
                  <Badge status={inv.status} />
                </td>
                <td className="px-4 py-3.5 text-right space-x-2 whitespace-nowrap">
                  {inv.status === "PAID" && (
                    <Bulle texte={t("manager.tips.invoiceReceipt")}><button
                      onClick={() => setActiveReceiptInvoice(inv)}
                      className="text-xs bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-semibold px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-500/30 transition-colors inline-flex items-center gap-1"
                    >
                      <Download size={12} aria-hidden="true" /> {t("manager.invoices.receiptPdf")}
                    </button></Bulle>
                  )}
                  {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                    <>
                      <Bulle texte={t("manager.tips.invoiceRemind")}><button
                        onClick={() => handleSendSingleReminder(inv)}
                        disabled={sendingSingleId === inv.id}
                        className="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-lg font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {sendingSingleId === inv.id ? (
                          t("manager.invoices.sendingReminder")
                        ) : (
                          <>
                            <Send size={12} aria-hidden="true" /> {t("manager.invoices.remind")}
                          </>
                        )}
                      </button></Bulle>
                      <Bulle texte={t("manager.tips.invoiceMarkPaid")}><button
                        onClick={() => markPaid(inv)}
                        disabled={marquageEnCours === inv.id}
                        className="text-xs bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 disabled:opacity-60 text-brand-700 dark:text-brand-400 px-2.5 py-1 rounded-lg font-medium transition-colors"
                      >
                        {marquageEnCours === inv.id ? t("manager.invoices.markingPaid") : t("manager.invoices.markPaid")}
                      </button></Bulle>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  {t("manager.invoices.noInvoicesForFilter")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Vue cartes empilées (mobile, < sm) */}
      <div className="sm:hidden space-y-3">
        {invoices.length === 0 ? (
          <p className="text-center text-slate-400 dark:text-slate-500 text-sm py-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            {t("manager.invoices.noInvoicesForFilter")}
          </p>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {monthLabel(i18n.language, inv.periodMonth)} {inv.periodYear}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{inv.contract?.property?.title}</p>
                </div>
                <Badge status={inv.status} />
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  {inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}
                </p>
                <p>{inv.contract?.tenant?.email}</p>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 dark:text-slate-100">{formatMoney(inv.amount, inv.currency)}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {t("manager.invoices.dueDatePrefix", { date: new Date(inv.dueDate).toLocaleDateString(i18n.language) })}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 gap-2">
                {inv.status === "PAID" && (
                  <Bulle texte={t("manager.tips.invoiceReceipt")}><button
                    onClick={() => setActiveReceiptInvoice(inv)}
                    className="text-xs bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-500/30 inline-flex items-center gap-1"
                  >
                    <Download size={12} aria-hidden="true" /> {t("manager.invoices.receiptPdf")}
                  </button></Bulle>
                )}
                {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                  <>
                    <Bulle texte={t("manager.tips.invoiceRemind")}><button
                      onClick={() => handleSendSingleReminder(inv)}
                      disabled={sendingSingleId === inv.id}
                      className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-lg font-medium disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {sendingSingleId === inv.id ? (
                        t("manager.invoices.sendingReminder")
                      ) : (
                        <>
                          <Send size={12} aria-hidden="true" /> {t("manager.invoices.remind")}
                        </>
                      )}
                    </button></Bulle>
                    <Bulle texte={t("manager.tips.invoiceMarkPaid")}><button
                      onClick={() => markPaid(inv)}
                      disabled={marquageEnCours === inv.id}
                      className="text-xs bg-brand-50 dark:bg-brand-500/10 disabled:opacity-60 text-brand-700 dark:text-brand-400 px-2.5 py-1 rounded-lg font-medium"
                    >
                      {marquageEnCours === inv.id ? t("manager.invoices.markingPaid") : t("manager.invoices.markPaid")}
                    </button></Bulle>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {activeReceiptInvoice && (
        <DocumentModal
          title={t("manager.invoices.receiptTitle", {
            period: `${monthLabel(i18n.language, activeReceiptInvoice.periodMonth)} ${activeReceiptInvoice.periodYear}`,
          })}
          docUrl={`/documents/receipt/${activeReceiptInvoice.id}`}
          onClose={() => setActiveReceiptInvoice(null)}
        />
      )}
    </div>
  );
}
