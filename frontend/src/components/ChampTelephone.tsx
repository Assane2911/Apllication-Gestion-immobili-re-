import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Pays } from "../data/pays";
import { countryLabel } from "../utils/countries";
import { composer, decomposer, estE164Valide, PAYS_TELEPHONE } from "../utils/telephone";

interface Props {
  id: string;
  value: string;
  onChange: (valeur: string) => void;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Saisie d'un numéro de téléphone en deux parties : l'indicatif pays choisi
 * dans une liste, puis le numéro tel qu'on l'écrit sur place.
 *
 * Ce champ existe parce qu'un numéro sans indicatif ne sert à rien : l'API
 * WhatsApp n'accepte que le format international, et `versE164` côté serveur
 * refuse — à raison — de deviner le pays d'un « 0600000000 ». Le rappel
 * partait alors par email seul, sans que personne ne comprenne pourquoi. La
 * liste déplace ce choix au moment de la saisie, là où la réponse est connue.
 *
 * Deux partis pris :
 *
 *  - Ce qui sera enregistré s'affiche sous le champ, en toutes lettres. Un
 *    indicatif mal choisi ne se voit pas dans une fiche — il se découvre le
 *    jour où un inconnu reçoit un rappel de loyer. Le montrer avant
 *    l'enregistrement est le seul moment où l'erreur coûte encore zéro.
 *
 *  - Une valeur héritée qu'aucun indicatif ne permet de lire n'est jamais
 *    réparée d'office. On la laisse telle quelle et on demande le pays. Un
 *    préfixe supposé serait invisible et faux.
 */
export default function ChampTelephone({ id, value, onChange, required, disabled }: Props) {
  const { t, i18n } = useTranslation();
  const initial = decomposer(value);
  const [pays, setPays] = useState<Pays | null>(initial.pays);
  const [national, setNational] = useState(initial.national);

  // Ce que le champ a lui-même émis en dernier. Sans ce repère, la valeur qui
  // redescend du parent relancerait une décomposition à chaque frappe et
  // effacerait ce que l'utilisateur est en train d'écrire (un « 0 » de tête
  // retiré à la composition, par exemple, ne doit pas disparaître de l'écran).
  const derniereEmission = useRef<string | null>(null);

  useEffect(() => {
    if (value === derniereEmission.current) return;
    const relu = decomposer(value);
    setPays(relu.pays);
    setNational(relu.national);
  }, [value]);

  function emettre(nouveauPays: Pays | null, nouveauNational: string) {
    setPays(nouveauPays);
    setNational(nouveauNational);
    const compose = composer(nouveauPays, nouveauNational);
    derniereEmission.current = compose;
    onChange(compose);
  }

  const compose = composer(pays, national);
  const valide = estE164Valide(compose);

  return (
    <div>
      <div className="flex gap-2">
        <select
          aria-label={t("common.phoneField.countryLabel")}
          value={pays?.code ?? ""}
          disabled={disabled}
          onChange={(e) => emettre(PAYS_TELEPHONE.find((p) => p.code === e.target.value) ?? null, national)}
          className="w-40 shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-2 text-sm"
        >
          {!pays && <option value="">{t("common.phoneField.chooseCountry")}</option>}
          {PAYS_TELEPHONE.map((p) => (
            <option key={p.code} value={p.code}>
              {countryLabel(p.code, i18n.language)} +{p.indicatif}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          required={required}
          disabled={disabled}
          value={national}
          placeholder={pays?.exempleTelephone}
          onChange={(e) => emettre(pays, e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
        />
      </div>

      {!pays && national ? (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("common.phoneField.missingCountry")}</p>
      ) : compose ? (
        <p
          className={`mt-1 text-xs ${valide ? "text-slate-500 dark:text-slate-400" : "text-amber-600 dark:text-amber-400"}`}
        >
          {valide
            ? t("common.phoneField.willBeSaved", { numero: compose })
            : t("common.phoneField.incomplete", { numero: compose })}
        </p>
      ) : null}
    </div>
  );
}
