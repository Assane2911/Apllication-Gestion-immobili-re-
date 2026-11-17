import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import { changerLangue, SUPPORTED_LANGUAGES } from "../i18n";
import LandingPage from "./LandingPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

/**
 * Le menu en ligne de l'accueil s'affiche selon la largeur ET la langue (index.css) : les libellés espagnols et portugais sont plus
 * longs, et à largeur égale le bouton d'essai sortait de l'écran. jsdom ne calcule aucune mise en page : la tenue réelle a été
 * mesurée dans le navigateur (320 à 1900 px, 4 langues, aucune anomalie) ; ces tests tiennent la liste des langues d'accord.
 */
const css = readFileSync(join(__dirname, "../index.css"), "utf8");

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LandingPage />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("LandingPage — menu en ligne selon la langue", () => {
  beforeEach(() => {
    vi.mocked(api, { deep: true }).get.mockReset();
  });
  afterEach(async () => {
    await changerLangue("fr");
  });

  it("chaque langue de l'interface a ses largeurs de menu en ligne dans la feuille de style", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(css, `langue ${code}`).toContain(`[data-langue="${code}"] .menu-en-ligne { display: flex; }`);
      expect(css, `langue ${code}`).toContain(`[data-langue="${code}"] .hors-menu-en-ligne { display: none; }`);
    }
  });

  it("la barre annonce sa langue, et le bouton de menu comme les liens suivent les mêmes classes", async () => {
    for (const code of ["fr", "en", "es", "pt"]) {
      await changerLangue(code);
      const { container, unmount } = renderPage();
      const barre = container.querySelector("nav")!;
      expect(barre.getAttribute("data-langue")).toBe(code);
      expect(barre.querySelector(".menu-en-ligne")).not.toBeNull();
      expect(screen.getAllByRole("button").some((b) => b.className.includes("hors-menu-en-ligne"))).toBe(true);
      unmount();
    }
  });

  it("le sélecteur de langue de la barre garde toujours le code court", () => {
    renderPage();
    const selecteur = screen.getAllByRole("combobox")[0];
    expect(selecteur.textContent).toMatch(/FR/);
    expect(selecteur.textContent).not.toMatch(/Français/);
  });
});
