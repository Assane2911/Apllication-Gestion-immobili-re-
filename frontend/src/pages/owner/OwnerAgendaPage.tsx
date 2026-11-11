import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import type { EvenementAgenda, TypeEvenementAgenda } from "../../types";
import { grouperAgenda } from "../../utils/agenda";
import { ecartEnJours, formaterJour } from "../../utils/jourCivil";

const HORIZONS = [30, 90, 180, 366] as const;
const CHAMP_COMPACT = "border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900";
const FILET: Partial<Record<TypeEvenementAgenda, string>> = {
  LEASE_END: "border-l-ink-900",
  EXIT: "border-l-ink-900",
  INSURANCE_EXPIRY: "border-l-orange-300",
};

/**
 * Agenda de l'espace propriétaire : les échéances de SES biens (fins de bail, départs annoncés, assurances), en lecture seule.
 * Le serveur n'envoie aucune donnée des locataires ; c'est l'agence qui traite, la page informe. Mêmes regroupements que
 * l'agenda de l'agence : ce qui est dépassé en tête, puis par mois et par jour.
 */
export default function OwnerAgendaPage() {
  const { t, i18n } = useTranslation();
  const [evenements, setEvenements] = useState<EvenementAgenda[]>([]);
  const [jours, setJours] = useState<number>(180);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const charger = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      api
        .get<EvenementAgenda[]>("/owners/mine/agenda", { params: { days: jours }, signal })
        .then((res) => {
          setEvenements(res.data);
          setLoadError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (isRequestCancelled(err)) return;
          setLoadError(apiErrorMessage(err));
          setLoading(false);
        });
    },
    [jours]
  );

  useEffect(() => {
    const controller = new AbortController();
    charger(controller.signal);
    return () => controller.abort();
  }, [charger]);

  const groupe = grouperAgenda(evenements, "all", "");

  const relatif = (e: EvenementAgenda) => {
    const ecart = ecartEnJours(e.date);
    if (ecart === 0) return t("manager.agenda.relative.today");
    if (ecart === 1) return t("manager.agenda.relative.tomorrow");
    return ecart > 0 ? t("manager.agenda.relative.inDays", { count: ecart }) : t("manager.agenda.relative.lateDays", { count: -ecart });
  };

  const ligne = (e: EvenementAgenda) => (
    <li key={e.id} className={`border-l-4 bg-white p-3 ${FILET[e.type] ?? "border-l-slate-400"}`}>
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t(`manager.agenda.types.${e.type}`)}</span>
        {e.propertyTitle && <span className="font-semibold text-slate-900">{e.propertyTitle}</span>}
      </p>
      <p className="mt-0.5 text-xs text-slate-600">
        <span className={e.enRetard ? "font-semibold text-orange-800" : ""}>
          {formaterJour(e.date, i18n.language)} · {relatif(e)}
        </span>
        {e.type === "INSURANCE_EXPIRY" && e.label && <span> · {t("manager.agenda.detail.insurer", { label: e.label })}</span>}
      </p>
    </li>
  );

  const libelleMois = (m: string) => formaterJour(`${m}-01T00:00:00.000Z`, i18n.language, { month: "long", year: "numeric" });
  const libelleJour = (j: string) => formaterJour(`${j}T00:00:00.000Z`, i18n.language, { weekday: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold text-slate-900">{t("owner.agenda.title")}</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-600">{t("owner.agenda.subtitle")}</p>
        </div>
        <div>
          <label htmlFor="owner-agenda-horizon" className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            {t("manager.agenda.horizon")}
          </label>
          <select id="owner-agenda-horizon" value={jours} onChange={(e) => setJours(Number(e.target.value))} className={CHAMP_COMPACT}>
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {t(`manager.agenda.horizons.d${h}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => charger()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {loading && <p className="text-sm text-slate-600">{t("owner.agenda.loading")}</p>}

      {!loading && !loadError && evenements.length === 0 && (
        <EmptyState icon={CalendarDays} title={t("owner.agenda.emptyTitle")} description={t("owner.agenda.emptyDesc")} />
      )}

      {!loading && evenements.length > 0 && (
        <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
          {t("owner.agenda.count", { count: groupe.total })}
        </p>
      )}

      {!loading && groupe.enRetard.length > 0 && (
        <section aria-labelledby="owner-agenda-retard" className="space-y-2">
          <h3 id="owner-agenda-retard" className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-800">
            {t("manager.agenda.overdueTitle")} ({groupe.enRetard.length})
          </h3>
          <ul className="space-y-1.5">{groupe.enRetard.map(ligne)}</ul>
        </section>
      )}

      {!loading &&
        groupe.parMois.map((m) => (
          <section key={m.mois} aria-label={libelleMois(m.mois)} className="space-y-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900">{libelleMois(m.mois)}</h3>
            {m.jours.map((j) => (
              <div key={j.jour} className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr]">
                <p className="text-xs font-semibold capitalize text-slate-700 sm:pt-3">{libelleJour(j.jour)}</p>
                <ul className="space-y-1.5">{j.evenements.map(ligne)}</ul>
              </div>
            ))}
          </section>
        ))}
    </div>
  );
}
