import { CheckCircle2, Clock, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import BankDetails from "../../components/BankDetails";
import DocumentModal from "../../components/DocumentModal";
import { useCurrency } from "../../context/currency";
import { useMoyensDePaiement } from "../../hooks/useMoyensDePaiement";
import { useRetourDePaiement } from "../../hooks/useRetourDePaiement";
import type { AgencyBankInfo, Invoice, InvoiceStatus, PaymentMethod } from "../../types";
import Bulle from "../../components/Bulle";
import { formaterJour } from "../../utils/jourCivil";
import { NomDuBien } from "../../components/PlanLogement";

function monthLabel(locale: string, monthIndex1to12: number) {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, monthIndex1to12 - 1, 1));
}

/** Filet de la ligne et étiquette de statut : le rouge signale un retard, le vert un loyer réglé, l'orange un loyer à régler. */
const TEINTE_FACTURE: Record<InvoiceStatus, { filet: string; tag: string }> = {
  PENDING: { filet: "border-l-orange-700", tag: "border-orange-700/50 bg-orange-50 text-orange-800" },
  LATE: { filet: "border-l-rose-600", tag: "border-rose-300 bg-rose-50 text-rose-800" },
  PAID: { filet: "border-l-emerald-600", tag: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  CANCELLED: { filet: "border-l-slate-400", tag: "border-slate-400 bg-slate-100 text-slate-700" },
};

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{t("tenant.invoices.title")}</h2>
          <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">{t("tenant.invoices.subtitle")}</p>
        </div>
        {unpaidInvoices.length === 0 && invoices.length > 0 && (
          <div className="inline-flex items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            <CheckCircle2 size={14} />
            {t("tenant.invoices.allUpToDate")}
          </div>
        )}
      </div>

      {/* Retour d'un prestataire de paiement : voir useRetourDePaiement. */}
      {retourPaiement === "succes" && (
        <div className="flex items-center gap-2 border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 shadow-[inset_4px_0_0_var(--color-sky-600)]">
          <Clock size={16} />
          <span>{t("common.payment.returned")}</span>
        </div>
      )}
      {retourPaiement === "annule" && (
        <div className="border border-orange-700/40 bg-orange-50 px-4 py-3 text-sm text-orange-900 shadow-[inset_4px_0_0_var(--color-orange-700)]">
          {t("common.payment.cancelled")}
        </div>
      )}

      {message && (
        <div role="status" className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-[inset_4px_0_0_var(--color-emerald-600)]">
          <CheckCircle2 size={16} />
          <span>{message}</span>
        </div>
      )}
      {error && <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-[inset_4px_0_0_var(--color-rose-600)]">{error}</div>}

      {/* Résumé : loyers à régler et quittances disponibles, en une bande de deux cases. */}
      <div className="grid grid-cols-1 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2">
        <div className="flex items-start justify-between gap-3 border-t-4 border-t-orange-700 bg-white p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("tenant.invoices.pendingTitle")}</p>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">
              {t(unpaidInvoices.length > 1 ? "tenant.invoices.pendingMany" : "tenant.invoices.pendingOne", { count: unpaidInvoices.length })}
            </p>
          </div>
          <Clock size={18} aria-hidden="true" className="mt-1 text-orange-700" />
        </div>
        <div className="flex items-start justify-between gap-3 border-t-4 border-t-emerald-600 bg-white p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("tenant.invoices.receiptsTitle")}</p>
            <p className="mt-1.5 text-2xl font-bold text-slate-900">
              {t(paidInvoices.length > 1 ? "tenant.invoices.receiptMany" : "tenant.invoices.receiptOne", { count: paidInvoices.length })}
            </p>
          </div>
          <Download size={18} aria-hidden="true" className="mt-1 text-emerald-700" />
        </div>
      </div>

      {/* Le registre des loyers : une ligne par échéance, le mois en onglet à gauche. */}
      <div className="space-y-3">
        {invoices.map((inv) => {
          const isPaid = inv.status === "PAID";
          const teinte = TEINTE_FACTURE[inv.status] ?? TEINTE_FACTURE.CANCELLED;
          const mois = monthLabel(i18n.language, inv.periodMonth);
          return (
            <div key={inv.id} className={`border border-l-4 border-slate-300 bg-white ${teinte.filet}`}>
              <div className="flex flex-wrap items-stretch">
                <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-slate-300 bg-slate-50 px-2 py-3 text-center font-mono">
                  <span aria-hidden="true" className="text-[10px] uppercase tracking-wider text-slate-600">{new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(new Date(2000, inv.periodMonth - 1, 1))}</span>
                  <span aria-hidden="true" className="text-lg font-bold tabular-nums text-ink-900">{inv.periodYear}</span>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="text-base font-bold capitalize text-slate-900">
                      {mois} {inv.periodYear}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-700">
                      <NomDuBien titre={inv.contract?.property?.title} id={inv.contract?.property?.id} />
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-slate-600">
                      {t("tenant.invoices.dueDate", {
                        date: formaterJour(inv.dueDate, i18n.language),
                      })}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3.5">
                    <span className="text-lg font-bold tabular-nums text-slate-900 sm:text-xl">{formatMoney(inv.amount, inv.currency)}</span>
                    <span className={`border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${teinte.tag}`}>
                      {t(`common.status.${inv.status}`, { defaultValue: inv.status })}
                    </span>
                    {!isPaid && inv.status !== "CANCELLED" && (inv.montantRegle ?? 0) > 0 && (inv.resteDu ?? 0) > 0 && (
                      <span className="basis-full text-[11px] font-medium text-orange-800">
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
                          className="flex cursor-pointer items-center gap-1.5 border border-emerald-700 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-50"
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
                          className="cursor-pointer border border-ink-900 bg-ink-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
                        >
                          {t("tenant.invoices.pay")}
                        </button>
                      </Bulle>
                    )}
                  </div>
                </div>
              </div>

              {payingId === inv.id && (
                <div className="border-t border-slate-300 bg-slate-50 p-4">
                  <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">{t("tenant.invoices.choosePaymentTitle")}</p>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    {methods.map((m) => (
                      <div key={m.key} className="border border-slate-300 bg-white p-4 transition-colors hover:border-ink-900 hover:shadow-[inset_4px_0_0_var(--color-orange-700)]">
                        <p className="text-sm font-bold text-slate-800">{m.label}</p>
                        <p className="mt-1 text-xs text-slate-600">{m.hint}</p>
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
                              className="mt-3 w-full border border-slate-400 bg-white px-3 py-1.5 text-xs text-slate-900"
                            />
                          </>
                        )}
                        <Bulle texte={t("tenant.tips.pay")} className="block">
                          <button
                            onClick={() => pay(inv.id, m.key)}
                            disabled={enCoursDePaiement}
                            className="mt-3.5 w-full cursor-pointer border border-ink-900 bg-ink-900 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="border border-slate-300 bg-white p-6 py-12 text-center">
            <p className="text-sm text-slate-600">{t("tenant.invoices.noInvoices")}</p>
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
