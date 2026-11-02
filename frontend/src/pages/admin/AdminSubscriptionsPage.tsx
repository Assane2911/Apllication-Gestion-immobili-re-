import { Check, Copy, Download, Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, liste } from "../../api/client";
import { useCurrency } from "../../context/currency";
import BarreListe from "../../components/BarreListe";
import EmptyState from "../../components/EmptyState";
import { formaterJour } from "../../utils/jourCivil";
import { csvVirements, filtrerVirements, SEUIL_ATTENTE_VIREMENT_JOURS, type FiltreVirements } from "../../utils/syntheseAdmin";
import { dateDuJourPourFichier, telechargerCsv } from "../../utils/telechargement";
import { PLAN_CLASSES, type ManagerPlan } from "./managerStatus";

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

const JOUR_MS = 86_400_000;
/** Au-delà de ce délai, un virement annoncé et toujours non traité est signalé : le gestionnaire attend son accès. */
const SEUIL_ATTENTE_JOURS = SEUIL_ATTENTE_VIREMENT_JOURS;

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
  const [copiee, setCopiee] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<FiltreVirements>("all");

  function load() {
    setLoadError(null);
    api
      .get<PendingBankTransfer[]>("/admin/subscriptions/pending-bank-transfers")
      .then((res) => setRows(liste<PendingBankTransfer>(res.data)))
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function copierReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopiee(reference);
      setTimeout(() => setCopiee((actuelle) => (actuelle === reference ? null : actuelle)), 1800);
    } catch {
      // Presse-papiers indisponible : la référence reste lisible dans le tableau.
    }
  }

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

  // Les plus anciens d'abord : ce sont ceux dont le gestionnaire attend l'accès depuis le plus longtemps.
  const lignes = filtrerVirements(
    [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    recherche,
    filtre
  );

  function exporter() {
    const csv = csvVirements(
      lignes,
      {
        manager: t("admin.subscriptions.csv.manager"),
        plan: t("admin.subscriptions.csv.plan"),
        cycle: t("admin.subscriptions.csv.cycle"),
        amount: t("admin.subscriptions.csv.amount"),
        currency: t("admin.subscriptions.csv.currency"),
        reference: t("admin.subscriptions.csv.reference"),
        since: t("admin.subscriptions.csv.since"),
        waiting: t("admin.subscriptions.csv.waiting"),
      },
      (iso) => new Date(iso).toLocaleDateString(i18n.language)
    );
    telechargerCsv(`virements-en-attente-${dateDuJourPourFichier()}.csv`, csv);
  }
  // À encaisser, devise par devise : on n'additionne jamais des euros et des francs CFA.
  const totaux = new Map<string, number>();
  for (const row of rows) totaux.set(row.currency, (totaux.get(row.currency) ?? 0) + row.amount);
  const occupe = (row: PendingBankTransfer) => confirmingId === row.id || rejectingId === row.id;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("admin.subscriptions.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("admin.subscriptions.subtitle")}</p>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
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
        <>
          {/* Le bordereau : combien de virements attendent, et pour quelle somme dans chaque devise. */}
          <div className="flex flex-wrap items-stretch border border-slate-300 bg-white">
            <p className="flex items-center border-r border-slate-300 px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink-900 shadow-[inset_4px_0_0_var(--color-orange-700)]">
              {t("admin.subscriptions.pendingCount", { count: rows.length })}
            </p>
            {[...totaux].map(([devise, total]) => (
              <p key={devise} className="flex items-center border-r border-slate-300 px-5 py-3 font-mono text-xs tabular-nums text-slate-800 last:border-r-0">
                {`${t("admin.subscriptions.toCollect")} · ${formatMoney(total, devise)}`}
              </p>
            ))}
          </div>

          <BarreListe
            idPrefixe="virements"
            recherche={recherche}
            onRecherche={setRecherche}
            placeholderRecherche={t("admin.subscriptions.search")}
            libelleFiltres={t("admin.subscriptions.filtersLabel")}
            filtreActif={filtre}
            onFiltre={(cle) => setFiltre(cle as FiltreVirements)}
            filtres={[
              { cle: "all", libelle: t("admin.subscriptions.filters.all"), compte: rows.length },
              { cle: "late", libelle: t("admin.subscriptions.filters.late", { days: SEUIL_ATTENTE_JOURS }), compte: filtrerVirements(rows, recherche, "late").length },
            ]}
          >
            <button
              type="button"
              onClick={exporter}
              disabled={lignes.length === 0}
              className="inline-flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-white px-3 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={13} aria-hidden="true" /> {t("admin.subscriptions.exportCsv")}
            </button>
          </BarreListe>
          {(recherche.trim() !== "" || filtre !== "all") && (
            <p className="font-mono text-xs uppercase tracking-wider text-slate-600">{t("admin.subscriptions.shown", { shown: lignes.length, total: rows.length })}</p>
          )}
          {lignes.length === 0 && <p className="border border-slate-300 bg-white py-10 text-center text-sm text-slate-600">{t("admin.subscriptions.noResult")}</p>}

          <div className={`relative overflow-x-auto border border-slate-300 bg-white ${lignes.length === 0 ? "hidden" : ""}`}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3">{t("admin.subscriptions.table.manager")}</th>
                  <th scope="col" className="px-4 py-3">{t("admin.subscriptions.table.plan")}</th>
                  <th scope="col" className="px-4 py-3">{t("admin.subscriptions.table.cycle")}</th>
                  <th scope="col" className="px-4 py-3">{t("admin.subscriptions.table.amount")}</th>
                  <th scope="col" className="px-4 py-3">{t("admin.subscriptions.table.reference")}</th>
                  <th scope="col" className="px-4 py-3">{t("admin.subscriptions.table.since")}</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">{t("admin.subscriptions.table.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {lignes.map((row) => {
                  const attente = Math.max(0, Math.floor((Date.now() - new Date(row.createdAt).getTime()) / JOUR_MS));
                  const enRetard = attente >= SEUIL_ATTENTE_JOURS;
                  return (
                    <tr key={row.id} className={enRetard ? "shadow-[inset_4px_0_0_var(--color-orange-700)]" : undefined}>
                      <td className="px-4 py-3">
                        <Link to={`/admin/gestionnaires/${row.userId}`} className="font-semibold text-ink-900 hover:text-orange-700">
                          {row.managerEmail}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 font-semibold ${PLAN_CLASSES[row.plan as ManagerPlan] ?? "border border-slate-300 bg-white text-slate-800"}`}>
                          {t(`common.plans.${row.plan}`, { defaultValue: row.plan })}
                        </span>
                        <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-600">
                          {t("admin.subscriptions.period", {
                            from: formaterJour(row.startDate, i18n.language),
                            to: formaterJour(row.endDate, i18n.language),
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {row.billingCycle === "ANNUAL" ? t("admin.subscriptions.annual") : t("admin.subscriptions.monthly")}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold tabular-nums">{formatMoney(row.amount, row.currency)}</td>
                      <td className="px-4 py-3">
                        {row.paymentRef ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-slate-700">
                            {row.paymentRef}
                            <button
                              type="button"
                              onClick={() => copierReference(row.paymentRef as string)}
                              aria-label={t("admin.subscriptions.copyReference", { reference: row.paymentRef })}
                              className="inline-flex size-5 cursor-pointer items-center justify-center text-slate-500 hover:text-orange-700"
                            >
                              {copiee === row.paymentRef ? <Check size={12} aria-hidden="true" className="text-ink-900" /> : <Copy size={12} aria-hidden="true" />}
                            </button>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono tabular-nums">{new Date(row.createdAt).toLocaleDateString(i18n.language)}</span>
                        <p className={`mt-0.5 font-mono text-[11px] ${enRetard ? "font-semibold text-orange-700" : "text-slate-600"}`}>
                          {attente === 0 ? t("admin.subscriptions.today") : t("admin.subscriptions.waiting", { count: attente })}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          onClick={() => reject(row)}
                          disabled={occupe(row)}
                          className="mr-2 cursor-pointer whitespace-nowrap border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:opacity-50"
                        >
                          {rejectingId === row.id ? t("admin.subscriptions.rejecting") : t("admin.subscriptions.rejectButton")}
                        </button>
                        <button
                          onClick={() => confirm(row)}
                          disabled={occupe(row)}
                          className="cursor-pointer whitespace-nowrap bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                        >
                          {confirmingId === row.id ? t("admin.subscriptions.confirming") : t("admin.subscriptions.confirmButton")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
