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
    expect(screen.getByText("Nouvelle Version 2.0 • 15 jours d'essai gratuit offert sans engagement")).toBeInTheDocument();
    expect(screen.getByText("La gestion locative")).toBeInTheDocument();
    expect(screen.getByText("réinventée & automatisée.")).toBeInTheDocument();
  });

  it("annonce la disponibilité prochaine de l'app mobile sur l'App Store et Google Play", () => {
    renderPage();
    expect(screen.getByText("Bientôt disponible sur l'App Store et Google Play")).toBeInTheDocument();
  });

  it("définit un titre d'onglet et une meta description propres à la page", () => {
    renderPage();
    expect(document.title).toBe("ImmoPlatform Pro — Gestion locative et immobilière intelligente");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Quittances PDF certifiées, signature électronique des baux, relances automatiques, tableau de bord en temps réel. Essai gratuit de 15 jours sans engagement."
    );
  });

  // Régression. La durée réelle de l'essai (auth.controller.ts::register,
  // trialEndsAt = +15 jours) était annoncée à "15 jours" partout sauf sur le
  // bouton "Essai" de la barre de navigation et les 3 CTA de tarifs, restés à
  // "10j" — une coquille qui promettait au visiteur un essai plus court que
  // ce que son inscription lui accorde réellement.
  it("annonce partout la même durée d'essai (15 jours), y compris sur les CTA de tarifs", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Essai 15j gratuit →" })).toBeInTheDocument();
    expect(screen.queryByText(/10j/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /essai 15j/i }).length).toBeGreaterThanOrEqual(3);
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

  /**
   * Régression a11y : le contenu de la page (hero, fonctionnalités, tarifs...)
   * ne vivait dans aucun repère de landmark — un lecteur d'écran n'avait aucun
   * moyen d'aller directement au contenu principal en sautant la navigation.
   */
  it("place le contenu principal dans un repère <main>", () => {
    renderPage();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  /**
   * Régression a11y : le titre de chaque ligne du comparatif sautait de h2
   * (titre de la section) directement à h4, sans h3 intermédiaire.
   */
  it("titre chaque ligne du comparatif avec un niveau de titre h3, pas h4", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 3, name: "Avis d'échéance & Relances de loyer" })
    ).toBeInTheDocument();
  });
});
