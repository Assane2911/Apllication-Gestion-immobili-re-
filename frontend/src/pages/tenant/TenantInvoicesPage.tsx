import { CheckCircle2, Clock, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import Badge from "../../components/Badge";
import BankDetails from "../../components/BankDetails";
import DocumentModal from "../../components/DocumentModal";
import { useCurrency } from "../../context/currency";
import { useMoyensDePaiement } from "../../hooks/useMoyensDePaiement";
import { useRetourDePaiement } from "../../hooks/useRetourDePaiement";
import type { AgencyBankInfo, Invoice, PaymentMethod } from "../../types";
import Bulle from "../../components/Bulle";
import { formaterJour } from "../../utils/jourCivil";
import { NomDuBien } from "../../components/PlanLogement";

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
  const [bankInfo, setBankInfo] = useState<AgencyBankInfo | null>(null);

  // La disponibilité dépend de la devise de la facture réglée : PayDunya
  // n'accepte que la devise de son compte (voir payment.service.ts). On
  // interroge donc le serveur pour la facture en cours de règlement, pas une
  // fois pour toutes.
  const factureEnCours = invoices.find((inv) => inv.id === payingId) ?? null;
  const moyensDisponibles = useMoyensDePaiement(factureEnCours?.currency ?? null, "loyer");
  const methods = (moyensDisponibles ?? []).map((key) => ({
    key: key as PaymentMethod,
    label: t(`tenant.invoices.methods.${key}.label`),
    hint: t(`tenant.invoices.methods.${key}.hint`),
  }));

  function load() {
    api
      .get<Invoice[]>("/invoices/mine")
      // Même précaution que sur l'écran d'abonnement : un corps inattendu
      // plantait le rendu sur `invoices.find`.
      .then((res) => setInvoices(Array.isArray(res.data) ? res.data : []))
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(load, []);

  // Chargées une fois pour toutes : ce sont les coordonnées de SON agence, pas
  // d'une facture en particulier, donc pas besoin de les redemander à chaque
  // ouverture du panneau de règlement.
  useEffect(() => {
    api
      .get<AgencyBankInfo>("/agency/mine")
      .then((res) => setBankInfo(res.data))
      .catch(() => setBankInfo(null));
  }, []);

  const [enCoursDePaiement, setEnCoursDePaiement] = useState(false);

  const retourPaiement = useRetourDePaiement(load);

  async function pay(invoiceId: string, method: PaymentMethod) {
    // Le seul geste irréversible du portail locataire n'avait aucun garde-fou :
    // ni bouton grisé, ni indication de progression. Rien ne bougeant à
    // l'écran, recliquer était le réflexe naturel — et déclarait le virement
    // deux fois, ou créait deux intentions de paiement avant la redirection.
    if (enCoursDePaiement) return;
    setEnCoursDePaiement(true);
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
    } finally {
      // Volontairement dans un `finally` : sur le chemin de redirection on ne
      // revient jamais ici, mais sur tous les autres — succès comme échec — le
      // bouton doit redevenir cliquable, sans quoi un échec réseau
      // condamnerait le paiement jusqu'au rechargement de la page.
      setEnCoursDePaiement(false);
    }
  }

  const unpaidInvoices = invoices.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED");
  const paidInvoices = invoices.filter((i) => i.status === "PAID");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {t("tenant.invoices.title")}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            {t("tenant.invoices.subtitle")}
          </p>
        </div>
        {unpaidInvoices.length === 0 && invoices.length > 0 && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} />
            {t("tenant.invoices.allUpToDate")}
          </div>
        )}
      </div>

      {/* Retour d'un prestataire de paiement : voir useRetourDePaiement. */}
      {retourPaiement === "succes" && (
        <div className="text-sm bg-sky-50 border border-sky-200 text-sky-800 rounded-xl px-4 py-3 flex items-center gap-2 shadow-2xs">
          <Clock size={16} />
          <span>{t("common.payment.returned")}</span>
        </div>
      )}
      {retourPaiement === "annule" && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 shadow-2xs">
          {t("common.payment.cancelled")}
        </div>
      )}

      {message && (
        <div role="status" className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 flex items-center gap-2 shadow-2xs">
          <CheckCircle2 size={16} />
          <span>{message}</span>
        </div>
      )}
      {error && (
        <div className="text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 shadow-2xs">
          {error}
        </div>
      )}

      {/* Quick Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="bg-white rounded-2xl border border-contour-200/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {t("tenant.invoices.pendingTitle")}
            </p>
            <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock size={15} aria-hidden="true" />
            </span>
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900">
            {t(unpaidInvoices.length > 1 ? "tenant.invoices.pendingMany" : "tenant.invoices.pendingOne", { count: unpaidInvoices.length })}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-contour-200/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {t("tenant.invoices.receiptsTitle")}
            </p>
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Download size={15} aria-hidden="true" />
            </span>
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900">
            {t(paidInvoices.length > 1 ? "tenant.invoices.receiptMany" : "tenant.invoices.receiptOne", { count: paidInvoices.length })}
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
              className={`bg-white rounded-2xl border shadow-xs transition-all duration-200 p-5 ${
                isLate
                  ? "border-rose-300 bg-rose-50/10"
                  : isPaid
                  ? "border-contour-200/90"
                  : "border-amber-200"
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-900 capitalize text-base">
                      {monthLabel(i18n.language, inv.periodMonth)} {inv.periodYear}
                    </p>
                    <span className="text-slate-300">•</span>
                    <span className="text-xs font-medium text-slate-600">
                      <NomDuBien titre={inv.contract?.property?.title} id={inv.contract?.property?.id} />
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    {t("tenant.invoices.dueDate", {
                      date: formaterJour(inv.dueDate, i18n.language),
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-3.5 flex-wrap">
                  <span className="font-bold text-lg sm:text-xl text-slate-900">
                    {formatMoney(inv.amount, inv.currency)}
                  </span>
                  <Badge status={inv.status} />
                  {!isPaid && inv.status !== "CANCELLED" && (inv.montantRegle ?? 0) > 0 && (inv.resteDu ?? 0) > 0 && (
                    <span className="basis-full text-[11px] font-medium text-amber-700">
                      {t("tenant.invoices.partiallyPaid", {
                        paid: formatMoney(inv.montantRegle ?? 0, inv.currency),
                        remaining: formatMoney(inv.resteDu ?? 0, inv.currency),
                      })}
                    </span>
                  )}
                  {isPaid && (
                    <Bulle texte={t("tenant.tips.viewReceipt")}>
                    <button
                      onClick={() => setActiveReceiptInvoice(inv)}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <Download size={13} />
                      <span>{t("tenant.invoices.receiptPdf")}</span>
                    </button>
                    </Bulle>
                  )}
                  {!isPaid && inv.status !== "CANCELLED" && (
                    <Bulle texte={t("tenant.tips.choosePayment")}>
                    <button
                      onClick={() => setPayingId(payingId === inv.id ? null : inv.id)}
                      className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs shadow-brand-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      {t("tenant.invoices.pay")}
                    </button>
                    </Bulle>
                  )}
                </div>
              </div>

              {payingId === inv.id && (
                <div className="mt-5 pt-4 border-t border-contour-100 animate-in fade-in duration-200">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                    {t("tenant.invoices.choosePaymentTitle")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {methods.map((m) => (
                      <div
                        key={m.key}
                        className="border border-contour-200 rounded-xl p-4 bg-slate-50/50 hover:border-brand-400 transition-colors"
                      >
                        <p className="text-sm font-bold text-slate-800">{m.label}</p>
                        <p className="text-xs text-slate-600 mt-1">{m.hint}</p>
                        {m.key === "BANK_TRANSFER" && (
                          <>
                            <BankDetails
                              info={bankInfo}
                              title={t("tenant.invoices.bankDetails.title")}
                              ibanLabel={t("tenant.invoices.bankDetails.iban")}
                              bicLabel={t("tenant.invoices.bankDetails.bic")}
                              missingMessage={t("tenant.invoices.bankDetails.missing")}
                              copyLabel={t("tenant.invoices.bankDetails.copy")}
                              copiedLabel={t("tenant.invoices.bankDetails.copied")}
                            />
                            <input
                              aria-label={t("tenant.invoices.bankRefPlaceholder")}
                              placeholder={t("tenant.invoices.bankRefPlaceholder")}
                              value={bankRef}
                              maxLength={200}
                              onChange={(e) => setBankRef(e.target.value)}
                              className="w-full mt-3 rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-1.5 text-xs focus:ring-2 focus:ring-brand-500/30 outline-hidden"
                            />
                          </>
                        )}
                        <Bulle texte={t("tenant.tips.pay")}>
                        <button
                          onClick={() => pay(inv.id, m.key)}
                          disabled={enCoursDePaiement}
                          className="mt-3.5 w-full text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg py-2 transition-colors cursor-pointer shadow-2xs"
                        >
                          {enCoursDePaiement ? t("tenant.invoices.paying") : t("tenant.invoices.chooseMethod")}
                        </button>
                        </Bulle>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {invoices.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl border border-contour-200 p-6">
            <p className="text-slate-600 text-sm">{t("tenant.invoices.noInvoices")}</p>
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
