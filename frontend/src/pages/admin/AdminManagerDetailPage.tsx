import { Building2, FileText, UserCog, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import { STATUS_CLASSES, type ManagerPlan, type ManagerStatus } from "./managerStatus";

interface ManagerDetail {
  id: string;
  email: string;
  currency: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  twoFactorEnabled: boolean;
  subscription: {
    status: ManagerStatus;
    plan: ManagerPlan;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
    trialDaysRemaining: number;
    paymentMethod: string | null;
    autoRenew: boolean;
  };
  agency: {
    agencyName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    siretOrId: string | null;
  } | null;
  usage: { properties: number; tenants: number; owners: number; activeContracts: number; collaborators: number };
  lastActivityAt: string | null;
  billingHistory: Array<{
    id: string;
    plan: ManagerPlan;
    amount: number;
    currency: string;
    billingCycle: string;
    status: string;
    paymentMethod: string;
    paymentRef: string | null;
    startDate: string;
    endDate: string;
    createdAt: string;
  }>;
}

/** Fiche d'un gestionnaire pour l'administration : abonnement, usage, agence, facturation. */
export default function AdminManagerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [manager, setManager] = useState<ManagerDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  // Incrémenté après une suspension / réactivation pour relire la fiche.
  const [version, setVersion] = useState(0);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreurAction, setErreurAction] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<ManagerDetail>(`/admin/managers/${id}`)
      .then((res) => {
        if (vivant) setManager(res.data);
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [id, version]);

  async function suspendre(e: React.FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreurAction(null);
    try {
      await api.post(`/admin/managers/${id}/suspend`, { reason: motif.trim() });
      setFormulaireOuvert(false);
      setMotif("");
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(apiErrorMessage(err));
    } finally {
      setEnCours(false);
    }
  }

  async function reactiver() {
    if (!window.confirm(t("admin.managerDetail.suspension.reactivateConfirm"))) return;
    setEnCours(true);
    setErreurAction(null);
    try {
      await api.post(`/admin/managers/${id}/reactivate`);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(apiErrorMessage(err));
    } finally {
      setEnCours(false);
    }
  }

  const date = (valeur: string | null) => (valeur ? new Date(valeur).toLocaleDateString(i18n.language) : "—");
  const carte = "rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5";
  const ligne = (libelle: string, valeur: string) => (
    <div className="flex justify-between gap-4 py-1.5 text-xs">
      <dt className="text-slate-600 dark:text-slate-400">{libelle}</dt>
      <dd className="text-slate-900 dark:text-slate-100 text-right break-words min-w-0">{valeur}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link to="/admin/gestionnaires" className="text-xs text-brand-700 dark:text-brand-400 hover:underline">
        ← {t("admin.managerDetail.back")}
      </Link>

      {chargement && <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.managerDetail.loading")}</p>}

      {erreur && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{t("admin.managerDetail.errorTitle")}</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{erreur}</p>
        </div>
      )}

      {manager && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {manager.agency?.agencyName ?? t("admin.managers.noAgencyName")}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{manager.email}</p>
            </div>
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[manager.subscription.status]}`}>
              {t(`admin.managers.statuses.${manager.subscription.status}`)}
            </span>
          </div>

          <section
            className={`${carte} ${manager.suspendedAt ? "border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30" : ""}`}
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
              {manager.suspendedAt ? t("admin.managerDetail.suspension.suspendedTitle") : t("admin.managerDetail.suspension.title")}
            </h3>
            {manager.suspendedAt ? (
              <>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {t("admin.managerDetail.suspension.since", { date: date(manager.suspendedAt) })}
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 break-words">
                  <span className="font-semibold">{t("admin.managerDetail.suspension.reasonLabel")}</span>{" "}
                  {manager.suspensionReason ?? "—"}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("admin.managerDetail.suspension.reasonHidden")}</p>
                <button
                  type="button"
                  onClick={reactiver}
                  disabled={enCours}
                  className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {enCours ? t("admin.managerDetail.suspension.reactivating") : t("admin.managerDetail.suspension.reactivate")}
                </button>
              </>
            ) : formulaireOuvert ? (
              <form onSubmit={suspendre} className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.managerDetail.suspension.warning")}</p>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t("admin.managerDetail.suspension.reasonField")}
                  <textarea
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    maxLength={500}
                    rows={3}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-normal text-slate-900 dark:text-slate-100"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={enCours || motif.trim().length < 3}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {enCours ? t("admin.managerDetail.suspension.suspending") : t("admin.managerDetail.suspension.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormulaireOuvert(false);
                      setMotif("");
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    {t("admin.managerDetail.suspension.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.managerDetail.suspension.description")}</p>
                <button
                  type="button"
                  onClick={() => setFormulaireOuvert(true)}
                  className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  {t("admin.managerDetail.suspension.suspend")}
                </button>
              </>
            )}
            {erreurAction && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{erreurAction}</p>}
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Building2} label={t("admin.managerDetail.usage.properties")} value={manager.usage.properties} accent="blue" />
            <StatCard icon={Users} label={t("admin.managerDetail.usage.tenants")} value={manager.usage.tenants} accent="blue" />
            <StatCard icon={FileText} label={t("admin.managerDetail.usage.activeContracts")} value={manager.usage.activeContracts} accent="green" />
            <StatCard
              icon={UserCog}
              label={t("admin.managerDetail.usage.collaborators")}
              value={manager.usage.collaborators}
              hint={t("admin.managerDetail.usage.ownersHint", { count: manager.usage.owners })}
              accent="amber"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className={carte}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{t("admin.managerDetail.subscription.title")}</h3>
              <dl>
                {ligne(t("admin.managers.table.plan"), t(`admin.managers.plans.${manager.subscription.plan}`))}
                {manager.subscription.status === "TRIAL" &&
                  ligne(
                    t("admin.managerDetail.subscription.trialEnds"),
                    `${date(manager.subscription.trialEndsAt)} (${t("admin.managerDetail.subscription.daysLeft", { count: manager.subscription.trialDaysRemaining })})`
                  )}
                {manager.subscription.status !== "TRIAL" &&
                  ligne(t("admin.managerDetail.subscription.endsOn"), date(manager.subscription.subscriptionEndsAt ?? manager.subscription.trialEndsAt))}
                {ligne(
                  t("admin.managerDetail.subscription.paymentMethod"),
                  manager.subscription.paymentMethod ?? "—"
                )}
                {ligne(
                  t("admin.managerDetail.subscription.autoRenew"),
                  manager.subscription.autoRenew ? t("admin.managerDetail.yes") : t("admin.managerDetail.no")
                )}
              </dl>
            </section>

            <section className={carte}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{t("admin.managerDetail.account.title")}</h3>
              <dl>
                {ligne(t("admin.managerDetail.account.signup"), date(manager.createdAt))}
                {ligne(t("admin.managerDetail.account.emailVerified"), manager.emailVerifiedAt ? t("admin.managerDetail.yes") : t("admin.managerDetail.no"))}
                {ligne(t("admin.managerDetail.account.twoFactor"), manager.twoFactorEnabled ? t("admin.managerDetail.yes") : t("admin.managerDetail.no"))}
                {ligne(t("admin.managerDetail.account.currency"), manager.currency)}
                {ligne(t("admin.managerDetail.account.lastActivity"), date(manager.lastActivityAt))}
              </dl>
            </section>

            <section className={`${carte} md:col-span-2`}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{t("admin.managerDetail.agency.title")}</h3>
              {manager.agency ? (
                <dl>
                  {ligne(t("admin.managerDetail.agency.name"), manager.agency.agencyName)}
                  {ligne(t("admin.managerDetail.agency.phone"), manager.agency.phone ?? "—")}
                  {ligne(t("admin.managerDetail.agency.email"), manager.agency.email ?? "—")}
                  {ligne(t("admin.managerDetail.agency.address"), manager.agency.address ?? "—")}
                  {ligne(t("admin.managerDetail.agency.registration"), manager.agency.siretOrId ?? "—")}
                </dl>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.managerDetail.agency.none")}</p>
              )}
            </section>
          </div>

          <section className={carte}>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{t("admin.managerDetail.billing.title")}</h3>
            {manager.billingHistory.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.managerDetail.billing.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 pr-4 font-semibold">{t("admin.managerDetail.billing.date")}</th>
                      <th className="py-2 pr-4 font-semibold">{t("admin.managers.table.plan")}</th>
                      <th className="py-2 pr-4 font-semibold">{t("admin.subscriptions.table.amount")}</th>
                      <th className="py-2 pr-4 font-semibold">{t("admin.managerDetail.billing.method")}</th>
                      <th className="py-2 pr-4 font-semibold">{t("admin.managers.table.status")}</th>
                      <th className="py-2 font-semibold">{t("admin.subscriptions.table.reference")}</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-800 dark:text-slate-200">
                    {manager.billingHistory.map((b) => (
                      <tr key={b.id} className="border-b last:border-b-0 border-slate-100 dark:border-slate-800/60">
                        <td className="py-2 pr-4">{date(b.createdAt)}</td>
                        <td className="py-2 pr-4">{t(`admin.managers.plans.${b.plan}`)}</td>
                        <td className="py-2 pr-4 font-semibold">{formatMoney(b.amount, b.currency)}</td>
                        <td className="py-2 pr-4">{b.paymentMethod}</td>
                        <td className="py-2 pr-4">{b.status}</td>
                        <td className="py-2">{b.paymentRef ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
