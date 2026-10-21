import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { traiterRetourSurCouche } from "../utils/couchesRetour";
import { useDialogue } from "./useDialogue";

/**
 * Une fenêtre modale qui ne se ferme pas avec Échap, qui laisse le focus derrière elle et où Tab sort vers la page
 * cachée est inutilisable au clavier — et pour un lecteur d'écran, faute de `role="dialog"`, ce n'est même pas une
 * fenêtre. Ce hook donne aux modales de l'application ce comportement commun.
 */
function Modale({ onClose, fermable = true }: { onClose: () => void; fermable?: boolean }) {
  const dialogue = useDialogue({ onClose, titreId: "titre-test", fermable });
  return (
    <div {...dialogue}>
      <h3 id="titre-test">Titre de la fenêtre</h3>
      <button type="button">Fermer</button>
      <input aria-label="Nom" />
      <button type="button">Valider</button>
    </div>
  );
}

function ModaleAvecChoixParDefaut() {
  const dialogue = useDialogue({ onClose: () => {}, titreId: "titre-choix" });
  return (
    <div {...dialogue}>
      <h3 id="titre-choix">Session</h3>
      <button type="button">Se déconnecter</button>
      <button type="button" data-autofocus>
        Rester connecté
      </button>
    </div>
  );
}

function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOuvert(true)}>
        Ouvrir
      </button>
      {ouvert && (
        <Modale
          onClose={() => {
            onClose();
            setOuvert(false);
          }}
        />
      )}
    </div>
  );
}

describe("useDialogue", () => {
  it("déclare une fenêtre modale nommée par son titre, pour les lecteurs d'écran", () => {
    render(<Modale onClose={() => {}} />);

    const fenetre = screen.getByRole("dialog", { name: "Titre de la fenêtre" });
    expect(fenetre).toHaveAttribute("aria-modal", "true");
  });

  it("met le focus dans la fenêtre à son ouverture, sur le premier champ de saisie", () => {
    render(<Modale onClose={() => {}} />);

    expect(screen.getByLabelText("Nom")).toHaveFocus();
  });

  it("met le focus sur l'élément marqué data-autofocus, pour qu'Entrée ne déclenche pas l'action destructrice", () => {
    render(<ModaleAvecChoixParDefaut />);

    expect(screen.getByRole("button", { name: "Rester connecté" })).toHaveFocus();
  });

  it("se ferme avec Échap", async () => {
    const onClose = vi.fn();
    render(<Modale onClose={onClose} />);

    await userEvent.setup().keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ne se ferme pas avec Échap quand la fermeture est interdite (enregistrement en cours)", async () => {
    const onClose = vi.fn();
    render(<Modale onClose={onClose} fermable={false} />);

    await userEvent.setup().keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("garde Tab dans la fenêtre : après le dernier élément, le focus revient au premier", async () => {
    const user = userEvent.setup();
    render(<Modale onClose={() => {}} />);
    screen.getByRole("button", { name: "Valider" }).focus();

    await user.tab();

    expect(screen.getByRole("button", { name: "Fermer" })).toHaveFocus();
  });

  it("garde Maj+Tab dans la fenêtre : avant le premier élément, le focus passe au dernier", async () => {
    const user = userEvent.setup();
    render(<Modale onClose={() => {}} />);
    screen.getByRole("button", { name: "Fermer" }).focus();

    await user.tab({ shift: true });

    expect(screen.getByRole("button", { name: "Valider" })).toHaveFocus();
  });

  it("rend le focus au bouton qui a ouvert la fenêtre quand elle se ferme", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const ouvrir = screen.getByRole("button", { name: "Ouvrir" });
    await user.click(ouvrir);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ouvrir).toHaveFocus();
  });

  it("n'obéit à Échap que pour la fenêtre du dessus quand deux sont ouvertes", async () => {
    const dessous = vi.fn();
    const dessus = vi.fn();
    render(
      <>
        <Modale onClose={dessous} />
        <Modale onClose={dessus} />
      </>
    );

    await userEvent.setup().keyboard("{Escape}");

    expect(dessus).toHaveBeenCalledTimes(1);
    expect(dessous).not.toHaveBeenCalled();
  });

  it("le bouton retour d'Android ferme la fenêtre ouverte, comme Échap", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));

    expect(traiterRetourSurCouche()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pendant un enregistrement (fenêtre non fermable), le bouton retour est absorbé sans fermer la fenêtre", () => {
    const onClose = vi.fn();
    render(<Modale onClose={onClose} fermable={false} />);

    expect(traiterRetourSurCouche()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("une fois la fenêtre fermée, le bouton retour n'a plus de couche à refermer", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    await user.keyboard("{Escape}");

    expect(traiterRetourSurCouche()).toBe(false);
  });
});

