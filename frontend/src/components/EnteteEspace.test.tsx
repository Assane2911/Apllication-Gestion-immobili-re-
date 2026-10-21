import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, Wrench } from "lucide-react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { ThemeContext } from "../context/theme";
import EnteteEspace from "./EnteteEspace";

/**
 * L'en-tête commun des espaces administrateur, propriétaire et locataire. Sur téléphone, les commandes (langue,
 * thème, déconnexion) et les onglets passaient à la ligne dans le désordre : trois rangées de boutons de tailles
 * différentes, des onglets sur trois lignes pour l'administrateur. Sous 640 px : UNE ligne de commandes (langue en
 * code court, déconnexion en icône) et UNE ligne d'onglets qui défile. jsdom ne calcule aucune mise en page : on
 * vérifie les classes qui portent la disposition, et on simule la requête de média.
 */
function simulerEcran(etroit: boolean) {
  vi.stubGlobal("matchMedia", (requete: string) => ({
    matches: etroit && requete === "(max-width: 639px)",
    media: requete,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

const onglets = [
  { to: "/espace", label: "Accueil", tip: "Page d'accueil", icon: Home, end: true },
  { to: "/espace/incidents", label: "Incidents", tip: "Vos incidents", icon: Wrench, end: true },
];

function Emplacement() {
  const { pathname, search } = useLocation();
  return <p data-testid="emplacement">{pathname + search}</p>;
}

function rendre(logout = async () => {}) {
  const auth = { user: { id: "u", email: "u@test.local", role: "ADMIN" }, loading: false, logout } as unknown as AuthContextValue;
  return render(
    <AuthContext.Provider value={auth}>
      <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
        <MemoryRouter initialEntries={["/espace"]}>
          <EnteteEspace largeur="4xl" titre="Mon espace" sousTitre="u@test.local" onglets={onglets} />
          <Emplacement />
        </MemoryRouter>
      </ThemeContext.Provider>
    </AuthContext.Provider>
  );
}

describe("EnteteEspace — téléphone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("langue en code court et déconnexion en icône, mais toujours nommée pour les lecteurs d'écran", () => {
    simulerEcran(true);
    rendre();
    const langue = screen.getByLabelText("Changer de langue") as HTMLSelectElement;
    expect(Array.from(langue.options).map((o) => o.textContent)).toEqual(["🇫🇷 FR", "🇬🇧 EN", "🇵🇹 PT", "🇪🇸 ES"]);
    const bouton = screen.getByRole("button", { name: "Se déconnecter" });
    expect(within(bouton).getByText("Se déconnecter").className).toMatch(/(^|\s)sr-only(\s|$)/);
    expect(within(bouton).getByText("Se déconnecter").className).toMatch(/sm:not-sr-only/);
  });

  it("sur un écran large, les noms de langue restent complets", () => {
    simulerEcran(false);
    rendre();
    const langue = screen.getByLabelText("Changer de langue") as HTMLSelectElement;
    expect(Array.from(langue.options).map((o) => o.textContent)).toEqual(["🇫🇷 Français", "🇬🇧 English", "🇵🇹 Português", "🇪🇸 Español"]);
  });

  it("les commandes tiennent sur une ligne : la zone du titre se réduit (texte tronqué) au lieu de renvoyer les boutons à la ligne", () => {
    rendre();
    const titre = screen.getByRole("heading", { name: "Mon espace" });
    expect(titre.className).toMatch(/truncate/);
    expect(titre.parentElement!.parentElement!.className).toMatch(/min-w-0/);
    const ligne = screen.getByRole("button", { name: "Se déconnecter" }).closest(".flex-wrap")!;
    expect(ligne.className).toMatch(/shrink-0/);
    expect(ligne.parentElement!.className).not.toMatch(/flex-wrap/);
  });

  it("les onglets forment une seule rangée qui défile, sans retour à la ligne ni écrasement", () => {
    rendre();
    const barre = screen.getByRole("navigation", { name: "Mon espace" });
    expect(barre.className).toMatch(/overflow-x-auto/);
    expect(barre.className).not.toMatch(/flex-wrap/);
    for (const lien of within(barre).getAllByRole("link")) {
      expect(lien.className).toMatch(/shrink-0/);
      expect(lien.className).toMatch(/whitespace-nowrap/);
    }
  });

  it("l'onglet actif est ramené dans la zone visible quand la rangée défile", () => {
    const defiler = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = defiler;
    try {
      rendre();
      expect(defiler).toHaveBeenCalledWith({ block: "nearest", inline: "center" });
      expect(defiler.mock.instances[0]).toBe(screen.getByRole("link", { name: "Accueil" }));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("l'en-tête reste en haut de l'écran pendant le défilement", () => {
    rendre();
    expect(screen.getByRole("banner").className).toMatch(/sticky top-0/);
  });

  it("Retour et Suivant précèdent les onglets, hors de la rangée qui défile", () => {
    rendre();
    const retour = screen.getByRole("button", { name: "Retour" });
    const suivant = screen.getByRole("button", { name: "Suivant" });
    const barre = screen.getByRole("navigation", { name: "Mon espace" });
    expect(barre).not.toContainElement(retour);
    expect(barre).not.toContainElement(suivant);
    // Même rangée que les onglets, placés avant eux.
    expect(retour.closest("div")!.parentElement).toBe(barre.parentElement);
    expect(retour.compareDocumentPosition(barre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(barre.className).toMatch(/min-w-0/);
  });

  it("la déconnexion passe par une confirmation, rendue hors de l'en-tête", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    rendre(logout);

    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    const fenetre = screen.getByRole("dialog", { name: "Se déconnecter ?" });
    expect(logout).not.toHaveBeenCalled();
    // Le flou d'arrière-plan de l'en-tête ferait de lui le repère d'un élément en `fixed` : la fenêtre est à côté, pas dedans.
    expect(screen.getByRole("banner")).not.toContainElement(fenetre);

    await user.click(within(fenetre).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Se déconnecter" }));
    expect(logout).toHaveBeenCalledTimes(1);
    // Une fois la session fermée, la page de connexion confirme la déconnexion (?deconnecte=1).
    await waitFor(() => expect(screen.getByTestId("emplacement")).toHaveTextContent("/login?deconnecte=1"));
  });
});

