import { useState } from "react";
import DialogueDeconnexion from "../components/DialogueDeconnexion";
import { useAuth } from "../context/auth";

/**
 * Déconnexion avec confirmation. `demanderDeconnexion` ouvre la fenêtre ; `dialogue` est la fenêtre à afficher (ou
 * `null`). Elle est à rendre HORS d'un en-tête ou d'un menu qui porte un filtre ou une transformation : un
 * élément en `position: fixed` s'y positionnerait par rapport à ce parent et non à l'écran.
 */
export function useConfirmationDeconnexion() {
  const { logout } = useAuth();
  const [ouverte, setOuverte] = useState(false);

  const dialogue = ouverte ? (
    <DialogueDeconnexion
      onAnnuler={() => setOuverte(false)}
      onConfirmer={() => {
        setOuverte(false);
        void logout();
      }}
    />
  ) : null;

  return { demanderDeconnexion: () => setOuverte(true), dialogue };
}
