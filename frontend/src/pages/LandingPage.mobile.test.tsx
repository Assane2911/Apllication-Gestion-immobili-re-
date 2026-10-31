import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ThemeProvider } from "../context/ThemeContext";
import { AuthProvider } from "../context/AuthContext";
import LandingPage from "./LandingPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

/**
 * En-tête de la page d'accueil sur téléphone. Sur 360 à 390 px, le logo avec son nom, le sélecteur de langue, « Se
 * connecter » et « Essai 15j gratuit → » ne tiennent pas côte à côte : le nom passait sur deux lignes par-dessus le
 * sélecteur, « Se connecter » se coupait en deux et le bouton d'essai s'étirait sur quatre lignes en dépassant de la
 * barre. Sous 640 px, l'en-tête garde l'essentiel (logo, langue en code court, connexion, essai en libellé court) ;
 * au-delà, rien ne change. jsdom ne calcule aucune mise en page : on simule la requête de média.
 */
function simulerEcran(etroit: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (requete: string) => ({
      matches: etroit && requete === "(max-width: 639px)",
      media: requete,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider><AuthProvider>
        <LandingPage />
      </AuthProvider></ThemeProvider>
    </MemoryRouter>
  );
}

describe("LandingPage — en-tête sur téléphone", () => {
  beforeEach(() => {
    vi.mocked(api, { deep: true }).get.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sur un écran étroit : langue en code court, essai en libellé court, nom de l'application réservé aux lecteurs d'écran", () => {
    simulerEcran(true);
    renderPage();
    const entete = screen.getAllByRole("navigation")[0];
    const langue = within(entete).getByLabelText("Changer de langue") as HTMLSelectElement;
    expect(Array.from(langue.options).map((o) => o.textContent)).toEqual(["🇫🇷 FR", "🇬🇧 EN", "🇵🇹 PT", "🇪🇸 ES"]);
    expect(within(entete).getByRole("link", { name: "Essai gratuit →" })).toHaveAttribute("href", "/inscription");
    expect(within(entete).queryByRole("link", { name: "Essai 15j gratuit →" })).not.toBeInTheDocument();
    const nom = within(entete).getByText("ImmoPlatform Pro");
    expect(nom.className).toMatch(/(^|\s)sr-only(\s|$)/);
    expect(nom.className).toMatch(/sm:not-sr-only/);
  });

  it("sur un écran large : rien ne change (noms de langue complets, essai de 15 jours)", () => {
    simulerEcran(false);
    renderPage();
    const entete = screen.getAllByRole("navigation")[0];
    const langue = within(entete).getByLabelText("Changer de langue") as HTMLSelectElement;
    expect(Array.from(langue.options).map((o) => o.textContent)).toEqual(["🇫🇷 Français", "🇬🇧 English", "🇵🇹 Português", "🇪🇸 Español"]);
    expect(within(entete).getByRole("link", { name: "Essai 15j gratuit →" })).toBeInTheDocument();
  });

  it("les liens de l'en-tête ne se replient pas sur plusieurs lignes", () => {
    simulerEcran(true);
    renderPage();
    const entete = screen.getAllByRole("navigation")[0];
    for (const nom of ["Se connecter", "Essai gratuit →"]) {
      expect(within(entete).getByRole("link", { name: nom }).className).toMatch(/whitespace-nowrap/);
    }
  });
});
