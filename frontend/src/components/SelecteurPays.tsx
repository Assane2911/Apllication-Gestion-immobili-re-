import { useTranslation } from "react-i18next";
import { SUPPORTED_COUNTRY_CODES, countryLabel } from "../utils/countries";

interface SelecteurPaysProps {
  id: string;
  value: string;
  onChange: (code: string) => void;
  /** Texte de l'option vide, qui n'est pas un pays : la personne doit en choisir un. */
  placeholder: string;
  /** Mise en forme du `<select>` : l'inscription est sur fond sombre, le choix du pays sur fond clair. */
  className?: string;
}

/**
 * Sélecteur du pays de l'agence : la France et les huit pays de l'UEMOA (voir data/pays.ts), nommés dans la langue de
 * l'interface. Partagé par l'inscription et par le choix du pays d'un compte qui n'en a pas encore.
 *
 * Pas d'attribut `required` : chaque page vérifie le choix et l'explique dans sa langue, au lieu de la bulle du
 * navigateur ; `aria-required` le signale aux lecteurs d'écran.
 */
export default function SelecteurPays({ id, value, onChange, placeholder, className }: SelecteurPaysProps) {
  const { i18n } = useTranslation();

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-required="true" className={className}>
      <option value="">{placeholder}</option>
      {SUPPORTED_COUNTRY_CODES.map((code) => (
        <option key={code} value={code}>
          {countryLabel(code, i18n.language)}
        </option>
      ))}
    </select>
  );
}
