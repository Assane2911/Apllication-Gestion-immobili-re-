import { render, screen, within } from "@testing-library/react";
import { MessageSquare, LayoutDashboard } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MenuLateral, { type GroupeMenu } from "./MenuLateral";

const groupes: ReadonlyArray<GroupeMenu> = [
  {
    cle: "overview",
    items: [
      { to: "/proprietaire", key: "home", icone: LayoutDashboard },
      { to: "/proprietaire/messages", key: "messages", icone: MessageSquare },
    ],
  },
];

function afficher(pastilles?: Record<string, number>) {
  return render(
    <MemoryRouter initialEntries={["/proprietaire"]}>
      <MenuLateral
        groupes={groupes}
        prefixeLibelles="nav.owner"
        prefixeRubriques="nav.ownerGroups"
        racine="/proprietaire"
        sousTitre="Espace"
        cleStockage="test-menu"
        ouvertMobile={false}
        onFermerMobile={() => {}}
        onDeconnexion={vi.fn()}
        pastilles={pastilles}
      />
    </MemoryRouter>
  );
}

describe("MenuLateral — pastilles", () => {
  it("affiche le nombre sur l'icône de l'entrée concernée, et le dit aux lecteurs d'écran", () => {
    afficher({ "/proprietaire/messages": 3 });
    const lien = screen.getByRole("link", { name: /Messagerie/ });
    expect(within(lien).getByTestId("pastille-menu")).toHaveTextContent("3");
    expect(lien).toHaveAccessibleName("Messagerie, 3 message(s) non lu(s)");
    // Les autres entrées n'en ont pas.
    expect(within(screen.getByRole("link", { name: "Tableau de bord" })).queryByTestId("pastille-menu")).not.toBeInTheDocument();
  });

  it("plafonne l'affichage à 99+", () => {
    afficher({ "/proprietaire/messages": 240 });
    expect(screen.getByTestId("pastille-menu")).toHaveTextContent("99+");
  });

  it("n'affiche rien pour zéro, ni sans pastilles", () => {
    afficher({ "/proprietaire/messages": 0 });
    expect(screen.queryByTestId("pastille-menu")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messagerie" })).toBeInTheDocument();
  });
});
