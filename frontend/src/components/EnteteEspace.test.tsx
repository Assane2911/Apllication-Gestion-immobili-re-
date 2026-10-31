import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, Wrench } from "lucide-react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
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
        <MemoryRouter initialEntries={["/espace"]}>
          <EnteteEspace largeur="4xl" titre="Mon espace" sousTitre="u@test.local" onglets={onglets} />
          <Emplacement />
        </MemoryRouter>
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

  /**
   * Un fondu à droite signalait les onglets cachés de ce côté. Mais l'onglet actif est ramené au centre : sur la
   * page « Compte-rendu de gestion » du propriétaire, ou « Incidents » du locataire, la rangée défile et c'est le
   * premier onglet, à GAUCHE, qui est caché en partie, coupé net sans aucun fondu, comme un défaut d'affichage
   * (constaté sur les captures, aucun téléphone n'a la place pour tous les onglets). Le fondu suit désormais la
   * position : du côté où des onglets sont cachés, et seulement de ce côté.
   */
  describe("fondus de la rangée d'onglets, selon la position", () => {
    function placer(barre: HTMLElement, mesures: { visible: number; total: number; position: number }) {
      Object.defineProperty(barre, "clientWidth", { configurable: true, value: mesures.visible });
      Object.defineProperty(barre, "scrollWidth", { configurable: true, value: mesures.total });
      Object.defineProperty(barre, "scrollLeft", { configurable: true, value: mesures.position });
      fireEvent.scroll(barre);
    }
    const FONDU_GAUCHE = /mask-\[linear-gradient\(to_right,transparent,black_1\.5rem/;
    const FONDU_DROITE = /black_calc\(100%-1\.5rem\),transparent\)\]/;

    it("au début de la rangée : fondu à droite seulement", () => {
      rendre();
      const barre = screen.getByRole("navigation", { name: "Mon espace" });
      placer(barre, { visible: 250, total: 400, position: 0 });
      expect(barre.className).toMatch(FONDU_DROITE);
      expect(barre.className).not.toMatch(FONDU_GAUCHE);
    });

    it("au milieu : fondu des deux côtés", () => {
      rendre();
      const barre = screen.getByRole("navigation", { name: "Mon espace" });
      placer(barre, { visible: 250, total: 400, position: 80 });
      expect(barre.className).toMatch(FONDU_GAUCHE);
      expect(barre.className).toMatch(FONDU_DROITE);
    });

    it("à la fin (l'onglet actif est le dernier) : fondu à gauche, plus de coupure nette", () => {
      rendre();
      const barre = screen.getByRole("navigation", { name: "Mon espace" });
      placer(barre, { visible: 250, total: 400, position: 150 });
      expect(barre.className).toMatch(FONDU_GAUCHE);
      expect(barre.className).not.toMatch(FONDU_DROITE);
    });

    it("pas de marge à droite de la rangée : elle ne servait qu'à sortir le dernier onglet du fondu permanent", () => {
      // Avec le fondu permanent, une marge de 2 rem permettait de faire défiler le dernier onglet hors du fondu. Le
      // fondu ne s'affiche plus qu'à côté d'onglets cachés : la marge, elle, faisait défiler une rangée qui tenait
      // (propriétaire à 405 px : 268 px d'onglets dans 289 px, « Tableau de bord » rogné de 11 px).
      rendre();
      expect(screen.getByRole("navigation", { name: "Mon espace" }).className).not.toMatch(/(^|\s)(max-sm:)?pr-/);
    });

    it("quand tout tient, aucun fondu", () => {
      rendre();
      const barre = screen.getByRole("navigation", { name: "Mon espace" });
      placer(barre, { visible: 400, total: 400, position: 0 });
      expect(barre.className).not.toMatch(FONDU_GAUCHE);
      expect(barre.className).not.toMatch(FONDU_DROITE);
    });
  });

  /**
   * « Compte-rendu de gestion » ne laissait la place au premier onglet sur aucun téléphone. Un intitulé court est
   * affiché sur téléphone ; le lien garde son nom complet pour les lecteurs d'écran.
   */
  describe("intitulé court sur téléphone", () => {
    function rendreAvecIntituleCourt() {
      const auth = { user: { id: "u", email: "u@test.local", role: "OWNER" }, loading: false, logout: async () => {} } as unknown as AuthContextValue;
      return render(
        <AuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={["/espace/crg"]}>
              <EnteteEspace
                largeur="4xl"
                titre="Mon espace"
                onglets={[...onglets, { to: "/espace/crg", label: "Compte-rendu de gestion", labelCourt: "Compte-rendu", tip: "Le détail", icon: Home, end: true }]}
              />
            </MemoryRouter>
        </AuthContext.Provider>
      );
    }

    it("sur téléphone, l'onglet affiche l'intitulé court mais garde son nom complet", () => {
      simulerEcran(true);
      rendreAvecIntituleCourt();
      const lien = screen.getByRole("link", { name: "Compte-rendu de gestion" });
      expect(lien).toHaveTextContent(/^Compte-rendu$/);
    });

    it("sur un écran large, l'intitulé reste complet", () => {
      simulerEcran(false);
      rendreAvecIntituleCourt();
      const lien = screen.getByRole("link", { name: "Compte-rendu de gestion" });
      expect(lien).toHaveTextContent(/^Compte-rendu de gestion$/);
      expect(lien).not.toHaveAttribute("aria-label");
    });

    it("sans intitulé court, rien ne change sur téléphone", () => {
      simulerEcran(true);
      rendreAvecIntituleCourt();
      const lien = screen.getByRole("link", { name: "Incidents" });
      expect(lien).toHaveTextContent(/^Incidents$/);
      expect(lien).not.toHaveAttribute("aria-label");
    });
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

