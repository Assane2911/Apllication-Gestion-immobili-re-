import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DialogueDeconnexion from "../components/DialogueDeconnexion";
import { useAuth } from "../context/auth";

/**
 * Déconnexion avec confirmation, suivie d'un message de confirmation sur la page de connexion. `demanderDeconnexion` ouvre la fenêtre ; `dialogue` est la fenêtre à afficher (ou
 * `null`). Elle est à rendre HORS d'un en-tête ou d'un menu qui porte un filtre ou une transformation : un
 * élément en `position: fixed` s'y positionnerait par rapport à ce parent et non à l'écran.
 */
export function useConfirmationDeconnexion() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [ouverte, setOuverte] = useState(false);

  const dialogue = ouverte ? (
    <DialogueDeconnexion
      onAnnuler={() => setOuverte(false)}
      onConfirmer={() => {
        setOuverte(false);
        // La session est fermée avant d'aller sur la page de connexion, qui confirme la déconnexion (?deconnecte=1,
        // comme ?inactif=1 pour l'inactivité).
        void logout().then(() => navigate("/login?deconnecte=1", { replace: true }));
      }}
    />
  ) : null;

  return { demanderDeconnexion: () => setOuverte(true), dialogue };
}
