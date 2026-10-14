import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import GuidePage from "./GuidePage";

function renderGuide() {
  return render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );
}

describe("GuidePage — guide de démarrage", () => {
  it("présente huit étapes numérotées, dans l'ordre où une nouvelle agence en a besoin", () => {
    renderGuide();
    expect(screen.getByRole("heading", { name: "Guide de démarrage", level: 2 })).toBeInTheDocument();
    const etapes = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(etapes).toHaveLength(8);
    const titres = etapes.map((e) => within(e).getByRole("heading", { level: 3 }).textContent);
    expect(titres[0]).toBe("Renseignez votre agence");
    expect(titres[1]).toBe("Importez vos données existantes");
    expect(titres[7]).toBe("Choisissez votre formule");
  });

  it("chaque étape renvoie à la page qui la réalise, import avant bail", () => {
    renderGuide();
    const liens = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(liens).toEqual(["/agency", "/import", "/properties", "/contracts", "/tenants", "/invoices", "/agency", "/subscription"]);
  });

  it("nomme la destination de chaque lien pour un lecteur d'écran, pas seulement « Ouvrir »", () => {
    renderGuide();
    expect(screen.getByRole("link", { name: /Ouvrir.*Importez vos données existantes/ })).toHaveAttribute("href", "/import");
  });
});
