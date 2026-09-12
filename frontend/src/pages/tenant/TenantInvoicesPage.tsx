import { CheckCircle2, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import { useCurrency } from "../../context/currency";
import type { Invoice, PaymentMethod } from "../../types";

function monthLabel(locale: string, monthIndex1to12: number) {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, monthIndex1to12 - 1, 1));
}

export default function TenantInvoicesPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bankRef, setBankRef] = useState("");
  const [activeReceiptInvoice, setActiveReceiptInvoice] = useState<Invoice | null>(null);

  const methods: { key: PaymentMethod; label: string; hint: string }[] = [
    {
      key: "PAYDUNYA",
      label: t("tenant.invoices.methods.PAYDUNYA.label"),
      hint: t("tenant.invoices.methods.PAYDUNYA.hint"),
    },
    {
      key: "BANK_TRANSFER",
      label: t("tenant.invoices.methods.BANK_TRANSFER.label"),
      hint: t("tenant.invoices.methods.BANK_TRANSFER.hint"),
    },
  ];

  function load() {
    api
      .get<Invoice[]>("/invoices/mine")
      .then((res) => setInvoices(res.data))
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(load, []);

  async function pay(invoiceId: string, method: PaymentMethod) {
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/pay`, { method, bankReference: bankRef || undefined });

      if (data.payment?.status === "REQUIRES_ACTION" && data.payment?.redirectUrl) {
        window.location.assign(data.payment.redirectUrl);
        return;
      }

      setMessage(data.payment.message);
      setPayingId(null);
      setBankRef("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const unpaidInvoices = invoices.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
  const paidInvoices = invoices.filter((i) => i.status === "PAID");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t("tenant.invoices.title")}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Consultez votre historique et réglez vos loyers en toute sécurité.
          </p>
        </div>
        {unpaidInvoices.length === 0 && invoices.length > 0 && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={14} />
            Tous vos loyers sont à jour
          </div>
        )}
      </div>

      {message && (
        <div className="text-sm bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 rounded-xl px-4 py-3 flex items-center gap-2 shadow-2xs">
          <CheckCircle2 size={16} />
          <span>{message}</span>
        </div>
      )}
      {error && (
        <div className="text-sm bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 rounded-xl px-4 py-3 shadow-2xs">
          {error}
        </div>
      )}

      {/* Quick Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              En attente de règlement
            </p>
            <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm">
              ⏳
            </span>
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900 dark:text-white">
            {unpaidInvoices.length} {unpaidInvoices.length > 1 ? "échéances" : "échéance"}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Quittances disponibles
            </p>
            <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-sm">
              📄
            </span>
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900 dark:text-white">
            {paidInvoices.length} {paidInvoices.length > 1 ? "quittances" : "quittance"}
          </p>
        </div>
      </div>

      <div className="space-y-3.5">
        {invoices.map((inv) => {
          const isPaid = inv.status === "PAID";
          const isLate = inv.status === "LATE";
          return (
            <div
              key={inv.id}
              className={`bg-white dark:bg-slate-900 rounded-2xl border shadow-xs transition-all duration-200 p-5 ${
                isLate
                  ? "border-rose-300 dark:border-rose-500/40 bg-rose-50/10"
                  : isPaid
                  ? "border-slate-200/90 dark:border-slate-800/90"
                  : "border-amber-200 dark:border-amber-500/30"
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-900 dark:text-slate-100 capitalize text-base">
                      {monthLabel(i18n.language, inv.periodMonth)} {inv.periodYear}
                    </p>
                    <span className="text-slate-300 dark:text-slate-700">•</span>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      {inv.contract?.property?.title}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {t("tenant.invoices.dueDate", {
                      date: new Date(inv.dueDate).toLocaleDateString(i18n.language),
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-3.5 flex-wrap">
                  <span className="font-bold text-lg sm:text-xl text-slate-900 dark:text-slate-100">
                    {formatMoney(inv.amount, inv.currency)}
                  </span>
                  <Badge status={inv.status} />
                  {isPaid && (
                    <button
                      onClick={() => setActiveReceiptInvoice(inv)}
                      className="bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <Download size={13} />
                      <span>{t("tenant.invoices.receiptPdf")}</span>
                    </button>
                  )}
                  {!isPaid && inv.status !== "CANCELLED" && (
                    <button
                      onClick={() => setPayingId(payingId === inv.id ? null : inv.id)}
                      className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs shadow-brand-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      {t("tenant.invoices.pay")}
                    </button>
                  )}
                </div>
              </div>

              {payingId === inv.id && (
                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 animate-in fade-in duration-200">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
                    Sélectionnez un mode de règlement sécurisé
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {methods.map((m) => (
                      <div
                        key={m.key}
                        className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-800/40 hover:border-brand-400 dark:hover:border-brand-500 transition-colors"
                      >
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{m.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{m.hint}</p>
                        {m.key === "BANK_TRANSFER" && (
                          <input
                            aria-label={t("tenant.invoices.bankRefPlaceholder")}
                            placeholder={t("tenant.invoices.bankRefPlaceholder")}
                            value={bankRef}
                            onChange={(e) => setBankRef(e.target.value)}
                            className="w-full mt-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs focus:ring-2 focus:ring-brand-500/30 outline-none"
                          />
                        )}
                        <button
                          onClick={() => pay(inv.id, m.key)}
                          className="mt-3.5 w-full text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 transition-colors cursor-pointer shadow-2xs"
                        >
                          {t("tenant.invoices.chooseMethod")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {invoices.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
            <p className="text-slate-400 dark:text-slate-500 text-sm">{t("tenant.invoices.noInvoices")}</p>
          </div>
        )}
      </div>

      {activeReceiptInvoice && (
        <DocumentModal
          title={t("tenant.invoices.receiptTitle", {
            period: `${monthLabel(i18n.language, activeReceiptInvoice.periodMonth)} ${activeReceiptInvoice.periodYear}`,
          })}
          docUrl={`/documents/receipt/${activeReceiptInvoice.id}`}
          onClose={() => setActiveReceiptInvoice(null)}
        />
      )}
    </div>
  );
}
