import { CheckCircle2, Clock, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import BankDetails from "../../components/BankDetails";
import DocumentModal from "../../components/DocumentModal";
import GroupeFiltres from "../../components/GroupeFiltres";
import { useCurrency } from "../../context/currency";
import { useMoyensDePaiement } from "../../hooks/useMoyensDePaiement";
import { useRetourDePaiement } from "../../hooks/useRetourDePaiement";
import type { AgencyBankInfo, Invoice, InvoiceStatus, PaymentMethod } from "../../types";
import Bulle from "../../components/Bulle";
import { formaterJour } from "../../utils/jourCivil";
import { joursDeRetard } from "../../utils/syntheseLoyers";
import { anneesDesLoyers, filtrerLoyers, situationLoyers, type FiltreLoyers } from "../../utils/syntheseLocataire";
import { NomDuBien } from "../../components/PlanLogement";

function monthLabel(locale: string, monthIndex1to12: number) {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, monthIndex1to12 - 1, 1));
}

/** Filet de la ligne et étiquette de statut : le rouge signale un retard, l'encre un loyer réglé, l'orange un loyer à régler. */
const TEINTE_FACTURE: Record<InvoiceStatus, { filet: string; tag: string }> = {
  PENDING: { filet: "border-l-orange-700", tag: "border-orange-700/50 bg-orange-50 text-orange-800" },
  LATE: { filet: "border-l-rose-600", tag: "border-rose-300 bg-rose-50 text-rose-800" },
  PAID: { filet: "border-l-ink-900", tag: "border-ink-900 bg-slate-50 text-ink-900" },
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
  const [filtre, setFiltre] = useState<FiltreLoyers>("all");
  const [annee, setAnnee] = useState<number | "all">("all");

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
  const maintenant = new Date();
  const situation = situationLoyers(invoices, maintenant);
  const annees = anneesDesLoyers(invoices);
  const visibles = filtrerLoyers(invoices, filtre, annee);
  const montants = (liste: Array<{ devise: string; montant: number }>) => liste.map((m) => formatMoney(m.montant, m.devise || undefined)).join(" · ");

  function payerLaPlusAncienne() {
    if (!situation.prochaine) return;
    setPayingId(situation.prochaine.id);
    // Le panneau de règlement s'ouvre dans la ligne : on y amène la page.
    setTimeout(() => document.getElementById(`loyer-${situation.prochaine!.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 50);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{t("tenant.invoices.title")}</h2>
          <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">{t("tenant.invoices.subtitle")}</p>
        </div>
        {unpaidInvoices.length === 0 && invoices.length > 0 && (
          <div className="inline-flex items-center gap-1.5 border border-ink-900 bg-slate-50 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">
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
        <div role="status" className="flex items-center gap-2 border border-ink-900 bg-slate-50 px-4 py-3 text-sm text-ink-900 shadow-[inset_4px_0_0_var(--color-ink-900)]">
          <CheckCircle2 size={16} />
          <span>{message}</span>
        </div>
      )}
      {error && <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-[inset_4px_0_0_var(--color-rose-600)]">{error}</div>}

      {/* Situation : ce qui reste à payer, les retards, la prochaine échéance et les quittances. */}
      <BandeauChiffres
        etiquette={t("tenant.invoices.summary.label")}
        cases={[
          {
            libelle: t("tenant.invoices.pendingTitle"),
            valeur: t(unpaidInvoices.length > 1 ? "tenant.invoices.pendingMany" : "tenant.invoices.pendingOne", { count: unpaidInvoices.length }),
            aide: situation.resteDu.length > 0 ? `${t("tenant.invoices.summary.due")} : ${montants(situation.resteDu)}` : t("tenant.invoices.summary.dueNone"),
          },
          {
            libelle: t("tenant.invoices.summary.late"),
            valeur: situation.enRetard,
            aide: situation.enRetard > 0 ? t("tenant.invoices.summary.lateHint", { days: situation.retardMax }) : t("tenant.invoices.summary.lateNone"),
            ton: situation.enRetard > 0 ? "alerte" : "normal",
          },
          {
            libelle: t("tenant.invoices.summary.next"),
            valeur: situation.prochaine ? formaterJour(situation.prochaine.dueDate, i18n.language) : "—",
            aide: !situation.prochaine
              ? t("tenant.invoices.summary.nextNone")
              : situation.prochaine.jours < 0
              ? t("tenant.invoices.summary.nextOverdue", { days: -situation.prochaine.jours })
              : situation.prochaine.jours === 0
              ? t("tenant.invoices.summary.nextToday")
              : t("tenant.invoices.summary.nextSoon", { days: situation.prochaine.jours }),
            ton: situation.prochaine && situation.prochaine.jours < 0 ? "alerte" : "normal",
          },
          {
            libelle: t("tenant.invoices.receiptsTitle"),
            valeur: t(paidInvoices.length > 1 ? "tenant.invoices.receiptMany" : "tenant.invoices.receiptOne", { count: paidInvoices.length }),
            aide: situation.regleCetteAnnee.length > 0 ? `${t("tenant.invoices.summary.paidYear", { year: maintenant.getFullYear() })} : ${montants(situation.regleCetteAnnee)}` : undefined,
          },
        ]}
      />

      {situation.prochaine && (
        <div className="flex">
          <button
            type="button"
            onClick={payerLaPlusAncienne}
            className="cursor-pointer border border-ink-900 bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
          >
            {t("tenant.invoices.payOldest")}
          </button>
        </div>
      )}

      {invoices.length > 3 && (
        <div className="flex flex-wrap items-end gap-3">
          <GroupeFiltres
            libelle={t("tenant.invoices.filtersLabel")}
            actif={filtre}
            onChange={(cle) => setFiltre(cle as FiltreLoyers)}
            filtres={[
              { cle: "all", libelle: t("tenant.invoices.filters.all"), compte: filtrerLoyers(invoices, "all", annee).length },
              { cle: "due", libelle: t("tenant.invoices.filters.due"), compte: filtrerLoyers(invoices, "due", annee).length },
              { cle: "paid", libelle: t("tenant.invoices.filters.paid"), compte: filtrerLoyers(invoices, "paid", annee).length },
            ]}
          />
          {annees.length > 1 && (
            <div>
              <label htmlFor="loyers-annee" className="sr-only">
                {t("tenant.invoices.yearLabel")}
              </label>
              <select
                id="loyers-annee"
                value={annee}
                onChange={(e) => setAnnee(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="border border-slate-400 bg-white px-3 py-1.5 text-sm text-slate-900"
              >
                <option value="all">{t("tenant.invoices.allYears")}</option>
                {annees.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Le registre des loyers : une ligne par échéance, le mois en onglet à gauche. */}
      <div className="space-y-3">
        {visibles.map((inv) => {
          const isPaid = inv.status === "PAID";
          const teinte = TEINTE_FACTURE[inv.status] ?? TEINTE_FACTURE.CANCELLED;
          const mois = monthLabel(i18n.language, inv.periodMonth);
          return (
            <div key={inv.id} id={`loyer-${inv.id}`} className={`border border-l-4 border-slate-300 bg-white ${teinte.filet}`}>
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
                      {joursDeRetard(inv, maintenant) > 0 && (
                        <span className="ml-2 font-semibold text-rose-700">· {t("tenant.invoices.lateDays", { count: joursDeRetard(inv, maintenant) })}</span>
                      )}
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
                          className="flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-white px-3.5 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
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
        {invoices.length > 0 && visibles.length === 0 && (
          <div className="border border-slate-300 bg-white p-6 py-10 text-center">
            <p className="text-sm text-slate-600">{t("tenant.invoices.noResult")}</p>
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
