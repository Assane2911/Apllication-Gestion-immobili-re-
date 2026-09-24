import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { CurrencyProvider } from "../context/CurrencyContext";
import LandingPage from "./LandingPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn().mockResolvedValue({ data: { items: [], total: 0, totalPages: 1 } }), post: vi.fn() } };
});

/**
 * La vitrine publique existait de bout en bout — route, page, API — mais
 * aucun écran n'y menait : `/vitrine` n'apparaissait qu'une seule fois dans
 * tout le frontend, dans sa propre déclaration de route. Les annonces étaient
 * donc publiées et servies correctement, et invisibles pour quiconque ne
 * tapait pas l'adresse à la main. C'est exactement ce que décrivait le
 * symptôme « annonces créées mais pas affichées ».
 *
 * Ce test garde la seule chose qui manquait : un chemin depuis la page
 * d'accueil publique.
 */
describe("Accès à la vitrine publique", () => {
  it("propose un lien vers la vitrine depuis la page d'accueil", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <CurrencyProvider>
            <LandingPage />
          </CurrencyProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    const liens = screen.getAllByRole("link", { name: "Nos biens" });
    expect(liens.length).toBeGreaterThan(0);
    for (const lien of liens) {
      expect(lien).toHaveAttribute("href", "/vitrine");
    }
  });
});
