import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { forceMotDePasse } from "../utils/forceMotDePasse";

/** Couleur de chaque segment de l'indicateur, selon le niveau atteint. */
const COULEUR_FORCE = ["bg-slate-200", "bg-orange-700", "bg-orange-400", "bg-ink-900/70", "bg-ink-900"] as const;
const CRITERES = ["longueur", "casse", "chiffre", "symbole"] as const;
const CLES_TRADUCTION = { longueur: "length", casse: "case", chiffre: "digit", symbole: "symbol" } as const;

/**
 * Force d'un mot de passe en cours de saisie : quatre segments, le niveau en toutes lettres et les quatre critères cochés
 * au fil de la frappe. Une aide à la saisie, qui ne bloque rien (la longueur minimale est contrôlée par le formulaire).
 * N'affiche rien tant que le champ est vide.
 */
export default function IndicateurForce({ motDePasse }: { motDePasse: string }) {
  const { t } = useTranslation();
  const force = forceMotDePasse(motDePasse);
  if (force.niveau === 0) return null;

  return (
    <div className="mt-2.5">
      <div
        role="meter"
        aria-label={t("auth.register.strength.label")}
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={force.niveau}
        aria-valuetext={t(`auth.register.strength.level${force.niveau}`)}
        className="flex gap-1"
      >
        {[1, 2, 3, 4].map((segment) => (
          <span key={segment} className={`h-1.5 flex-1 ${segment <= force.niveau ? COULEUR_FORCE[force.niveau] : "bg-slate-200"}`} />
        ))}
      </div>
      <p aria-live="polite" className="mt-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800">
        {t(`auth.register.strength.level${force.niveau}`)}
      </p>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {CRITERES.map((cle) => (
          <li key={cle} className={`flex items-center gap-1.5 text-[11px] ${force.criteres[cle] ? "font-semibold text-ink-900" : "text-slate-600"}`}>
            {force.criteres[cle] ? <Check size={11} aria-hidden="true" /> : <Circle size={9} aria-hidden="true" />}
            {t(`auth.register.checks.${CLES_TRADUCTION[cle]}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
