import { useTranslation } from "react-i18next";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { changerLangue, SUPPORTED_LANGUAGES } from "../i18n";
import { cheminDansLaLangue, estPageTraduite } from "../utils/langueUrl";
import Bulle from "./Bulle";

interface LanguageSwitcherProps {
  className?: string;
  /** Code court (« 🇫🇷 FR ») au lieu du nom de la langue : pour les barres où la place manque, sur téléphone. */
  compact?: boolean;
}

/** Sélecteur de langue (Français / English / Português / Español), persisté en
 * localStorage par i18next-browser-languagedetector. Applique aussi le sens
 * de lecture du document (LTR pour toutes ces langues) via i18n/index.ts. */
export default function LanguageSwitcher(props: LanguageSwitcherProps) {
  // Hors d'un routeur (certains tests, composants isolés), pas d'adresse à suivre.
  return useInRouterContext() ? <SelecteurAvecAdresse {...props} /> : <Selecteur {...props} />;
}

/** Sur une page qui existe dans chaque langue (accueil, vitrine), changer de langue change aussi l'adresse : « /vitrine » → « /en/vitrine ». */
function SelecteurAvecAdresse(props: LanguageSwitcherProps) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  return (
    <Selecteur
      {...props}
      apresChangement={(code) => {
        if (!estPageTraduite(pathname)) return;
        const cible = cheminDansLaLangue(pathname, code);
        if (cible !== pathname) navigate(`${cible}${search}${hash}`);
      }}
    />
  );
}

function Selecteur({ className = "", compact = false, apresChangement }: LanguageSwitcherProps & { apresChangement?: (code: string) => void }) {
  const { i18n, t } = useTranslation();

  const apparence = "bg-white hover:bg-slate-50 text-slate-700 border-slate-300 focus:ring-brand-500";

  return (
    <div className={`relative inline-flex max-w-full items-center ${className}`}>
      <Bulle texte={t("common.language.selectAria")} className="inline-flex w-full min-w-0 max-w-full">
      <select
        value={i18n.resolvedLanguage || i18n.language}
        onChange={(e) => {
          const code = e.target.value;
          void changerLangue(code).then(() => apresChangement?.(code));
        }}
        aria-label={t("common.language.selectAria")}
        className={`w-full min-w-0 max-w-full truncate text-xs font-semibold ${compact ? "px-1.5" : "px-2.5"} py-1.5 border focus:outline-hidden focus:ring-2 cursor-pointer transition-all ${apparence}`}
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
