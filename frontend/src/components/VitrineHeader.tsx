import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Logo from "./Logo";
import BoutonsHistorique from "./BoutonsHistorique";
import LanguageSwitcher from "./LanguageSwitcher";

/** En-tête commun aux pages de la vitrine publique (liste des annonces et fiche détail). */
export default function VitrineHeader() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xs border-b border-contour-200 dark:border-slate-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-16 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <BoutonsHistorique />
          <Link to="/landing" className="flex items-center gap-2.5 min-w-0">
            <Logo taille={32} />
            <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{t("vitrine.brand")}</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link to="/login" className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap">
            {t("vitrine.managerLogin")}
          </Link>
        </div>
      </div>
    </header>
  );
}
