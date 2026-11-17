import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { changerLangue } from "../i18n";
import LienEvitement, { ID_CONTENU_PRINCIPAL } from "./LienEvitement";

describe("LienEvitement", () => {
  afterEach(async () => {
    await changerLangue("fr");
  });

  it("est le premier élément atteint au clavier, et mène au contenu principal", async () => {
    render(
      <>
        <LienEvitement />
        <button>Menu</button>
        <main id={ID_CONTENU_PRINCIPAL} tabIndex={-1}>
          contenu
        </main>
      </>
    );
    const user = userEvent.setup();
    await user.tab();
    const lien = screen.getByRole("link", { name: "Aller au contenu principal" });
    expect(lien).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(document.getElementById(ID_CONTENU_PRINCIPAL)).toHaveFocus();
    // Pas d'ancre ajoutée à l'adresse : le bouton « Retour » de l'application n'est pas faussé.
    expect(window.location.hash).toBe("");
  });

  it("sans contenu principal sur la page, ne fait rien de surprenant", async () => {
    render(<LienEvitement />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("est écrit dans la langue choisie", async () => {
    await changerLangue("es");
    render(<LienEvitement />);
    expect(screen.getByRole("link", { name: "Saltar al contenido principal" })).toBeInTheDocument();
  });

  it("n'est visible qu'au focus (reste lisible par les lecteurs d'écran)", () => {
    render(<LienEvitement />);
    const lien = screen.getByRole("link");
    expect(lien.className).toContain("sr-only");
    expect(lien.className).toContain("focus:not-sr-only");
  });
});
