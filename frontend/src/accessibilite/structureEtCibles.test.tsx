import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import BoutonSuggestion from "../components/BoutonSuggestion";
import { AuthProvider } from "../context/AuthContext";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import ResetPasswordPage from "../pages/ResetPasswordPage";
import VerifyEmailPage from "../pages/VerifyEmailPage";
import CGUPage from "../pages/legal/CGUPage";
import MentionsLegalesPage from "../pages/legal/MentionsLegalesPage";
import PolitiqueConfidentialitePage from "../pages/legal/PolitiqueConfidentialitePage";

/**
 * Structure des pages et taille des cibles — constats d'un audit axe-core (WCAG 2.2 AA) des pages publiques :
 *
 *  - une page a UN titre de niveau 1, visible sur téléphone : celui de la page (« Connexion »…), pas le slogan du
 *    panneau de marque, qui disparaît sous 1024 px ;
 *  - chaque page a une zone principale (`<main>`), pour que « aller au contenu » existe ;
 *  - un bouton fait au moins 24 x 24 px (critère 2.5.8) : l'œil « afficher le mot de passe » en faisait 16 ;
 *  - les boutons flottants (suggestion, guide) sont dans une zone nommée, sinon un lecteur d'écran les lit hors de
 *    tout repère de la page.
 */
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockReturnValue(new Promise(() => {})) } };
});

vi.mock("../components/GoogleSignInButton", () => ({ default: () => null }));

const mockedApi = vi.mocked(api, { deep: true });

function rendre(page: ReactElement, entree: string) {
  return render(
    <ThemeProvider><MemoryRouter initialEntries={[entree]}>
      <AuthProvider>{page}</AuthProvider>
    </MemoryRouter></ThemeProvider>
  );
}

const pagesAvecFormulaire: Array<[string, ReactElement, string, string]> = [
  ["connexion", <LoginPage />, "/login", "Gestion Immobilière"],
  ["inscription", <RegisterPage />, "/inscription", "Créer un compte"],
  ["mot de passe oublié", <ForgotPasswordPage />, "/mot-de-passe-oublie", "Mot de passe oublié"],
  ["réinitialisation", <ResetPasswordPage />, "/reinitialiser-mot-de-passe?token=abc123", "Nouveau mot de passe"],
  ["vérification de l'email", <VerifyEmailPage />, "/verifier-email?token=abc123", "Vérification en cours..."],
];

describe("pages d'authentification — un seul titre de niveau 1, dans une zone principale", () => {
  beforeEach(() => {
    mockedApi.post.mockClear();
  });

  for (const [nom, page, entree, titre] of pagesAvecFormulaire) {
    it(`${nom} : un seul h1, c'est le titre de la page`, () => {
      rendre(page, entree);
      const h1 = screen.getAllByRole("heading", { level: 1 });
      expect(h1).toHaveLength(1);
      expect(h1[0]).toHaveTextContent(titre);
    });

    it(`${nom} : le contenu est dans une zone principale`, () => {
      rendre(page, entree);
      const main = screen.getByRole("main");
      expect(main).toContainElement(screen.getByRole("heading", { level: 1 }));
    });
  }

  for (const [nom, page, entree] of [
    ["réinitialisation sans jeton", <ResetPasswordPage />, "/reinitialiser-mot-de-passe"],
    ["vérification sans jeton", <VerifyEmailPage />, "/verifier-email"],
  ] as Array<[string, ReactElement, string]>) {
    it(`${nom} : la page garde un h1 (lisible par un lecteur d'écran seulement) dans <main>`, () => {
      rendre(page, entree);
      const h1 = screen.getAllByRole("heading", { level: 1 });
      expect(h1).toHaveLength(1);
      expect(screen.getByRole("main")).toContainElement(h1[0]);
    });
  }

  it("le slogan du panneau de marque ne forme plus un second titre de niveau 1", () => {
    rendre(<LoginPage />, "/login");
    expect(screen.getByText("La gestion locative, enfin simple.").tagName).not.toBe("H1");
  });
});

describe("bouton « afficher le mot de passe » — cible d'au moins 24 x 24 px", () => {
  for (const [nom, page, entree] of [
    ["connexion", <LoginPage />, "/login"],
    ["inscription", <RegisterPage />, "/inscription"],
    ["réinitialisation", <ResetPasswordPage />, "/reinitialiser-mot-de-passe?token=abc123"],
  ] as Array<[string, ReactElement, string]>) {
    it(`${nom} : l'œil mesure 24 px (h-6 w-6) et reste centré sur son icône`, () => {
      rendre(page, entree);
      const oeil = screen.getAllByRole("button", { name: "Afficher le mot de passe" })[0];
      expect(oeil.className).toMatch(/\bh-6\b/);
      expect(oeil.className).toMatch(/\bw-6\b/);
      expect(oeil.className).toMatch(/\bflex\b/);
      expect(oeil.className).toMatch(/\bitems-center\b/);
      expect(oeil.className).toMatch(/\bjustify-center\b/);
    });
  }
});

describe("pages légales — zone principale (structure seulement, texte inchangé)", () => {
  for (const [nom, page, titre] of [
    ["mentions légales", <MentionsLegalesPage />, "Mentions légales"],
    ["CGU", <CGUPage />, "Conditions Générales d'Utilisation"],
    ["confidentialité", <PolitiqueConfidentialitePage />, "Politique de confidentialité"],
  ] as Array<[string, ReactElement, string]>) {
    it(`${nom} : le titre et le texte sont dans <main>`, () => {
      rendre(page, "/");
      const main = screen.getByRole("main");
      expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: new RegExp(titre) }));
      expect(main.querySelectorAll("h2").length).toBeGreaterThan(0);
    });
  }

  it("la navigation et le pied de page restent hors de la zone principale", () => {
    rendre(<MentionsLegalesPage />, "/");
    const main = screen.getByRole("main");
    expect(main).not.toContainElement(screen.getByRole("contentinfo"));
    expect(main).not.toContainElement(screen.getAllByRole("navigation")[0]);
  });
});

describe("boutons flottants — dans une zone nommée", () => {
  it("le bouton « Une suggestion ? » et le raccourci à côté sont dans une zone (complementary) nommée", () => {
    rendre(<BoutonSuggestion aCote={<a href="/guide-demarrage">Guide</a>} />, "/dashboard");
    const zone = screen.getByRole("complementary", { name: "Aide et suggestions" });
    expect(zone).toContainElement(screen.getByRole("button", { name: /Une suggestion/ }));
    expect(zone).toContainElement(screen.getByRole("link", { name: "Guide" }));
  });
});
