import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { calendrierRelances, RETARD_MAX_RELANCE_JOURS } from "../utils/relances";

/**
 * Simulateur des relances automatiques de l'accueil : le visiteur règle le délai de grâce et l'intervalle, comme dans
 * les paramètres d'une agence, et voit à quels jours de retard partent les trois relances. Même règle de calcul que
 * le serveur (`calendrierRelances`) ; rien n'est enregistré ni envoyé.
 */
export default function SimulateurRelances() {
  const { t } = useTranslation();
  const [grace, setGrace] = useState(5);
  const [intervalle, setIntervalle] = useState(10);
  const { first, second, third } = calendrierRelances(grace, intervalle);

  const etapes = [
    { cle: "due", jour: 0, plein: false },
    { cle: "first", jour: first, plein: true },
    { cle: "second", jour: second, plein: true },
    { cle: "third", jour: third, plein: true },
    { cle: "end", jour: RETARD_MAX_RELANCE_JOURS, plein: false },
  ] as const;

  const CURSEUR = "mt-2 h-2 w-full cursor-pointer accent-orange-700";
  const ETIQUETTE = "flex items-baseline justify-between gap-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800";

  return (
    <section aria-labelledby="simulateur-titre" className="mt-12 border-2 border-ink-900 bg-white">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-ink-900 bg-ink-900 px-5 py-3 text-white">
        <h3 id="simulateur-titre" className="font-mono text-xs font-semibold uppercase tracking-wider">
          {t("landing.reminders.title")}
        </h3>
        <p className="text-xs text-white/85">{t("landing.reminders.subtitle")}</p>
      </header>

      <div className="grid gap-8 p-6 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-6">
          <div>
            <label htmlFor="simulateur-grace" className={ETIQUETTE}>
              <span>{t("landing.reminders.grace")}</span>
              <span aria-hidden="true" className="text-orange-700">
                {t("landing.reminders.days", { count: grace })}
              </span>
            </label>
            <input
              id="simulateur-grace"
              type="range"
              min={1}
              max={30}
              step={1}
              value={grace}
              onChange={(e) => setGrace(Number(e.target.value))}
              aria-valuetext={t("landing.reminders.days", { count: grace })}
              className={CURSEUR}
            />
          </div>
          <div>
            <label htmlFor="simulateur-intervalle" className={ETIQUETTE}>
              <span>{t("landing.reminders.interval")}</span>
              <span aria-hidden="true" className="text-orange-700">
                {t("landing.reminders.days", { count: intervalle })}
              </span>
            </label>
            <input
              id="simulateur-intervalle"
              type="range"
              min={3}
              max={30}
              step={1}
              value={intervalle}
              onChange={(e) => setIntervalle(Number(e.target.value))}
              aria-valuetext={t("landing.reminders.days", { count: intervalle })}
              className={CURSEUR}
            />
          </div>
          <Link
            to="/inscription"
            className="inline-block border border-ink-900 bg-ink-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
          >
            {t("landing.reminders.cta")}
          </Link>
        </div>

        <div>
          <ol aria-label={t("landing.reminders.timeline")} className="space-y-3">
            {etapes.map((etape) => (
              <li key={etape.cle} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                <span className="font-mono text-sm font-bold tabular-nums text-ink-900">{t("landing.reminders.day", { day: etape.jour })}</span>
                <div>
                  <p className="text-xs font-semibold text-slate-900">{t(`landing.reminders.steps.${etape.cle}`)}</p>
                  <div aria-hidden="true" className="mt-1 h-2 border border-slate-400 bg-white">
                    <div
                      className={`h-full ${etape.plein ? "bg-orange-700" : "bg-slate-400"}`}
                      style={{ width: `${Math.max(2, Math.round((etape.jour / RETARD_MAX_RELANCE_JOURS) * 100))}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p aria-live="polite" data-testid="resume-relances" className="mt-5 border-l-2 border-orange-700 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
            {t("landing.reminders.summary", { first, second, third })}
          </p>
          <p className="mt-3 text-xs text-slate-700">{t("landing.reminders.note")}</p>
        </div>
      </div>
    </section>
  );
}
