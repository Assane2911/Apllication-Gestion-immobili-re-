import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, Users } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MenuLateral from "./MenuLateral";

/**
 * Tiroir de navigation sur téléphone, au clavier et au lecteur d'écran.
 *
 * Mesuré dans un navigateur à 390 px : tiroir fermé, ses 26 liens et boutons restaient dans l'ordre de tabulation (et lus par
 * VoiceOver / TalkBack) alors qu'ils sont hors de l'écran ; ouvert, Échap ne le fermait pas et le focus restait sur le bouton
 * d'ouverture, derrière le voile.
 */
const groupes = [{ cle: "g", items: [{ to: "/a", key: "a", icone: Home }, { to: "/b", key: "b", icone: Users }] }];

function menu(ouvertMobile: boolean, onFermerMobile = vi.fn()) {
  return (
    <MemoryRouter>
      <button type="button">Ouvrir le menu</button>
      <MenuLateral
        groupes={groupes}
        prefixeLibelles="nav.manager"
        prefixeRubriques="nav.groups"
        racine="/a"
        sousTitre="Espace"
        cleStockage="test-menu"
        ouvertMobile={ouvertMobile}
        onFermerMobile={onFermerMobile}
        onDeconnexion={() => {}}
      />
    </MemoryRouter>
  );
}

const tiroir = (conteneur: HTMLElement) => conteneur.querySelector("aside") as HTMLElement;

describe("tiroir de navigation (téléphone)", () => {
  it("fermé : retiré de l'ordre de tabulation et des lecteurs d'écran sur téléphone (visibility: hidden)", () => {
    const { container } = render(menu(false));
    expect(tiroir(container).className).toContain("max-sm:invisible");
  });

  it("ouvert : visible, et identifié pour le bouton qui l'ouvre (aria-controls)", () => {
    const { container } = render(menu(true));
    expect(tiroir(container).className).not.toContain("max-sm:invisible");
    expect(tiroir(container).id).toBe("menu-lateral");
  });

  it("à l'ouverture, le focus entre dans le tiroir ; à la fermeture, il revient au bouton qui l'avait ouvert", () => {
    const { container, rerender } = render(menu(false));
    const bouton = screen.getByRole("button", { name: "Ouvrir le menu" });
    bouton.focus();

    rerender(menu(true));
    expect(tiroir(container).contains(document.activeElement)).toBe(true);

    rerender(menu(false));
    expect(document.activeElement).toBe(bouton);
  });

  it("Échap ferme le tiroir ouvert", async () => {
    const onFermer = vi.fn();
    render(menu(true, onFermer));
    await userEvent.setup().keyboard("{Escape}");
    expect(onFermer).toHaveBeenCalledOnce();
  });

  it("Échap ne fait rien quand le tiroir est fermé (la touche reste aux autres composants)", async () => {
    const onFermer = vi.fn();
    render(menu(false, onFermer));
    await userEvent.setup().keyboard("{Escape}");
    expect(onFermer).not.toHaveBeenCalled();
  });

  it("le focus reste dans le tiroir ouvert : Tab après le dernier élément revient au premier, Maj+Tab inversement", async () => {
    const { container } = render(menu(true));
    const utilisateur = userEvent.setup();
    const elements = Array.from(tiroir(container).querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    const premier = elements[0];
    const dernier = elements[elements.length - 1];

    dernier.focus();
    await utilisateur.tab();
    expect(document.activeElement).toBe(premier);

    await utilisateur.tab({ shift: true });
    expect(document.activeElement).toBe(dernier);
  });
});
