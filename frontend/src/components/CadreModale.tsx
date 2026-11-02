import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDialogue } from "../hooks/useDialogue";

const LARGEURS = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" } as const;

/**
 * Cadre commun des fenêtres modales : fond voilé, panneau à angles droits cerclé d'encre, bandeau de titre plein
 * (rouge pour une action destructive), puis le contenu. Le comportement clavier et l'accessibilité viennent de
 * `useDialogue` : rôle `dialog` nommé par le titre, focus piégé, Échap et clic sur le fond bloqués tant que
 * `fermable` est faux (enregistrement en cours).
 */
export default function CadreModale({
  titre,
  titreId,
  sousTitre,
  onClose,
  fermable = true,
  largeur = "md",
  danger = false,
  boutonFermer = true,
  children,
}: {
  titre: ReactNode;
  titreId: string;
  sousTitre?: ReactNode;
  onClose: () => void;
  fermable?: boolean;
  largeur?: keyof typeof LARGEURS;
  danger?: boolean;
  /** Faux : pas de croix (étape qu'on ne doit pas quitter sans l'avoir lue, comme les codes de secours). */
  boutonFermer?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialogue = useDialogue({ onClose, titreId, fermable });
  const teinte = danger ? "border-rose-700 bg-rose-700" : "border-ink-900 bg-ink-900";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div {...dialogue} className={`max-h-[90vh] w-full ${LARGEURS[largeur]} overflow-y-auto border-2 bg-white ${danger ? "border-rose-700" : "border-ink-900"}`}>
        <header className={`flex items-start justify-between gap-3 border-b px-6 py-4 text-white ${teinte}`}>
          <div className="min-w-0">
            <h3 id={titreId} className="text-lg font-bold leading-snug">
              {titre}
            </h3>
            {sousTitre && <p className="mt-0.5 text-xs text-white/85">{sousTitre}</p>}
          </div>
          {boutonFermer && (
            <button type="button" onClick={onClose} disabled={!fermable} aria-label={t("common.actions.close")} className="shrink-0 cursor-pointer p-1 text-white/80 hover:text-white disabled:opacity-50">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
