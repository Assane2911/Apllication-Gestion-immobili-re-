import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNouvelleVersion } from "../hooks/useNouvelleVersion";

/**
 * Bandeau « nouvelle version disponible » : une carte en bas de l'écran, au-dessus de tout, quand un déploiement a eu lieu
 * depuis le chargement de l'onglet. Ce n'est pas une barre en haut : elle passerait sous l'en-tête fixe des pages publiques.
 * L'actualisation n'est jamais automatique, elle ferait perdre une saisie en cours ; « Plus tard » masque la carte jusqu'au
 * prochain chargement de la page.
 */
export default function BandeauNouvelleVersion({ courante }: { courante?: string }) {
  const { t } = useTranslation();
  const { disponible, reporter } = useNouvelleVersion(courante);
  if (!disponible) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-[60] border border-ink-900 bg-ink-900 p-4 text-white shadow-[4px_4px_0_var(--color-orange-700)] sm:inset-x-auto sm:bottom-20 sm:right-4 sm:w-[28rem]"
    >
      <p className="text-sm">
        <RefreshCw size={14} aria-hidden="true" className="mr-2 inline align-[-2px] text-orange-300" />
        <strong className="font-semibold">{t("components.newVersion.title")}</strong>
      </p>
      <p className="mt-1 text-xs text-white/80">{t("components.newVersion.hint")}</p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer border border-white bg-white px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-orange-100"
        >
          {t("components.newVersion.refresh")}
        </button>
        <button type="button" onClick={reporter} className="cursor-pointer border-b border-white/50 text-xs font-semibold text-white hover:border-white">
          {t("components.newVersion.later")}
        </button>
      </div>
    </div>
  );
}
