import type { ReactNode } from "react";
import { useDialogue } from "../hooks/useDialogue";

/**
 * Panneau de fenêtre modale (voir `useDialogue`) pour les fenêtres rendues conditionnellement dans un composant
 * plus grand, où le hook ne peut pas être appelé : le panneau n'existe — et le comportement clavier n'est actif —
 * que tant que la fenêtre est ouverte.
 */
export default function Dialogue({
  onClose,
  titreId,
  libelle,
  fermable,
  className,
  children,
}: {
  onClose: () => void;
  titreId?: string;
  libelle?: string;
  fermable?: boolean;
  className: string;
  children: ReactNode;
}) {
  const dialogue = useDialogue({ onClose, titreId, libelle, fermable });
  return (
    <div {...dialogue} className={className}>
      {children}
    </div>
  );
}
