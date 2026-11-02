import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/auth";
import { peutVoirLeGuide } from "../../utils/accesGuide";
import { basculerEtape, lireEtapesFaites, prochaineEtape } from "../../utils/syntheseCompte";

/**
 * Guide de démarrage : l'accompagnement à la prise en main annoncé sur la formule Agence & Multi-Comptes. Huit étapes dans
 * l'ordre où une agence nouvellement inscrite en a besoin ; chacune renvoie à la page qui la réalise
 * (les modèles de fichiers à remplir se téléchargent depuis la page d'import).
 *
 * Le gestionnaire coche les étapes qu'il a faites : la jauge et la « prochaine étape » en découlent. La liste cochée se
 * garde dans ce navigateur seulement (rien à synchroniser, rien de sensible) ; si le stockage est indisponible, la
 * coche vaut pour la visite en cours.
 */
const ETAPES = [
  { cle: "agency", vers: "/agency" },
  { cle: "import", vers: "/import" },
  { cle: "records", vers: "/properties" },
  { cle: "contract", vers: "/contracts" },
  { cle: "access", vers: "/tenants" },
  { cle: "invoices", vers: "/invoices" },
  { cle: "reminders", vers: "/agency" },
  { cle: "plan", vers: "/subscription" },
] as const;

const CLES = ETAPES.map((e) => e.cle);
const CLE_STOCKAGE = "immoplatform.guide.etapes";

function lireStockage(): string[] {
  try {
    return lireEtapesFaites(localStorage.getItem(CLE_STOCKAGE), CLES);
  } catch {
    return [];
  }
}

function ecrireStockage(faites: string[]) {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(faites));
  } catch {
    // Stockage indisponible : la coche reste valable pour cette visite.
  }
}

export default function GuidePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [faites, setFaites] = useState<string[]>(lireStockage);

  // Réservé à la formule Agence et aux essais gratuits (le menu ne le propose pas non plus aux autres) : un lien
  // enregistré ou saisi à la main ne doit pas ouvrir la page aux autres comptes.
  if (!peutVoirLeGuide(user)) return <Navigate to="/dashboard" replace />;

  function modifier(suivantes: string[]) {
    setFaites(suivantes);
    ecrireStockage(suivantes);
  }

  const prochaine = prochaineEtape(CLES, faites);
  const pourcent = Math.round((faites.length / ETAPES.length) * 100);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.guide.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.guide.subtitle")}</p>
      </div>

      <section aria-label={t("manager.guide.progress.label")} className="border border-slate-300 bg-white p-5 shadow-[inset_4px_0_0_var(--color-orange-700)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t("manager.guide.progress.count", { done: faites.length, total: ETAPES.length })}</p>
          {faites.length > 0 && (
            <button type="button" onClick={() => modifier([])} className="cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
              {t("manager.guide.progress.reset")}
            </button>
          )}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={ETAPES.length}
          aria-valuenow={faites.length}
          aria-label={t("manager.guide.progress.label")}
          className="mt-3 h-2 border border-slate-400 bg-white"
        >
          <div className={`h-full ${prochaine ? "bg-orange-700" : "bg-ink-900"}`} style={{ width: `${pourcent}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-700">
          {prochaine ? (
            <>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-700">{t("manager.guide.progress.next")}</span>
              {" · "}
              {t(`manager.guide.steps.${prochaine}.title`)}
            </>
          ) : (
            t("manager.guide.progress.allDone")
          )}
        </p>
      </section>

      <ol className="space-y-3">
        {ETAPES.map((etape, i) => {
          const faite = faites.includes(etape.cle);
          const courante = etape.cle === prochaine;
          return (
            <li
              key={etape.cle}
              aria-current={courante ? "step" : undefined}
              className={`flex gap-4 border bg-white p-4 ${courante ? "border-ink-900 shadow-[inset_4px_0_0_var(--color-orange-700)]" : "border-slate-300"} ${faite ? "bg-slate-50" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center border font-mono text-sm font-semibold ${
                  faite ? "border-ink-900 bg-ink-900 text-white" : courante ? "border-orange-700 bg-orange-700 text-white" : "border-slate-400 bg-white text-slate-700"
                }`}
              >
                {faite ? <Check size={15} strokeWidth={3} /> : String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={`font-semibold ${faite ? "text-slate-600 line-through decoration-slate-400" : "text-slate-900"}`}>{t(`manager.guide.steps.${etape.cle}.title`)}</h3>
                <p className="mt-1 text-sm text-slate-600">{t(`manager.guide.steps.${etape.cle}.desc`)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Link to={etape.vers} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-900 hover:text-orange-700">
                    {t("manager.guide.open")}
                    <span className="sr-only"> : {t(`manager.guide.steps.${etape.cle}.title`)}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    aria-pressed={faite}
                    onClick={() => modifier(basculerEtape(faites, etape.cle))}
                    className="cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                  >
                    {faite ? t("manager.guide.reopen") : t("manager.guide.markDone")}
                    <span className="sr-only"> : {t(`manager.guide.steps.${etape.cle}.title`)}</span>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
