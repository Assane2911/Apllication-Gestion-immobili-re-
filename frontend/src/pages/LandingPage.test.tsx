import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import LandingPage from "./LandingPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LandingPage />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("LandingPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche l'accroche principale et le badge de la version", () => {
    renderPage();
    expect(screen.getByText("Nouvelle Version 2.0 • 10 jours d'essai gratuit offert sans engagement")).toBeInTheDocument();
    expect(screen.getByText("La gestion locative")).toBeInTheDocument();
    expect(screen.getByText("réinventée & automatisée.")).toBeInTheDocument();
  });

  it("propose la connexion et l'essai gratuit vers /inscription quand personne n'est connecté", () => {
    renderPage();
    const trialLinks = screen.getAllByRole("link", { name: /essai/i });
    expect(trialLinks.some((link) => link.getAttribute("href") === "/inscription")).toBe(true);
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login");
  });

  it("propose d'accéder à son espace au lieu de se connecter quand un gestionnaire est déjà authentifié", () => {
    localStorage.setItem("token", "tok_123");
    localStorage.setItem(
      "user",
      JSON.stringify({ id: "mgr-1", email: "agence@test.local", role: "MANAGER", tenantId: null, tenantName: null }),
    );
    renderPage();
    expect(screen.getByRole("link", { name: "Accéder à mon espace →" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Se connecter" })).not.toBeInTheDocument();
  });

  // Régression. Le second bouton de l'accroche annonçait « Tester en mode
  // démo » et menait à /login, où deux comptes de démonstration remplissaient
  // le formulaire. Ces comptes ont été retirés — leur mot de passe était écrit
  // en clair dans le code du frontend, donc servi au navigateur de chaque
  // visiteur. Le bouton promettait dès lors une porte qui n'existe plus.
  it("ne promet plus de mode démo dans l'accroche", () => {
    renderPage();

    expect(screen.queryByText(/mode démo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/démo/i)).not.toBeInTheDocument();
  });

  it("propose les tarifs comme seconde entrée de l'accroche", () => {
    renderPage();

    const bouton = screen.getByRole("link", { name: "Voir les tarifs" });
    expect(bouton).toHaveAttribute("href", "#pricing");
  });

  it("affiche les sections fonctionnalités et tarifs", () => {
    renderPage();
    expect(screen.getByText("Quittances & Baux PDF Certifiés")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Des formules simples et transparentes", level: 2 })).toBeInTheDocument();
  });
});
