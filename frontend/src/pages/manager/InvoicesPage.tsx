import { CheckCircle2, Clock, Download, Megaphone, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import FormalNoticeModal from "../../components/FormalNoticeModal";
import MarkPaidModal from "../../components/MarkPaidModal";
import Pagination from "../../components/Pagination";
import { useCurrency } from "../../context/currency";
import type { FormalNoticeDue, Invoice, InvoiceStatus, PaginatedResponse } from "../../types";
import Bulle from "../../components/Bulle";
import { formaterJour } from "../../utils/jourCivil";
import { NomDuBien } from "../../components/PlanLogement";

function monthLabel(locale: string, monthIndex1to12: number) {
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2000, monthIndex1to12 - 1, 1));
}

const PAGE_SIZE = 20;

/** Facture en cours de règlement : un acompte a été encaissé, il reste quelque chose à payer. */
function aUnAcompte(inv: Invoice): boolean {
  return inv.status !== "PAID" && inv.status !== "CANCELLED" && (inv.montantRegle ?? 0) > 0 && (inv.resteDu ?? 0) > 0;
}

export default function InvoicesPage() {
  const { t, i18n } = useTranslation();

  /** « Relance 2/3 le 20/10/2026 » sous le statut d'une facture impayée déjà relancée. */
  function niveauRelance(inv: Invoice) {
    if (!inv.overdueReminderLevel || inv.status === "PAID" || inv.status === "CANCELLED") return null;
    return (
      <span className="block mt-1 text-[11px] text-red-700">
        {t("manager.invoices.overdueLevel", {
          level: inv.overdueReminderLevel,
          date: inv.overdueReminderSentAt ? new Date(inv.overdueReminderSentAt).toLocaleDateString(i18n.language) : "",
        })}
      </span>
    );
  }
  const { formatMoney } = useCurrency();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<InvoiceStatus | "ALL">("ALL");
  const [sendingMonthly, setSendingMonthly] = useState(false);
  const [sendingSingleId, setSendingSingleId] = useState<string | null>(null);
  const [factureAMarquer, setFactureAMarquer] = useState<Invoice | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeReceiptInvoice, setActiveReceiptInvoice] = useState<Invoice | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [aMettreEnDemeure, setAMettreEnDemeure] = useState<FormalNoticeDue[]>([]);
  const [bailEnDemeure, setBailEnDemeure] = useState<FormalNoticeDue | null>(null);
  const [courrierOuvert, setCourrierOuvert] = useState<string | null>(null);

  const methodLabels: Record<string, string> = {
    STRIPE: t("common.paymentMethods.STRIPE"),
    PAYDUNYA: t("common.paymentMethods.PAYDUNYA"),
    BANK_TRANSFER: t("common.paymentMethods.BANK_TRANSFER"),
    DEMO: t("common.paymentMethods.DEMO"),
    CASH: t("common.paymentMethods.CASH"),
    CHEQUE: t("common.paymentMethods.CHEQUE"),
    MOBILE_MONEY: t("common.paymentMethods.MOBILE_MONEY"),
  };

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<Invoice>>("/invoices", {
        params: { page, pageSize: PAGE_SIZE, ...(filter !== "ALL" ? { status: filter } : {}) },
        signal,
      })
      .then((res) => {
        setInvoices(liste<Invoice>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        chargerMisesEnDemeure(signal);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setError(apiErrorMessage(err));
      });
  }

  /** Baux à mettre en demeure : chargé APRÈS les factures, et jamais bloquant pour la page. */
  function chargerMisesEnDemeure(signal?: AbortSignal) {
    Promise.resolve()
      .then(() => api.get<FormalNoticeDue[]>("/contracts/formal-notices-due", { signal }))
      .then((res) => setAMettreEnDemeure(liste<FormalNoticeDue>(res.data)))
      .catch((err) => {
        if (!isRequestCancelled(err)) setAMettreEnDemeure([]);
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [page, filter]);

  function handleFilterChange(value: InvoiceStatus | "ALL") {
    setFilter(value);
    setPage(1);
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

  // Une facture sans aucun paiement, en attente ou en retard, peut être annulée (le serveur refuse le reste : voir cancelInvoice).
  const annulable = (inv: Invoice) => (inv.status === "PENDING" || inv.status === "LATE") && !(inv.amountPaid && inv.amountPaid > 0);

  async function handleCancelInvoice(inv: Invoice) {
    if (!confirm(t("manager.invoices.confirmCancelInvoice"))) return;
    setCancellingId(inv.id);
    setFeedback(null);
    setError(null);
    try {
      await api.post(`/invoices/${inv.id}/cancel`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setCancellingId(null);
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
          <h2 className="text-2xl font-bold text-slate-900">{t("manager.invoices.title")}</h2>
          <p className="text-sm text-slate-600 mt-1">{t("manager.invoices.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            aria-label={t("manager.invoices.filterByStatus")}
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as InvoiceStatus | "ALL")}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white shadow-sm"
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
      <div className="bg-brand-50 border border-slate-300 border-l-[3px] border-l-ink-900 p-4 flex items-start gap-3 text-xs text-slate-800">
        <Clock size={16} className="shrink-0 mt-0.5 text-ink-900" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-semibold">{t("manager.invoices.infoBannerTitle")}</p>
          <p className="text-slate-700">
            <Trans i18nKey="manager.invoices.infoBannerBody" components={{ 1: <strong /> }} />
          </p>
        </div>
      </div>

      {feedback && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" />
          {feedback}
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs">
          {error}
        </div>
      )}

      {aMettreEnDemeure.length > 0 && (
        <section aria-labelledby="mises-en-demeure" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <h3 id="mises-en-demeure" className="text-sm font-semibold text-red-900">
            {t("manager.invoices.formalNotices.title", { count: aMettreEnDemeure.length })}
          </h3>
          <p className="text-xs text-red-800 mt-0.5">{t("manager.invoices.formalNotices.hint")}</p>
          <ul className="mt-2 divide-y divide-red-200/70">
            {aMettreEnDemeure.map((b) => (
              <li key={b.contractId} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-800">
                  <span className="font-medium">{b.propertyTitle}</span> — {b.tenantName}
                  <span className="block text-xs text-slate-600">
                    {t("manager.invoices.formalNotices.line", { count: b.unpaidCount, total: formatMoney(b.totalDue, b.currency), days: b.daysLate })}
                    {b.alreadyClaimedCount > 0 && <> · {t("manager.invoices.formalNotices.alreadyClaimed", { count: b.alreadyClaimedCount })}</>}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setBailEnDemeure(b)}
                  className="text-xs bg-red-700 hover:bg-red-800 text-white font-semibold px-3 py-1.5 rounded-lg"
                >
                  {t("manager.invoices.formalNotices.action")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Vue tableau (écrans sm et plus) */}
      <div className="hidden sm:block bg-white rounded-2xl border border-contour-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-200/70 text-slate-700 text-left border-b border-contour-200">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.period")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.tenant")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.property")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.amount")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.dueDate")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.method")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.status")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("manager.invoices.table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-contour-100">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/50">
                <td className={`px-4 py-3.5 text-slate-900 font-medium whitespace-nowrap ${inv.status === "LATE" ? "shadow-[inset_3px_0_0_var(--color-rose-600)]" : ""}`}>
                  {monthLabel(i18n.language, inv.periodMonth)} {inv.periodYear}
                </td>
                <td className="px-4 py-3.5 text-slate-700">
                  <p className="font-medium">{inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}</p>
                  <p className="text-[11px] text-slate-600">{inv.contract?.tenant?.email}</p>
                </td>
                <td className="px-4 py-3.5 text-slate-600"><NomDuBien titre={inv.contract?.property?.title} id={inv.contract?.property?.id} /></td>
                <td className="px-4 py-3.5 font-bold tabular-nums text-slate-900">
                  {formatMoney(inv.amount, inv.currency)}
                  {aUnAcompte(inv) && (
                    <span className="block text-[10px] font-medium text-amber-700">
                      {t("manager.invoices.partiallyPaid", {
                        paid: formatMoney(inv.montantRegle ?? 0, inv.currency),
                        remaining: formatMoney(inv.resteDu ?? 0, inv.currency),
                      })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-slate-600">
                  <span className="text-xs">{formaterJour(inv.dueDate, i18n.language)}</span>
                </td>
                <td className="px-4 py-3.5 text-slate-600 text-xs">
                  {inv.paymentMethod ? methodLabels[inv.paymentMethod] : "—"}
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <Badge status={inv.status} />
                  {niveauRelance(inv)}
                </td>
                {/* Actions à la ligne : sur une seule, elles élargissaient le tableau au-delà de l'écran. */}
                <td className="px-4 py-3.5 text-right max-w-76">
                  <div className="flex flex-wrap justify-end gap-2">
                  {inv.status === "PAID" && (
                    <Bulle texte={t("manager.tips.invoiceReceipt")}><button
                      onClick={() => setActiveReceiptInvoice(inv)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-white text-emerald-800 border-emerald-600 hover:bg-emerald-50"
                    >
                      <Download size={12} aria-hidden="true" /> {t("manager.invoices.receiptPdf")}
                    </button></Bulle>
                  )}
                  {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                    <>
                      <Bulle texte={t("manager.tips.invoiceRemind")}><button
                        onClick={() => handleSendSingleReminder(inv)}
                        disabled={sendingSingleId === inv.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-white text-slate-800 border-slate-400 hover:border-ink-900 hover:bg-slate-100"
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
                        onClick={() => setFactureAMarquer(inv)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-ink-900 text-white border-ink-900 hover:bg-brand-600"
                      >
                        {t("manager.invoices.markPaid")}
                      </button></Bulle>
                      {annulable(inv) && (
                        <Bulle texte={t("manager.tips.invoiceCancel")}><button
                          onClick={() => handleCancelInvoice(inv)}
                          disabled={cancellingId === inv.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-white text-rose-700 border-rose-300 hover:bg-rose-50"
                        >
                          {cancellingId === inv.id ? t("manager.invoices.cancelling") : t("manager.invoices.cancelInvoice")}
                        </button></Bulle>
                      )}
                    </>
                  )}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-600">
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
          <p className="text-center text-slate-600 text-sm py-8 bg-white rounded-2xl border border-contour-200">
            {t("manager.invoices.noInvoicesForFilter")}
          </p>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id} className={`bg-white border border-contour-200 p-4 space-y-2.5 ${inv.status === "LATE" ? "border-l-[3px] border-l-rose-600" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    {monthLabel(i18n.language, inv.periodMonth)} {inv.periodYear}
                  </p>
                  <p className="text-xs text-slate-600"><NomDuBien titre={inv.contract?.property?.title} id={inv.contract?.property?.id} /></p>
                </div>
                <div className="text-right">
                  <Badge status={inv.status} />
                  {niveauRelance(inv)}
                </div>
              </div>
              <div className="text-xs text-slate-600">
                <p className="font-medium text-slate-700">
                  {inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}
                </p>
                <p>{inv.contract?.tenant?.email}</p>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">
                  {formatMoney(inv.amount, inv.currency)}
                  {aUnAcompte(inv) && (
                    <span className="block text-[10px] font-medium text-amber-700">
                      {t("manager.invoices.partiallyPaid", {
                        paid: formatMoney(inv.montantRegle ?? 0, inv.currency),
                        remaining: formatMoney(inv.resteDu ?? 0, inv.currency),
                      })}
                    </span>
                  )}
                </span>
                <span className="text-slate-600">
                  {t("manager.invoices.dueDatePrefix", { date: formaterJour(inv.dueDate, i18n.language) })}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-contour-100 gap-2">
                {inv.status === "PAID" && (
                  <Bulle texte={t("manager.tips.invoiceReceipt")}><button
                    onClick={() => setActiveReceiptInvoice(inv)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-white text-emerald-800 border-emerald-600 hover:bg-emerald-50"
                  >
                    <Download size={12} aria-hidden="true" /> {t("manager.invoices.receiptPdf")}
                  </button></Bulle>
                )}
                {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                  <>
                    <Bulle texte={t("manager.tips.invoiceRemind")}><button
                      onClick={() => handleSendSingleReminder(inv)}
                      disabled={sendingSingleId === inv.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-white text-slate-800 border-slate-400 hover:border-ink-900 hover:bg-slate-100"
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
                      onClick={() => setFactureAMarquer(inv)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-ink-900 text-white border-ink-900 hover:bg-brand-600"
                    >
                      {t("manager.invoices.markPaid")}
                    </button></Bulle>
                    {annulable(inv) && (
                      <Bulle texte={t("manager.tips.invoiceCancel")}><button
                        onClick={() => handleCancelInvoice(inv)}
                        disabled={cancellingId === inv.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer bg-white text-rose-700 border-rose-300 hover:bg-rose-50"
                      >
                        {cancellingId === inv.id ? t("manager.invoices.cancelling") : t("manager.invoices.cancelInvoice")}
                      </button></Bulle>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {factureAMarquer && (
        <MarkPaidModal
          invoiceId={factureAMarquer.id}
          tenantName={
            factureAMarquer.contract?.tenant
              ? `${factureAMarquer.contract.tenant.firstName} ${factureAMarquer.contract.tenant.lastName}`
              : ""
          }
          amountLabel={formatMoney(factureAMarquer.amount, factureAMarquer.currency)}
          remaining={factureAMarquer.resteDu ?? factureAMarquer.amount}
          currency={factureAMarquer.currency}
          onSuccess={() => {
            setFactureAMarquer(null);
            setError(null);
            load();
          }}
          onClose={() => setFactureAMarquer(null)}
        />
      )}

      {bailEnDemeure && (
        <FormalNoticeModal
          bail={bailEnDemeure}
          onIssued={() => chargerMisesEnDemeure()}
          onOpenDocument={(id) => {
            setBailEnDemeure(null);
            setCourrierOuvert(id);
          }}
          onClose={() => setBailEnDemeure(null)}
        />
      )}

      {courrierOuvert && (
        <DocumentModal title={t("components.formalNoticeModal.docTitle")} docUrl={`/documents/formal-notice/${courrierOuvert}`} onClose={() => setCourrierOuvert(null)} />
      )}

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
