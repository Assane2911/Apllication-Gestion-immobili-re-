import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import CGUPage from "./legal/CGUPage";
import ForgotPasswordPage from "./ForgotPasswordPage";
import LoginPage from "./LoginPage";
import RegisterPage from "./RegisterPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() } };
});

function rendre(page: ReactElement) {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AuthProvider>{page}</AuthProvider>
      </MemoryRouter>
    </ThemeProvider>
  );
}

const PAGES: Array<[string, ReactElement]> = [
  ["connexion", <LoginPage />],
  ["inscription", <RegisterPage />],
  ["mot de passe oublié", <ForgotPasswordPage />],
  ["conditions d'utilisation", <CGUPage />],
];

describe("pages publiques — thème clair par défaut, sombre au choix", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  for (const [nom, page] of PAGES) {
    it(`${nom} : clair par défaut, le bouton de thème bascule en sombre puis revient au clair`, async () => {
      const user = userEvent.setup();
      rendre(page);
      expect(document.documentElement.classList.contains("dark")).toBe(false);

      const bouton = screen.getByRole("button", { name: "Basculer le thème clair/sombre" });
      await user.click(bouton);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      await user.click(bouton);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it(`${nom} : plus de fond sombre imposé (le fond vient du thème)`, () => {
      const { container } = rendre(page);
      expect(container.querySelector(".bg-slate-950:not([class*='dark:'])")).toBeNull();
    });
  }
});

describe("fond de la charte — posé une fois, par la page", () => {
  it("aucune mise en page ne repose un fond plein par-dessus la trame de papier", () => {
    const fichiers = [
      "../components/ManagerLayout.tsx",
      "../components/TenantLayout.tsx",
      "../components/OwnerLayout.tsx",
      "../components/AdminLayout.tsx",
      "./VitrinePage.tsx",
      "./VitrineListingPage.tsx",
      "./LandingPage.tsx",
      "./LoginPage.tsx",
    ];
    for (const fichier of fichiers) {
      const source = readFileSync(resolve(__dirname, fichier), "utf8");
      expect(source, fichier).not.toMatch(/min-h-screen[^"]*\bbg-(canvas|slate-950)\b/);
    }
  });
});
