import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/auth";
import { peutVoirLeGuide } from "../../utils/accesGuide";

/**
 * Guide de démarrage : l'accompagnement à la prise en main annoncé sur la formule Agence & Multi-Comptes. Huit étapes dans
 * l'ordre où une agence nouvellement inscrite en a besoin ; chacune renvoie à la page qui la réalise
 * (les modèles de fichiers à remplir se téléchargent depuis la page d'import).
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

export default function GuidePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Réservé à la formule Agence et aux essais gratuits (le menu ne le propose pas non plus aux autres) : un lien
  // enregistré ou saisi à la main ne doit pas ouvrir la page aux autres comptes.
  if (!peutVoirLeGuide(user)) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.guide.title")}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t("manager.guide.subtitle")}</p>
      </div>

      <ol className="space-y-3">
        {ETAPES.map((etape, i) => (
          <li
            key={etape.cle}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex gap-4"
          >
            <span
              aria-hidden="true"
              className="shrink-0 w-8 h-8 rounded-full bg-brand-600 text-white text-sm font-semibold flex items-center justify-center"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t(`manager.guide.steps.${etape.cle}.title`)}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t(`manager.guide.steps.${etape.cle}.desc`)}</p>
              <Link
                to={etape.vers}
                className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline"
              >
                {t("manager.guide.open")}
                <span className="sr-only"> : {t(`manager.guide.steps.${etape.cle}.title`)}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
