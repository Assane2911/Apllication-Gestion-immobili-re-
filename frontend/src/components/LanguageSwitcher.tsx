import { useTranslation } from "react-i18next";
import { changerLangue, SUPPORTED_LANGUAGES } from "../i18n";
import Bulle from "./Bulle";

interface LanguageSwitcherProps {
  className?: string;
  /** "dark" pour une intégration sur fond sombre (barres de navigation), "light" pour un fond clair (connexion, etc.). */
  variant?: "dark" | "light";
  /** Code court (« 🇫🇷 FR ») au lieu du nom de la langue : pour les barres où la place manque, sur téléphone. */
  compact?: boolean;
}

/** Sélecteur de langue (Français / English / Português / Español), persisté en
 * localStorage par i18next-browser-languagedetector. Applique aussi le sens
 * de lecture du document (LTR pour toutes ces langues) via i18n/index.ts. */
export default function LanguageSwitcher({ className = "", variant = "dark", compact = false }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();

  const darkClasses =
    "bg-slate-800/80 hover:bg-slate-800 text-slate-100 border-slate-700 focus:ring-brand-500";
  const lightClasses =
    "bg-white hover:bg-slate-50 text-slate-700 border-slate-300 focus:ring-brand-500";

  return (
    <div className={`relative inline-flex max-w-full items-center ${className}`}>
      <Bulle texte={t("common.language.selectAria")} className="inline-flex w-full min-w-0 max-w-full">
      <select
        value={i18n.resolvedLanguage || i18n.language}
        onChange={(e) => void changerLangue(e.target.value)}
        aria-label={t("common.language.selectAria")}
        className={`w-full min-w-0 max-w-full truncate text-xs font-semibold ${compact ? "px-1.5" : "px-2.5"} py-1.5 rounded-lg border focus:outline-hidden focus:ring-2 cursor-pointer shadow-sm transition-all ${
          variant === "dark" ? darkClasses : lightClasses
        }`}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
            {lang.flag} {compact ? lang.code.toUpperCase() : lang.label}
          </option>
        ))}
      </select>
      </Bulle>
    </div>
  );
}
