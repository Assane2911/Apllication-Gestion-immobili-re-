import { CheckCircle2, Clock, Download, Megaphone, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
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
import { correspond } from "../../utils/recherche";
import { csvFactures, estDue, joursDeRetard, syntheseFactures } from "../../utils/syntheseLoyers";
import { dateDuJourPourFichier, telechargerCsv } from "../../utils/telechargement";

const BOUTON_PLEIN = "inline-flex cursor-pointer items-center gap-2 bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-50";
const BOUTON_TRAIT = "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900";
const ACTION = "inline-flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50";
const ACTION_TRAIT = `${ACTION} border-slate-400 bg-white text-slate-800 hover:border-ink-900 hover:bg-slate-100`;
const ACTION_ENCRE = `${ACTION} border-ink-900 bg-ink-900 text-white hover:border-orange-700 hover:bg-orange-700`;
const ACTION_RECU = `${ACTION} border-ink-900 bg-white text-ink-900 hover:bg-slate-100`;
const ACTION_ANNULER = `${ACTION} border-orange-300 bg-white text-orange-800 hover:bg-orange-50`;

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
      <span className="mt-1 block text-[11px] text-orange-800">
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
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [relanceEnCours, setRelanceEnCours] = useState<{ fait: number; total: number } | null>(null);

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

  // La sélection ne garde que ce qui est encore à l'écran et encore relançable (la liste change avec la page et le filtre).
  const relancables = invoices.filter(estDue);
  const idsRelancables = new Set(relancables.map((f) => f.id));
  const selectionValide = Array.from(selection).filter((id) => idsRelancables.has(id));

  function basculer(id: string) {
    setSelection((actuelle) => {
      const suivante = new Set(actuelle);
      if (suivante.has(id)) suivante.delete(id);
      else suivante.add(id);
      return suivante;
    });
  }

  /** Une relance par facture, l'une après l'autre : le serveur envoie un email à chaque appel, et un échec n'arrête pas les suivants. */
  async function relancerLaSelection() {
    const ids = selectionValide;
    if (ids.length === 0 || relanceEnCours) return;
    setFeedback(null);
    setError(null);
    setRelanceEnCours({ fait: 0, total: ids.length });
    let envoyees = 0;
    let echecs = 0;
    for (const id of ids) {
      try {
        await api.post(`/invoices/${id}/send-reminder`);
        envoyees += 1;
      } catch {
        echecs += 1;
      }
      setRelanceEnCours({ fait: envoyees + echecs, total: ids.length });
    }
    setRelanceEnCours(null);
    setSelection(new Set());
    setFeedback(t(echecs > 0 ? "manager.invoices.selection.partial" : "manager.invoices.selection.done", { sent: envoyees, failed: echecs }));
    load();
  }

  const periodeLabel = (inv: Invoice) => `${monthLabel(i18n.language, inv.periodMonth)} ${inv.periodYear}`;
  const visibles = invoices.filter((inv) =>
    correspond(recherche, inv.contract?.tenant?.firstName, inv.contract?.tenant?.lastName, inv.contract?.tenant?.email, inv.contract?.property?.title, periodeLabel(inv))
  );
  const synthese = syntheseFactures(invoices);
  const montants = (cle: "resteADu" | "enRetard" | "encaisse") => synthese.filter((d) => d[cle] > 0).map((d) => formatMoney(d[cle], d.currency)).join(" + ") || formatMoney(0);
  const totalEnRetard = synthese.reduce((somme, d) => somme + d.nbEnRetard, 0);
  const taux = synthese.length === 1 ? synthese[0].tauxRecouvrement : null;

  function exporterCsv() {
    telechargerCsv(
      `factures-${dateDuJourPourFichier()}.csv`,
      csvFactures(
        visibles,
        {
          period: t("manager.invoices.csv.period"),
          tenant: t("manager.invoices.table.tenant"),
          property: t("manager.invoices.table.property"),
          currency: t("manager.invoices.csv.currency"),
          amount: t("manager.invoices.table.amount"),
          paid: t("manager.invoices.csv.paid"),
          remaining: t("manager.invoices.csv.remaining"),
          dueDate: t("manager.invoices.table.dueDate"),
          status: t("manager.invoices.table.status"),
        },
        (st) => t(`common.status.${st}`)
      )
    );
  }

  const ligneRetard = (inv: Invoice) => {
    const jours = joursDeRetard(inv);
    return jours > 0 ? <span className="block text-[11px] font-semibold text-orange-800">{t("manager.invoices.daysLate", { count: jours })}</span> : null;
  };

  const actionsFacture = (inv: Invoice) => (
    <>
      {inv.status === "PAID" && (
        <Bulle texte={t("manager.tips.invoiceReceipt")}>
          <button onClick={() => setActiveReceiptInvoice(inv)} className={ACTION_RECU}>
            <Download size={12} aria-hidden="true" /> {t("manager.invoices.receiptPdf")}
          </button>
        </Bulle>
      )}
      {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
        <>
          <Bulle texte={t("manager.tips.invoiceRemind")}>
            <button onClick={() => handleSendSingleReminder(inv)} disabled={sendingSingleId === inv.id} className={ACTION_TRAIT}>
              {sendingSingleId === inv.id ? (
                t("manager.invoices.sendingReminder")
              ) : (
                <>
                  <Send size={12} aria-hidden="true" /> {t("manager.invoices.remind")}
                </>
              )}
            </button>
          </Bulle>
          <Bulle texte={t("manager.tips.invoiceMarkPaid")}>
            <button onClick={() => setFactureAMarquer(inv)} className={ACTION_ENCRE}>
              {t("manager.invoices.markPaid")}
            </button>
          </Bulle>
          {annulable(inv) && (
            <Bulle texte={t("manager.tips.invoiceCancel")}>
              <button onClick={() => handleCancelInvoice(inv)} disabled={cancellingId === inv.id} className={ACTION_ANNULER}>
                {cancellingId === inv.id ? t("manager.invoices.cancelling") : t("manager.invoices.cancelInvoice")}
              </button>
            </Bulle>
          )}
        </>
      )}
    </>
  );

  const acompte = (inv: Invoice) =>
    aUnAcompte(inv) && (
      <span className="block text-[10px] font-medium text-orange-800">
        {t("manager.invoices.partiallyPaid", {
          paid: formatMoney(inv.montantRegle ?? 0, inv.currency),
          remaining: formatMoney(inv.resteDu ?? 0, inv.currency),
        })}
      </span>
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.invoices.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.invoices.subtitle")}</p>
        </div>
        <Bulle texte={t("manager.tips.invoiceSendMonthly")}>
          <button onClick={handleSendMonthlyReminders} disabled={sendingMonthly} className={BOUTON_PLEIN}>
            <Megaphone size={14} className="shrink-0" aria-hidden="true" />
            <span>{sendingMonthly ? t("manager.invoices.sendingMonthly") : t("manager.invoices.sendMonthlyAlerts")}</span>
          </button>
        </Bulle>
      </div>

      {/* Bannière informationnelle sur le rappel automatique du 1er */}
      <div className="flex items-start gap-3 border border-slate-300 bg-white p-4 text-xs text-slate-800 shadow-[inset_4px_0_0_var(--color-ink-900)]">
        <Clock size={16} className="mt-0.5 shrink-0 text-ink-900" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-semibold">{t("manager.invoices.infoBannerTitle")}</p>
          <p className="text-slate-700">
            <Trans i18nKey="manager.invoices.infoBannerBody" components={{ 1: <strong /> }} />
          </p>
        </div>
      </div>

      {feedback && (
        <div role="status" className="flex items-center gap-2 border border-slate-300 bg-white px-4 py-3 text-xs font-medium text-ink-900 shadow-[inset_4px_0_0_var(--color-ink-900)]">
          <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" />
          {feedback}
        </div>
      )}

      {error && (
        <div role="alert" className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      )}

      {aMettreEnDemeure.length > 0 && (
        <section aria-labelledby="mises-en-demeure" className="border border-slate-300 bg-white shadow-[inset_4px_0_0_var(--color-orange-700)]">
          <header className="border-b border-slate-300 bg-slate-50 py-3 pl-6 pr-5">
            <h3 id="mises-en-demeure" className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">
              {t("manager.invoices.formalNotices.title", { count: aMettreEnDemeure.length })}
            </h3>
            <p className="mt-1 text-xs text-slate-700">{t("manager.invoices.formalNotices.hint")}</p>
          </header>
          <ul className="divide-y divide-slate-200 py-1 pl-6 pr-5">
            {aMettreEnDemeure.map((b) => (
              <li key={b.contractId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="text-slate-800">
                  <span className="font-medium">{b.propertyTitle}</span> — {b.tenantName}
                  <span className="block text-xs text-slate-600">
                    {t("manager.invoices.formalNotices.line", { count: b.unpaidCount, total: formatMoney(b.totalDue, b.currency), days: b.daysLate })}
                    {b.alreadyClaimedCount > 0 && <> · {t("manager.invoices.formalNotices.alreadyClaimed", { count: b.alreadyClaimedCount })}</>}
                  </span>
                </span>
                <button type="button" onClick={() => setBailEnDemeure(b)} className={`${ACTION} border-orange-700 bg-orange-700 text-white hover:bg-orange-800`}>
                  {t("manager.invoices.formalNotices.action")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {invoices.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.invoices.summary.label")}
          cases={[
            { libelle: t("manager.invoices.summary.remaining"), valeur: montants("resteADu"), aide: t("manager.invoices.summary.remainingHint") },
            {
              libelle: t("manager.invoices.summary.late"),
              valeur: montants("enRetard"),
              aide: t("manager.invoices.summary.lateHint", { count: totalEnRetard }),
              ton: totalEnRetard > 0 ? "alerte" : "normal",
            },
            { libelle: t("manager.invoices.summary.collected"), valeur: montants("encaisse"), aide: t("manager.invoices.summary.collectedHint") },
            { libelle: t("manager.invoices.summary.recovery"), valeur: taux === null ? "—" : `${taux} %`, aide: t("manager.invoices.summary.recoveryHint") },
          ]}
        />
      )}

      <BarreListe
        idPrefixe="factures"
        recherche={recherche}
        onRecherche={setRecherche}
        placeholderRecherche={t("manager.invoices.search")}
        libelleFiltres={t("manager.invoices.filterByStatus")}
        filtres={[
          { cle: "ALL", libelle: t("manager.invoices.filterAll") },
          ...(["PENDING", "LATE", "PAID", "CANCELLED"] as const).map((st) => ({ cle: st, libelle: t(`common.status.${st}`) })),
        ]}
        filtreActif={filter}
        onFiltre={(cle) => handleFilterChange(cle as InvoiceStatus | "ALL")}
      >
        {invoices.length > 0 && (
          <button type="button" onClick={exporterCsv} className={BOUTON_TRAIT}>
            <Download size={13} aria-hidden="true" />
            {t("manager.liste.exportCsv")}
          </button>
        )}
      </BarreListe>

      {/* Relance groupée : apparaît dès qu'une facture due est cochée. */}
      {selectionValide.length > 0 && (
        <div role="region" aria-label={t("manager.invoices.selection.count", { count: selectionValide.length })} className="flex flex-wrap items-center justify-between gap-3 border border-ink-900 bg-white px-4 py-3">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t("manager.invoices.selection.count", { count: selectionValide.length })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSelection(new Set())} disabled={relanceEnCours !== null} className="cursor-pointer px-2 py-2 text-xs text-slate-600 hover:text-ink-900 disabled:opacity-50">
              {t("manager.invoices.selection.clear")}
            </button>
            <button type="button" onClick={relancerLaSelection} disabled={relanceEnCours !== null} className={BOUTON_PLEIN}>
              <Send size={13} aria-hidden="true" />
              {relanceEnCours ? t("manager.invoices.selection.reminding", { done: relanceEnCours.fait, total: relanceEnCours.total }) : t("manager.invoices.selection.remind")}
            </button>
          </div>
        </div>
      )}

      {/* Vue tableau (écrans sm et plus) */}
      <div className="relative hidden overflow-x-auto border border-slate-300 bg-white sm:block">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={t("manager.invoices.selection.all")}
                  checked={relancables.length > 0 && relancables.every((f) => selection.has(f.id))}
                  disabled={relancables.length === 0}
                  onChange={(e) => setSelection(e.target.checked ? new Set(relancables.map((f) => f.id)) : new Set())}
                  className="size-4 cursor-pointer accent-orange-700"
                />
              </th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.period")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.tenant")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.property")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.amount")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.dueDate")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.method")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.invoices.table.status")}</th>
              <th className="px-4 py-3 text-right font-semibold">{t("manager.invoices.table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibles.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className={`px-4 py-3.5 ${inv.status === "LATE" ? "shadow-[inset_3px_0_0_var(--color-orange-700)]" : ""}`}>
                  {estDue(inv) && (
                    <input
                      type="checkbox"
                      aria-label={t("manager.invoices.selection.row", { name: `${inv.contract?.tenant?.firstName ?? ""} ${inv.contract?.tenant?.lastName ?? ""}`.trim(), period: periodeLabel(inv) })}
                      checked={selection.has(inv.id)}
                      onChange={() => basculer(inv.id)}
                      className="size-4 cursor-pointer accent-orange-700"
                    />
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 font-medium text-slate-900">{periodeLabel(inv)}</td>
                <td className="px-4 py-3.5 text-slate-700">
                  <p className="font-medium">{inv.contract?.tenant?.firstName} {inv.contract?.tenant?.lastName}</p>
                  <p className="text-[11px] text-slate-600">{inv.contract?.tenant?.email}</p>
                </td>
                <td className="px-4 py-3.5 text-slate-600"><NomDuBien titre={inv.contract?.property?.title} id={inv.contract?.property?.id} /></td>
                <td className="px-4 py-3.5 font-bold tabular-nums text-slate-900">
                  {formatMoney(inv.amount, inv.currency)}
                  {acompte(inv)}
                </td>
                <td className="px-4 py-3.5 text-slate-600">
                  <span className="text-xs">{formaterJour(inv.dueDate, i18n.language)}</span>
                  {ligneRetard(inv)}
                </td>
                <td className="px-4 py-3.5 text-xs text-slate-600">{inv.paymentMethod ? methodLabels[inv.paymentMethod] : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3.5">
                  <Badge status={inv.status} />
                  {niveauRelance(inv)}
                </td>
                {/* Actions à la ligne : sur une seule, elles élargissaient le tableau au-delà de l'écran. */}
                <td className="max-w-76 px-4 py-3.5 text-right">
                  <div className="flex flex-wrap justify-end gap-2">{actionsFacture(inv)}</div>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-600">
                  {t("manager.invoices.noInvoicesForFilter")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Vue cartes empilées (mobile, < sm) */}
      <div className="space-y-3 sm:hidden">
        {visibles.length === 0 ? (
          <p className="border border-slate-300 bg-white py-8 text-center text-sm text-slate-600">{t("manager.invoices.noInvoicesForFilter")}</p>
        ) : (
          visibles.map((inv) => (
            <div key={inv.id} className={`space-y-2.5 border border-slate-300 bg-white p-4 ${inv.status === "LATE" ? "shadow-[inset_3px_0_0_var(--color-orange-700)]" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{periodeLabel(inv)}</p>
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
                  {acompte(inv)}
                </span>
                <span className="text-right text-slate-600">
                  {t("manager.invoices.dueDatePrefix", { date: formaterJour(inv.dueDate, i18n.language) })}
                  {ligneRetard(inv)}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">{actionsFacture(inv)}</div>
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
