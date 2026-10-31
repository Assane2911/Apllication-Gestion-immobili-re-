import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Seo from "./components/Seo";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import VitrinePage from "./pages/VitrinePage";
import CGUPage from "./pages/legal/CGUPage";
import MentionsLegalesPage from "./pages/legal/MentionsLegalesPage";
import PolitiqueConfidentialitePage from "./pages/legal/PolitiqueConfidentialitePage";

/**
 * Référencement (audit de septembre 2026) :
 *
 *  - l'accueil s'affiche sur `/`, sur `/landing` ET sur toute adresse inconnue (`/cette-page-nexiste-pas`), toujours
 *    en 200 : pour un moteur de recherche, autant de copies de la même page. Une balise canonique les ramène toutes
 *    à `/` ;
 *  - connexion, inscription et mot de passe oublié partageaient le titre de l'accueil et n'avaient aucune
 *    description : chacune a désormais les siens, et sa propre adresse canonique ;
 *  - les pages à jeton (réinitialisation, vérification de l'email) n'ont rien à faire dans un index : `noindex`.
 */
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    api: {
      get: vi.fn().mockResolvedValue({ data: { items: [], total: 0, page: 1, totalPages: 1, countries: [] } }),
      post: vi.fn().mockReturnValue(new Promise(() => {})),
    },
  };
});
vi.mock("./components/GoogleSignInButton", () => ({ default: () => null }));

const SITE = "https://www.immoplatformpro.com";

const canonique = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
const description = () => document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? null;

function rendre(page: ReactElement, entree: string) {
  return render(
    <MemoryRouter initialEntries={[entree]}>
      <ThemeProvider><AuthProvider>{page}</AuthProvider></ThemeProvider>
    </MemoryRouter>
  );
}

afterEach(() => cleanup());

describe("composant Seo", () => {
  it("pose la balise canonique en adresse absolue du site", () => {
    render(<Seo title="T" description="D" canonical="/vitrine" />);
    expect(canonique()).toBe(`${SITE}/vitrine`);
  });

  it("n'en pose aucune par défaut, et aucune directive robots", () => {
    render(<Seo title="T" description="D" />);
    expect(canonique()).toBeNull();
    expect(robots()).toBeNull();
  });

  it("noindex pose la directive robots, sans exiger de description", () => {
    render(<Seo title="T" noindex />);
    expect(robots()).toBe("noindex");
    expect(description()).toBeNull();
  });

  it("retire ses balises au démontage", () => {
    const { unmount } = render(<Seo title="T" description="D" canonical="/x" noindex />);
    unmount();
    expect(canonique()).toBeNull();
    expect(robots()).toBeNull();
  });
});

describe("accueil — une seule adresse canonique pour toutes ses copies", () => {
  for (const entree of ["/", "/landing", "/cette-page-nexiste-pas"]) {
    it(`${entree} → ${SITE}/`, () => {
      rendre(<LandingPage />, entree);
      expect(canonique()).toBe(`${SITE}/`);
    });
  }
});

describe("pages d'authentification — titre, description et canonique propres", () => {
  for (const [nom, page, entree, titre, canon] of [
    ["connexion", <LoginPage />, "/login", "Connexion | ImmoPlatform Pro", "/login"],
    ["inscription", <RegisterPage />, "/inscription", "Créer un compte gestionnaire | ImmoPlatform Pro", "/inscription"],
    ["mot de passe oublié", <ForgotPasswordPage />, "/mot-de-passe-oublie", "Mot de passe oublié | ImmoPlatform Pro", "/mot-de-passe-oublie"],
  ] as Array<[string, ReactElement, string, string, string]>) {
    it(`${nom} : titre distinct de l'accueil, description et canonique`, () => {
      rendre(page, entree);
      expect(document.title).toBe(titre);
      expect(description()).toBeTruthy();
      expect(description()!.length).toBeGreaterThan(50);
      expect(canonique()).toBe(`${SITE}${canon}`);
      expect(robots()).toBeNull();
    });
  }

  it("les trois descriptions sont différentes entre elles et de celle de l'accueil", () => {
    const vues: string[] = [];
    for (const [page, entree] of [
      [<LoginPage />, "/login"],
      [<RegisterPage />, "/inscription"],
      [<ForgotPasswordPage />, "/mot-de-passe-oublie"],
      [<LandingPage />, "/"],
    ] as Array<[ReactElement, string]>) {
      const { unmount } = rendre(page, entree);
      vues.push(description()!);
      unmount();
    }
    expect(new Set(vues).size).toBe(4);
  });
});

describe("pages à jeton — hors de l'index", () => {
  for (const [nom, page, entree, titre] of [
    ["réinitialisation", <ResetPasswordPage />, "/reinitialiser-mot-de-passe?token=abc", "Nouveau mot de passe | ImmoPlatform Pro"],
    ["vérification de l'email", <VerifyEmailPage />, "/verifier-email?token=abc", "Confirmation de l'email | ImmoPlatform Pro"],
    ["réinitialisation sans jeton", <ResetPasswordPage />, "/reinitialiser-mot-de-passe", "Nouveau mot de passe | ImmoPlatform Pro"],
  ] as Array<[string, ReactElement, string, string]>) {
    it(`${nom} : noindex et titre propre`, () => {
      rendre(page, entree);
      expect(robots()).toBe("noindex");
      expect(document.title).toBe(titre);
      expect(canonique()).toBeNull();
    });
  }
});

describe("vitrine et pages légales — canonique sur leur propre adresse", () => {
  it("vitrine : /vitrine, sans les filtres de l'adresse", () => {
    rendre(<VitrinePage />, "/vitrine?type=RENT&country=SN&page=2");
    expect(canonique()).toBe(`${SITE}/vitrine`);
  });

  for (const [nom, page, chemin] of [
    ["mentions légales", <MentionsLegalesPage />, "/mentions-legales"],
    ["CGU", <CGUPage />, "/cgu"],
    ["confidentialité", <PolitiqueConfidentialitePage />, "/confidentialite"],
  ] as Array<[string, ReactElement, string]>) {
    it(`${nom} : ${chemin}`, () => {
      rendre(page, chemin);
      expect(canonique()).toBe(`${SITE}${chemin}`);
    });
  }
});
