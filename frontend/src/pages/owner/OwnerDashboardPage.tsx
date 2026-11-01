import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import SectionReglage from "../../components/SectionReglage";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { OwnerDashboard } from "../../types";
import { fenetreDesMois, libelleDuMois } from "../../utils/moisDuGraphique";

const ETIQUETTE = "font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";

/**
 * Résumé financier en lecture seule (Espace propriétaire) — même pattern de
 * chargement (load/état loading-erreur-vide-données) que TenantDashboardPage,
 * mais un contenu volontairement plus léger : le périmètre validé avec
 * l'utilisateur est "résumé financier seulement", pas un portail complet.
 */
export default function OwnerDashboardPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [data, setData] = useState<OwnerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<OwnerDashboard>("/owners/mine/dashboard")
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <p className="text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-4 cursor-pointer bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </div>
    );
  }

  const collectedCurrencies = Object.keys(data.collectedThisMonthByCurrency);
  const pendingCurrencies = Object.keys(data.pendingThisMonthByCurrency);
  // Toutes les devises en jeu ce mois-ci, pour le taux d'encaissement et la commission estimée.
  const devises = Array.from(new Set([...collectedCurrencies, ...pendingCurrencies])).sort();
  const moisAvecDonnees = Object.keys(data.revenueByMonth);
  const fenetre = fenetreDesMois(new Date(), moisAvecDonnees);
  const devisesHistorique = Array.from(new Set(moisAvecDonnees.flatMap((m) => Object.keys(data.revenueByMonth[m])))).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("owner.dashboard.title")}</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">{t("owner.dashboard.subtitle")}</p>
        </div>
        <Link
          to="/proprietaire/crg"
          className="group inline-flex items-center gap-2 border border-ink-900 bg-white px-4 py-2.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
        >
          {t("owner.dashboard.openCrg")}
          <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* 01 — Le mois en cours : ce qui est arrivé, ce qui reste à arriver, et la part déjà encaissée. */}
      <SectionReglage id="ce-mois" numero="01" titre={t("owner.dashboard.thisMonth")}>
        <dl className="grid grid-cols-1 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2">
          <div className="bg-white p-5">
            <dt className={ETIQUETTE}>{t("owner.dashboard.collectedThisMonth")}</dt>
            <dd className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {collectedCurrencies.length === 0 ? (
                <span className="text-xl font-bold tabular-nums text-slate-500">{formatMoney(0)}</span>
              ) : (
                collectedCurrencies.map((currency) => (
                  <span key={currency} className="text-xl font-bold tabular-nums text-ink-900">
                    {formatMoney(data.collectedThisMonthByCurrency[currency], currency)}
                  </span>
                ))
              )}
            </dd>
          </div>
          <div className="bg-white p-5">
            <dt className={ETIQUETTE}>{t("owner.dashboard.pendingThisMonth")}</dt>
            <dd className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {pendingCurrencies.length === 0 ? (
                <span className="text-xl font-bold tabular-nums text-slate-500">{formatMoney(0)}</span>
              ) : (
                pendingCurrencies.map((currency) => (
                  <span key={currency} className="text-xl font-bold tabular-nums text-orange-700">
                    {formatMoney(data.pendingThisMonthByCurrency[currency], currency)}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>

        {/* Taux d'encaissement et commission estimée, devise par devise : on n'additionne jamais des monnaies différentes. */}
        {devises.length > 0 && (
          <ul className="mt-5 space-y-4">
            {devises.map((currency) => {
              const percu = data.collectedThisMonthByCurrency[currency] ?? 0;
              const attente = data.pendingThisMonthByCurrency[currency] ?? 0;
              const total = percu + attente;
              const taux = total > 0 ? Math.round((percu / total) * 100) : 0;
              const commission = (percu * data.managementFeeRate) / 100;
              return (
                <li key={currency}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800">
                      {devises.length > 1 ? `${currency} · ` : ""}
                      {t("owner.dashboard.collectionRate", { pct: taux })}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-slate-600">
                      {`${t("owner.dashboard.estimatedFee")} · ${formatMoney(commission, currency)}`}
                    </p>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={t("owner.dashboard.collectionRateLabel", { currency })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={taux}
                    className="mt-1.5 h-2 bg-slate-200"
                  >
                    <div className="h-full bg-ink-900" style={{ width: `${taux}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-slate-300 pt-4">
          <span className="text-xs text-slate-600">{t("owner.dashboard.managementFeeRate")}</span>
          <span className="font-mono text-sm font-bold text-ink-900">{data.managementFeeRate}%</span>
        </div>
      </SectionReglage>

      {/* 02 — Les six derniers mois, une série par devise. */}
      <SectionReglage id="historique" numero="02" titre={t("owner.dashboard.historyTitle")}>
        {moisAvecDonnees.length === 0 ? (
          <p className="text-xs text-slate-600">{t("owner.dashboard.noHistory")}</p>
        ) : (
          <div className="space-y-6">
            {devisesHistorique.map((currency) => {
              const valeurs = fenetre.map((m) => data.revenueByMonth[m]?.[currency] ?? 0);
              const maximum = Math.max(...valeurs, 1);
              const moyenne = valeurs.reduce((somme, v) => somme + v, 0) / valeurs.length;
              const meilleur = valeurs.indexOf(Math.max(...valeurs));
              const dernier = valeurs[valeurs.length - 1];
              const precedent = valeurs[valeurs.length - 2] ?? 0;
              const variation = precedent > 0 ? Math.round(((dernier - precedent) / precedent) * 100) : null;
              return (
                <div key={currency}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800">
                      {devisesHistorique.length > 1 ? currency : t("owner.dashboard.revenueLabel")}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-slate-600">
                      {`${t("owner.dashboard.monthlyAverage")} · ${formatMoney(moyenne, currency)}`}
                      {variation !== null && ` · ${t("owner.dashboard.vsPrevious")} ${variation > 0 ? "+" : ""}${variation} %`}
                    </p>
                  </div>
                  <ul className="divide-y divide-slate-200 border border-slate-300">
                    {fenetre.map((mois, i) => (
                      <li key={mois} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                        <span className="w-24 shrink-0 text-xs font-medium capitalize text-slate-700">{libelleDuMois(mois, i18n.language)}</span>
                        <div aria-hidden="true" className="h-2.5 min-w-24 flex-1 bg-slate-100">
                          <div className={`h-full ${i === meilleur && valeurs[i] > 0 ? "bg-orange-700" : "bg-ink-900"}`} style={{ width: `${(valeurs[i] / maximum) * 100}%` }} />
                        </div>
                        <span className="w-32 shrink-0 text-right text-xs font-bold tabular-nums text-slate-900">{formatMoney(valeurs[i], currency)}</span>
                        {i === meilleur && valeurs[i] > 0 && (
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-700">{t("owner.dashboard.bestMonth")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </SectionReglage>

      {/* 03 — Bien par bien : ce qui est perçu, ce qui attend, et le poids de chaque bien. */}
      <SectionReglage id="biens" numero="03" titre={t("owner.dashboard.propertiesTitle")}>
        {data.properties.length === 0 ? (
          <p className="text-xs text-slate-600">{t("owner.dashboard.noProperties")}</p>
        ) : (
          <div className="relative overflow-x-auto border border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="px-4 py-3 font-semibold">{t("owner.dashboard.property")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("owner.dashboard.collected")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("owner.dashboard.pending")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("owner.dashboard.share")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.properties.map((p) => {
                  // Part du bien dans les loyers perçus de SA devise (jamais comparée à une autre monnaie).
                  const totalDevise = data.properties.filter((q) => q.currency === p.currency).reduce((somme, q) => somme + q.collected, 0);
                  const part = totalDevise > 0 ? Math.round((p.collected / totalDevise) * 100) : 0;
                  return (
                    <tr key={`${p.propertyId}-${p.currency}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{p.title}</p>
                        <p className="text-xs text-slate-600">{p.address}</p>
                      </td>
                      <td className="px-4 py-3 font-bold tabular-nums text-ink-900">{formatMoney(p.collected, p.currency)}</td>
                      <td className="px-4 py-3 font-bold tabular-nums text-orange-700">{formatMoney(p.pending, p.currency)}</td>
                      <td className="w-40 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div aria-hidden="true" className="h-1.5 flex-1 bg-slate-200">
                            <div className="h-full bg-ink-900" style={{ width: `${part}%` }} />
                          </div>
                          <span className="w-10 text-right font-mono text-[11px] tabular-nums text-slate-700">{`${part} %`}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionReglage>
    </div>
  );
}
