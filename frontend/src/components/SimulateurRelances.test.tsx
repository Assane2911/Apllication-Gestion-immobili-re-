import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import SimulateurRelances from "./SimulateurRelances";

function afficher() {
  render(
    <MemoryRouter>
      <SimulateurRelances />
    </MemoryRouter>
  );
}

describe("SimulateurRelances", () => {
  it("part des réglages par défaut d'une agence : première relance à J+5, puis tous les 10 jours", () => {
    afficher();
    expect(screen.getByTestId("resume-relances")).toHaveTextContent("Relance amiable à J+5, deuxième relance à J+15, dernière relance à J+25.");
    const calendrier = screen.getByRole("list", { name: "Calendrier des relances d'un loyer impayé" });
    const jours = within(calendrier).getAllByRole("listitem").map((li) => li.firstElementChild?.textContent);
    expect(jours).toEqual(["J+0", "J+5", "J+15", "J+25", "J+90"]);
  });

  it("recalcule le calendrier quand on déplace les curseurs", () => {
    afficher();
    fireEvent.change(screen.getByLabelText(/Délai avant la première relance/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Intervalle entre deux relances/), { target: { value: "7" } });
    expect(screen.getByTestId("resume-relances")).toHaveTextContent("J+3, deuxième relance à J+10, dernière relance à J+17.");
    expect(screen.getByLabelText(/Délai avant la première relance/)).toHaveAttribute("aria-valuetext", "3 jour(s)");
  });

  it("garde les réglages dans les bornes de l'application (1 à 30 jours, intervalle de 3 jours minimum)", () => {
    afficher();
    const grace = screen.getByLabelText(/Délai avant la première relance/);
    const intervalle = screen.getByLabelText(/Intervalle entre deux relances/);
    expect(grace).toHaveAttribute("min", "1");
    expect(grace).toHaveAttribute("max", "30");
    expect(intervalle).toHaveAttribute("min", "3");
    expect(intervalle).toHaveAttribute("max", "30");
  });

  it("invite à activer les relances pendant l'essai", () => {
    afficher();
    expect(screen.getByRole("link", { name: "Activer les relances pendant l'essai" })).toHaveAttribute("href", "/inscription");
  });
});
