import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, isRequestCancelled } from "../../api/client";
import BarreListe from "../../components/BarreListe";
import EmptyState from "../../components/EmptyState";
import { useCurrency } from "../../context/currency";
import type { EvenementAgenda, TypeEvenementAgenda } from "../../types";
import { comptesParType, grouperAgenda, LIEN_AGENDA, TYPES_AGENDA } from "../../utils/agenda";
import { ecartEnJours, formaterJour } from "../../utils/jourCivil";

const HORIZONS = [30, 90, 180, 366] as const;
const CHAMP_COMPACT = "border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900";
const LIEN = "inline-flex shrink-0 cursor-pointer items-center border border-slate-400 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:bg-slate-100";
const FILET: Record<TypeEvenementAgenda, string> = {
  RENT_DUE: "border-l-orange-700",
  LEASE_END: "border-l-ink-900",
  EXIT: "border-l-ink-900",
  RENT_REVISION: "border-l-slate-400",
  INSURANCE_EXPIRY: "border-l-orange-300",
};

/**
 * Agenda de l'agence : les dates qui appellent une action, réunies sur un seul écran. Ce qui est en retard
 * passe en tête ; le reste suit par mois et par jour, avec un lien vers l'écran où on le traite.
 */
export default function AgendaPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [evenements, setEvenements] = useState<EvenementAgenda[]>([]);
  const [jours, setJours] = useState<number>(90);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<"all" | TypeEvenementAgenda>("all");

  const charger = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      api
        .get<EvenementAgenda[]>("/agenda", { params: { days: jours }, signal })
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

  const groupe = grouperAgenda(evenements, filtre, recherche);
  const comptes = comptesParType(evenements, recherche);

  const relatif = (e: EvenementAgenda) => {
    const ecart = ecartEnJours(e.date);
    if (ecart === 0) return t("manager.agenda.relative.today");
    if (ecart === 1) return t("manager.agenda.relative.tomorrow");
    return ecart > 0 ? t("manager.agenda.relative.inDays", { count: ecart }) : t("manager.agenda.relative.lateDays", { count: -ecart });
  };

  const detail = (e: EvenementAgenda) => {
    if (e.type === "RENT_DUE" && e.amount !== null) return t("manager.agenda.detail.rentDue", { amount: formatMoney(e.amount, e.currency ?? undefined) });
    if (e.type === "RENT_REVISION" && e.amount !== null) return t("manager.agenda.detail.revision", { amount: formatMoney(e.amount, e.currency ?? undefined) });
    if (e.type === "INSURANCE_EXPIRY" && e.label) return t("manager.agenda.detail.insurer", { label: e.label });
    if (e.type === "EXIT" && e.label) return t("manager.agenda.detail.exitReason", { label: e.label });
    return null;
  };

  const ligne = (e: EvenementAgenda) => (
    <li key={e.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-l-4 bg-white p-3 ${FILET[e.type]}`}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t(`manager.agenda.types.${e.type}`)}</span>
          <span className="font-semibold text-slate-900">{e.propertyTitle}</span>
          {e.tenantName && <span className="text-slate-600">— {e.tenantName}</span>}
        </p>
        <p className="mt-0.5 text-xs text-slate-600">
          <span className={e.enRetard ? "font-semibold text-orange-800" : ""}>
            {formaterJour(e.date, i18n.language)} · {relatif(e)}
          </span>
          {detail(e) && <span> · {detail(e)}</span>}
        </p>
      </div>
      <Link to={LIEN_AGENDA[e.type]} className={LIEN}>
        {t("manager.agenda.open")}
      </Link>
    </li>
  );

  const libelleMois = (m: string) => formaterJour(`${m}-01T00:00:00.000Z`, i18n.language, { month: "long", year: "numeric" });
  const libelleJour = (j: string) => formaterJour(`${j}T00:00:00.000Z`, i18n.language, { weekday: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.agenda.title")}</h2>
          <p className="mt-1 text-xs text-slate-600">{t("manager.agenda.subtitle")}</p>
        </div>
        <div>
          <label htmlFor="agenda-horizon" className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            {t("manager.agenda.horizon")}
          </label>
          <select id="agenda-horizon" value={jours} onChange={(e) => setJours(Number(e.target.value))} className={CHAMP_COMPACT}>
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

      {!loading && evenements.length > 0 && (
        <>
          <BarreListe
            idPrefixe="agenda"
            recherche={recherche}
            onRecherche={setRecherche}
            placeholderRecherche={t("manager.agenda.search")}
            libelleFiltres={t("manager.agenda.filtersLabel")}
            filtres={[
              { cle: "all", libelle: t("manager.liste.all"), compte: TYPES_AGENDA.reduce((s, k) => s + comptes[k], 0) },
              ...TYPES_AGENDA.filter((k) => comptes[k] > 0 || filtre === k).map((k) => ({ cle: k, libelle: t(`manager.agenda.types.${k}`), compte: comptes[k] })),
            ]}
            filtreActif={filtre}
            onFiltre={(cle) => setFiltre(cle as "all" | TypeEvenementAgenda)}
          />
          <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {t("manager.agenda.count", { count: groupe.total })}
          </p>
        </>
      )}

      {loading && <p className="text-sm text-slate-600">{t("manager.agenda.loading")}</p>}

      {!loading && !loadError && evenements.length === 0 && (
        <EmptyState icon={CalendarDays} title={t("manager.agenda.emptyTitle")} description={t("manager.agenda.emptyDesc")} />
      )}

      {!loading && evenements.length > 0 && groupe.total === 0 && <p className="text-sm text-slate-600">{t("manager.agenda.noMatch")}</p>}

      {!loading && groupe.enRetard.length > 0 && (
        <section aria-labelledby="agenda-retard" className="space-y-2">
          <div>
            <h3 id="agenda-retard" className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-800">
              {t("manager.agenda.overdueTitle")} ({groupe.enRetard.length})
            </h3>
            <p className="text-xs text-slate-600">{t("manager.agenda.overdueHint")}</p>
          </div>
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
