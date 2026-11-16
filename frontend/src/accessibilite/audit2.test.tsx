import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import BoutonHautDePage from "../components/BoutonHautDePage";
import { AuthProvider } from "../context/AuthContext";
import LoginPage from "../pages/LoginPage";
import LandingPage from "../pages/LandingPage";
import MentionsLegalesPage from "../pages/legal/MentionsLegalesPage";

/**
 * Deuxième audit d'accessibilité (axe-core 4.14 + parcours au clavier, pages publiques et espaces connectés, 4 langues) :
 *
 *  - un élément INVISIBLE (transparent, hors écran) ne doit pas rester atteignable au clavier : un utilisateur qui tabule
 *    tombait sur le bouton « haut de page » sans le voir, sans cadre de focus ;
 *  - les titres se suivent sans saut (h1 → h2 → h3) : les trois étapes de l'accroche étaient des h3 sous le h1 ;
 *  - les liens isolés qui ne faisaient que 16 à 19 px de haut (« Mot de passe oublié ? », « ← Retour à l'accueil »…) font
 *    au moins 24 px, comme les boutons (critère 2.5.8) ;
 *  - le texte du bandeau de récompense du parrainage atteint le contraste 4,5:1.
 */
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockReturnValue(new Promise(() => {})) } };
});
vi.mock("../components/GoogleSignInButton", () => ({ default: () => null }));

const mockedApi = vi.mocked(api, { deep: true });

function allerA(scrollY: number) {
  Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

afterEach(() => {
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

describe("bouton « haut de page » — absent du clavier tant qu'il est invisible", () => {
  it("en haut de la page : masqué aux lecteurs d'écran et hors de l'ordre de tabulation", () => {
    render(<BoutonHautDePage libelle="Haut de page" />);
    const lien = document.querySelector('a[href="#top"]') as HTMLAnchorElement;
    expect(lien).toHaveAttribute("aria-hidden", "true");
    expect(lien).toHaveAttribute("tabindex", "-1");
  });

  it("après défilement : visible, nommé, et atteignable au clavier", () => {
    render(<BoutonHautDePage libelle="Haut de page" />);
    allerA(1200);
    const lien = screen.getByRole("link", { name: "Haut de page" });
    expect(lien).not.toHaveAttribute("aria-hidden");
    expect(lien).not.toHaveAttribute("tabindex", "-1");
  });

  it("redevient masqué quand on remonte", () => {
    render(<BoutonHautDePage libelle="Haut de page" />);
    allerA(1200);
    allerA(0);
    expect(document.querySelector('a[href="#top"]')).toHaveAttribute("aria-hidden", "true");
  });
});

describe("page d'accueil — structure des titres et barre d'essai fixe", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.get.mockResolvedValue({ data: {} });
  });

  function rendreAccueil() {
    return render(
      <MemoryRouter>
        <AuthProvider>
          <LandingPage />
        </AuthProvider>
      </MemoryRouter>
    );
  }

  it("les titres ne sautent aucun niveau (jamais de h3 avant le premier h2)", () => {
    const { container } = rendreAccueil();
    const niveaux = Array.from(container.querySelectorAll("h1, h2, h3, h4")).map((h) => Number(h.tagName[1]));
    let precedent = 0;
    for (const n of niveaux) {
      expect(n - precedent, `saut de titre h${precedent} → h${n}`).toBeLessThanOrEqual(1);
      precedent = n;
    }
  });

  it("la barre d'essai fixe, hors écran, n'est pas lue par les lecteurs d'écran", () => {
    rendreAccueil();
    const barre = document.querySelector(".fixed.bottom-0.inset-x-0");
    expect(barre).not.toBeNull();
    expect(barre!.querySelector('a[href="/inscription"]')).not.toBeNull();
    expect(barre).toHaveAttribute("aria-hidden", "true");
  });
});

describe("liens isolés — au moins 24 px de haut", () => {
  function rendre(page: React.ReactElement) {
    return render(
      <MemoryRouter>
        <AuthProvider>{page}</AuthProvider>
      </MemoryRouter>
    );
  }

  it("connexion : « Mot de passe oublié ? » et « ← Retour à l'accueil »", () => {
    rendre(<LoginPage />);
    for (const lien of [screen.getByRole("link", { name: /Mot de passe oublié/ }), screen.getByRole("link", { name: /Retour à l'accueil/ })]) {
      expect(lien.className).toMatch(/\bmin-h-6\b/);
      expect(lien.className).toMatch(/\binline-flex\b/);
      expect(lien.className).toMatch(/\bitems-(center|end)\b/);
    }
  });

  it("pages légales : « ← Retour à l'accueil »", () => {
    rendre(<MentionsLegalesPage />);
    const lien = screen.getByRole("link", { name: /Retour à l'accueil/ });
    expect(lien.className).toMatch(/\bmin-h-6\b/);
    expect(lien.className).toMatch(/\binline-flex\b/);
  });
});

describe("bandeau de récompense du parrainage — contraste du petit texte sur fond orange", () => {
  it("le libellé en 10 px est en blanc plein (le blanc à 90 % sur orange-700 ne fait que 4,39:1)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(__dirname, "..", "pages", "manager", "ReferralPage.tsx"), "utf8");
    const bloc = source.slice(source.indexOf("bg-orange-700"));
    expect(bloc.slice(0, 600)).not.toMatch(/text-white\/90/);
  });
});
