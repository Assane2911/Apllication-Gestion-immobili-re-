import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Logo from "./Logo";
import BoutonsHistorique from "./BoutonsHistorique";
import LanguageSwitcher from "./LanguageSwitcher";

/** En-tête commun aux pages de la vitrine publique (liste des annonces et fiche détail). */
export default function VitrineHeader() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-20 border-b-2 border-ink-900 bg-white">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <BoutonsHistorique />
          <Link to="/landing" className="flex min-w-0 items-center gap-2.5">
            <Logo taille={32} />
            <span className="truncate font-mono text-sm font-semibold uppercase tracking-wider text-ink-900">{t("vitrine.brand")}</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            to="/login"
            className="whitespace-nowrap border border-ink-900 px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
          >
            {t("vitrine.managerLogin")}
          </Link>
        </div>
      </div>
    </header>
  );
}
