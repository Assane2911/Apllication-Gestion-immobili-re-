import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../context/theme";
import LanguageSwitcher from "./LanguageSwitcher";

/** Bouton clair/sombre : le choix est mémorisé par navigateur (voir ThemeContext). */
export default function BoutonTheme({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t("common.theme.toggleAria")}
      title={theme === "dark" ? t("common.theme.toLight") : t("common.theme.toDark")}
      className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${className}`}
    >
      {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
    </button>
  );
}

/** Langue + thème, côte à côte : l'angle haut droit des pages publiques (connexion, inscription…). */
export function LangueEtTheme() {
  const { theme } = useTheme();
  return (
    <div className="flex items-center gap-2">
      <LanguageSwitcher variant={theme === "dark" ? "dark" : "light"} />
      <BoutonTheme />
    </div>
  );
}
