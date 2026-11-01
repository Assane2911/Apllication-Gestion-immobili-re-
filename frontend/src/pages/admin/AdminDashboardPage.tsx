import { ArrowRight, Building2, CheckCircle2, Clock3, CreditCard, FileText, Landmark, Mail, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, liste } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import type { AdminDashboardStats } from "../../types";

const PLAN_ORDER = ["STARTER", "PRO", "ENTERPRISE"] as const;

/** Une rubrique de la page : numéro de repère + titre en police technique, filet dessous (même bandeau que les réglages). */
function Rubrique({ numero, titre, aide, children }: { numero: string; titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <section aria-label={titre} className="border border-slate-300 bg-white">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-300 bg-slate-50 px-5 py-3">
        <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-orange-700">
          {numero}
        </span>
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{titre}</h3>
        {aide && <p className="ml-auto text-xs text-slate-600">{aide}</p>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  // Les abonnements ne sont plus « toujours facturés en euros » : chaque
  // formule a un tarif propre par devise (voir TARIFS côté backend), et un
  // gestionnaire réglant en FCFA produit des lignes en FCFA — `formatMoney`
  // applique donc toujours la devise DE LA LIGNE (2ᵉ argument), jamais celle
  // de l'admin qui consulte ce tableau de bord.
  const { formatMoney } = useCurrency();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Nombre de virements à traiter : `null` tant qu'il n'est pas connu. C'est un complément de la page, pas son contenu —
  // s'il manque (réseau, serveur plus ancien), la zone « À traiter » se passe de cette ligne au lieu de faire échouer
  // tout le tableau de bord.
  const [virementsEnAttente, setVirementsEnAttente] = useState<number | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<AdminDashboardStats>("/admin/dashboard/stats")
      .then((res) => setStats(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
    Promise.resolve(api.get<unknown>("/admin/subscriptions/pending-bank-transfers"))
      .then((res) => setVirementsEnAttente(res?.data === undefined ? null : liste<unknown>(res.data).length))
      .catch(() => setVirementsEnAttente(null));
  }

  useEffect(load, []);

  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 p-6 text-red-700">
        <h3 className="mb-1 text-base font-bold">{t("admin.dashboard.errorTitle")}</h3>
        <p className="text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-4 cursor-pointer bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const { managers, trialsEndingSoon, mrr, usage } = stats;
  // La devise principale (la plus contributive) donne la vignette de tête ; les
  // autres sont listées dessous, sans jamais être additionnées à la première.
  // `?? []` n'est pas de la superstition : pendant un déploiement, un frontend
  // encore en cache peut recevoir l'ancienne charge utile (ou l'inverse). Une
  // page d'administration doit alors afficher « — », pas un écran blanc.
  const blocsDevises = mrr.byCurrency ?? [];
  const deviseCle = blocsDevises[0] ?? null;
  const autresDevises = blocsDevises.slice(1);

  // ── Ce qui attend l'administrateur : chaque ligne est un raccourci vers la page qui règle le sujet.
  const suspendus = managers.suspended ?? 0;
  const aTraiter = [
    virementsEnAttente ? { cle: "transfers", to: "/admin/virements", icone: Landmark, texte: t("admin.dashboard.todo.transfers", { count: virementsEnAttente }), urgent: true } : null,
    trialsEndingSoon.length > 0 ? { cle: "trials", to: "/admin/gestionnaires", icone: Clock3, texte: t("admin.dashboard.todo.trials", { count: trialsEndingSoon.length }), urgent: true } : null,
    managers.expired > 0 ? { cle: "expired", to: "/admin/gestionnaires", icone: Users, texte: t("admin.dashboard.todo.expired", { count: managers.expired }), urgent: false } : null,
    suspendus > 0 ? { cle: "suspended", to: "/admin/gestionnaires", icone: Users, texte: t("admin.dashboard.todo.suspended", { count: suspendus }), urgent: false } : null,
  ].filter((ligne) => ligne !== null);

  // ── Répartition des comptes : trois états qui se partagent le total (les résiliés, s'il y en a, forment le reste).
  const segments = [
    { cle: "ACTIVE", nombre: managers.subscriptionActive, barre: "bg-emerald-700" },
    { cle: "TRIAL", nombre: managers.trialActive, barre: "bg-ink-900" },
    { cle: "EXPIRED", nombre: managers.expired, barre: "bg-orange-700" },
  ];
  const autres = Math.max(0, managers.total - segments.reduce((somme, s) => somme + s.nombre, 0));
  if (autres > 0) segments.push({ cle: "OTHER", nombre: autres, barre: "bg-slate-400" });
  const tauxAbonnes = managers.total > 0 ? Math.round((managers.subscriptionActive / managers.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("admin.dashboard.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("admin.dashboard.subtitle")}</p>
      </div>

      {/* 01 — À traiter : le seul bloc qui demande une action, donc le premier. */}
      <Rubrique numero="01" titre={t("admin.dashboard.todo.title")} aide={t("admin.dashboard.todo.subtitle")}>
        {aTraiter.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t("admin.dashboard.todo.allClear")}
          </p>
        ) : (
          <ul className="grid gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2">
            {aTraiter.map(({ cle, to, icone: Icone, texte, urgent }) => (
              <li key={cle} className="bg-white">
                <Link
                  to={to}
                  className={`group flex items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 ${
                    urgent ? "shadow-[inset_4px_0_0_var(--color-orange-700)]" : "shadow-[inset_4px_0_0_var(--color-slate-300)]"
                  }`}
                >
                  <Icone size={16} aria-hidden="true" className={urgent ? "text-orange-700" : "text-slate-600"} />
                  <span className="min-w-0 flex-1">{texte}</span>
                  <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-orange-700" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Rubrique>

      {/* 02 — Les chiffres de la plateforme. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Users}
          label={t("admin.dashboard.stats.managers")}
          value={managers.total}
          hint={
            managers.suspended
              ? t("admin.dashboard.stats.managersHintSuspended", {
                  trial: managers.trialActive,
                  expired: managers.expired,
                  suspended: managers.suspended,
                })
              : t("admin.dashboard.stats.managersHint", { trial: managers.trialActive, expired: managers.expired })
          }
          accent="blue"
          to="/admin/gestionnaires"
        />
        <StatCard
          icon={CreditCard}
          label={t("admin.dashboard.stats.subscriptionActive")}
          value={managers.subscriptionActive}
          hint={t("admin.dashboard.stats.subscriptionActiveHint", { total: managers.total })}
          accent="green"
          progress={tauxAbonnes}
        />
        <StatCard
          icon={Wallet}
          label={t("admin.dashboard.stats.mrr")}
          value={deviseCle ? formatMoney(deviseCle.total, deviseCle.currency) : "—"}
          hint={
            autresDevises.length > 0
              ? autresDevises.map((d) => formatMoney(d.total, d.currency)).join(" · ")
              : t("admin.dashboard.stats.mrrHint", { count: mrr.contributors })
          }
          accent="green"
        />
        <StatCard
          icon={Building2}
          label={t("admin.dashboard.stats.properties")}
          value={usage.totalProperties}
          hint={t("admin.dashboard.stats.propertiesHint")}
          accent="blue"
        />
        <StatCard
          icon={Users}
          label={t("admin.dashboard.stats.tenants")}
          value={usage.totalTenants}
          hint={t("admin.dashboard.stats.tenantsHint")}
          accent="blue"
        />
        <StatCard
          icon={FileText}
          label={t("admin.dashboard.stats.activeContracts")}
          value={usage.activeContracts}
          hint={t("admin.dashboard.stats.activeContractsHint")}
          accent="blue"
        />
      </div>

      {/* 03 — Où en sont les comptes : un seul trait, trois états. */}
      <Rubrique numero="02" titre={t("admin.dashboard.pipeline.title")} aide={t("admin.dashboard.pipeline.conversion", { rate: tauxAbonnes })}>
        {managers.total === 0 ? (
          <p className="text-sm text-slate-600">{t("admin.dashboard.pipeline.empty")}</p>
        ) : (
          <>
            <div role="img" aria-label={t("admin.dashboard.pipeline.title")} className="flex h-3 w-full gap-px bg-slate-300">
              {segments
                .filter((s) => s.nombre > 0)
                .map((s) => (
                  <div key={s.cle} className={s.barre} style={{ width: `${(s.nombre / managers.total) * 100}%` }} />
                ))}
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {segments.map((s) => (
                <li key={s.cle} className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-800">
                  <span aria-hidden="true" className={`size-2.5 ${s.barre}`} />
                  {`${t(`admin.dashboard.pipeline.${s.cle}`)} · ${s.nombre}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </Rubrique>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Rubrique numero="03" titre={t("admin.dashboard.mrrByPlan.title")}>
          {mrr.contributors === 0 ? (
            <p className="py-10 text-center text-sm text-slate-600">{t("admin.dashboard.mrrByPlan.empty")}</p>
          ) : (
            <div className="space-y-6">
              {blocsDevises.map((bloc) => {
                // Les barres sont mises à l'échelle DANS chaque devise : une
                // barre FCFA et une barre euro ne sont pas comparables, et une
                // échelle commune ferait croire le contraire.
                const maxPlan = Math.max(1, ...PLAN_ORDER.map((plan) => bloc.byPlan[plan] ?? 0));
                const panierMoyen = bloc.contributors > 0 ? bloc.total / bloc.contributors : 0;
                return (
                  <div key={bloc.currency} className="space-y-4">
                    {blocsDevises.length > 1 && (
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-600">{bloc.currency}</p>
                    )}
                    {PLAN_ORDER.map((plan) => {
                      const amount = bloc.byPlan[plan] ?? 0;
                      const widthPct = Math.round((amount / maxPlan) * 100);
                      return (
                        <div key={plan}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-mono font-semibold uppercase tracking-wider text-slate-800">{plan}</span>
                            <span className="font-mono tabular-nums text-slate-700">{formatMoney(amount, bloc.currency)}</span>
                          </div>
                          <div className="h-2 bg-slate-100">
                            <div className="h-full bg-ink-900" style={{ width: amount > 0 ? `${Math.max(widthPct, 4)}%` : "0%" }} />
                          </div>
                        </div>
                      );
                    })}
                    {/* Ce que ces chiffres donnent à l'année, et ce que rapporte un compte payant en moyenne. */}
                    <dl className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 text-xs">
                      <div className="bg-slate-50 px-3 py-2">
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("admin.dashboard.mrrByPlan.arr")}</dt>
                        <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">{formatMoney(bloc.total * 12, bloc.currency)}</dd>
                      </div>
                      <div className="bg-slate-50 px-3 py-2">
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("admin.dashboard.mrrByPlan.average")}</dt>
                        <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">{formatMoney(panierMoyen, bloc.currency)}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          )}
        </Rubrique>

        <div className="lg:col-span-2">
          <Rubrique numero="04" titre={t("admin.dashboard.trialsEndingSoon.title")} aide={t("admin.dashboard.trialsEndingSoon.subtitle")}>
            {trialsEndingSoon.length === 0 ? (
              <EmptyState icon={Clock3} title={t("admin.dashboard.trialsEndingSoon.empty")} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2.5">{t("admin.dashboard.trialsEndingSoon.manager")}</th>
                      <th scope="col" className="px-3 py-2.5 text-right">{t("admin.dashboard.trialsEndingSoon.remaining")}</th>
                      <th scope="col" className="px-3 py-2.5"><span className="sr-only">{t("admin.dashboard.trialsEndingSoon.actions")}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {trialsEndingSoon.map((trial) => (
                      <tr key={trial.userId} className="text-slate-700">
                        <td className="px-3 py-3">
                          <Link to={`/admin/gestionnaires/${trial.userId}`} className="font-semibold text-ink-900 hover:text-orange-700">
                            {trial.agencyName ?? t("admin.dashboard.trialsEndingSoon.noAgencyName")}
                          </Link>
                          <p className="font-mono text-slate-600">{trial.email}</p>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className={`inline-flex items-center border px-2 py-1 font-mono text-[11px] font-semibold ${
                              trial.daysRemaining === 0 ? "border-rose-300 bg-rose-50 text-rose-800" : "border-amber-300 bg-amber-50 text-amber-900"
                            }`}
                          >
                            {trial.daysRemaining === 0
                              ? t("admin.dashboard.trialsEndingSoon.lastDay")
                              : t("admin.dashboard.trialsEndingSoon.daysLeft", { count: trial.daysRemaining })}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {/* Le geste attendu d'un essai qui se termine : écrire au gestionnaire. */}
                          <a
                            href={`mailto:${trial.email}`}
                            aria-label={t("admin.dashboard.trialsEndingSoon.contact", { email: trial.email })}
                            className="inline-flex size-8 items-center justify-center border border-slate-300 text-ink-900 hover:border-orange-700 hover:text-orange-700"
                          >
                            <Mail size={14} aria-hidden="true" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Rubrique>
        </div>
      </div>
    </div>
  );
}
