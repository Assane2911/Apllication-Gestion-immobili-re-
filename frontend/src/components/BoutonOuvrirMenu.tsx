import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { libellePastille } from "../utils/nonLus";

/**
 * Bouton qui ouvre le tiroir de navigation sur téléphone. Tant que le tiroir est fermé, les pastilles de ses entrées
 * (messages non lus, échéances en retard) sont cachées avec lui : ce bouton en reprend le total, pour qu'on voie qu'il y
 * a quelque chose à traiter sans l'ouvrir. Le détail par entrée reste dans le tiroir.
 */
export default function BoutonOuvrirMenu({ onClick, enAttente = 0, className }: { onClick: () => void; enAttente?: number; className: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative ${className}`}
      aria-label={enAttente > 0 ? t("components.managerLayout.openMenuPending", { count: enAttente }) : t("components.managerLayout.openMenuAria")}
    >
      <Menu size={18} aria-hidden="true" />
      {enAttente > 0 && (
        <span
          aria-hidden="true"
          data-testid="pastille-bouton-menu"
          className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center bg-orange-700 px-1 font-mono text-[10px] font-semibold leading-none text-white"
        >
          {libellePastille(enAttente)}
        </span>
      )}
    </button>
  );
}
