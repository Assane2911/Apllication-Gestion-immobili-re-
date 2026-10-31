import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyProvider } from "../context/CurrencyContext";
import type { AuthUser } from "../types";
import { traiterRetourSurCouche } from "../utils/couchesRetour";
import ManagerLayout from "./ManagerLayout";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: { get: vi.fn().mockResolvedValue({ data: { notifications: [], count: 0, unseenCount: 0, unreadCount: 0, results: [] } }), post: vi.fn() },
  };
});

function noop(): never {
  throw new Error("not implemented in this test");
}

const gestionnaire: AuthUser = { id: "m1", email: "gestionnaire@test.local", role: "MANAGER" };
const abonnement = (plan: "STARTER" | "PRO" | "ENTERPRISE", essai = false): NonNullable<AuthUser["subscription"]> => ({
  status: essai ? "TRIAL" : "ACTIVE",
  plan,
  trialDaysRemaining: essai ? 10 : 0,
  isTrialActive: essai,
  isSubscriptionActive: !essai,
  isExpired: false,
});
const agence: AuthUser = { ...gestionnaire, id: "m2", subscription: abonnement("ENTERPRISE") };

function authValue(user: AuthUser | null, logout: () => Promise<void> = async () => {}): AuthContextValue {
  return {
    user,
    loading: false,
    login: noop,
    register: noop,
    loginWithGoogle: noop,
    verifyTwoFactor: noop,
    verifyEmail: noop,
    logout,
    refreshUser: async () => user,
  };
}

function renderManagerLayout(entree: string, utilisateur: AuthUser = gestionnaire, logout?: () => Promise<void>) {
  return render(
    <AuthContext.Provider value={authValue(utilisateur, logout)}>
      <CurrencyProvider>
          <MemoryRouter initialEntries={[entree]}>
            <Routes>
              <Route path="/login" element={<div>Page de connexion</div>} />
              <Route element={<ManagerLayout />}>
                <Route path="/dashboard" element={<div>Tableau</div>} />
                <Route path="/tenants" element={<div>Locataires</div>} />
                <Route path="/proprietaires/:ownerId/crg" element={<div>CRG</div>} />
                <Route path="/proprietaires" element={<div>Propriétaires</div>} />
                <Route path="/guide-demarrage" element={<div>Guide</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
      </CurrencyProvider>
    </AuthContext.Provider>
  );
}

describe("ManagerLayout — titre de l'onglet", () => {
  it("porte le nom de la page affichée, pour qu'un changement de page soit annoncé et reconnaissable", () => {
    renderManagerLayout("/tenants");
    expect(document.title).toBe("Locataires | ImmoPlatform Pro");
  });

  it("suit la page quand on passe d'une entrée de navigation à une autre", () => {
    const { unmount } = renderManagerLayout("/dashboard");
    expect(document.title).toBe("Tableau de bord | ImmoPlatform Pro");
    unmount();
    renderManagerLayout("/proprietaires");
    expect(document.title).toBe("Propriétaires | ImmoPlatform Pro");
  });

  it("le compte-rendu de gestion d'un propriétaire a son propre libellé, pas celui de la liste", () => {
    renderManagerLayout("/proprietaires/abc123/crg");
    expect(document.title).toBe("Compte-rendu de gestion | ImmoPlatform Pro");
  });

  it("le guide de démarrage n'est plus dans le menu latéral : un seul accès, à côté de « Une suggestion ? »", () => {
    renderManagerLayout("/dashboard", agence);
    const menu = screen.getByRole("navigation");
    expect(within(menu).queryByRole("link", { name: "Guide de démarrage" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Guide de démarrage" })).toHaveLength(1);
  });

  it("le raccourci du guide est visible pendant l'essai gratuit, quelle que soit la formule par défaut du compte", () => {
    renderManagerLayout("/dashboard", { ...gestionnaire, subscription: abonnement("STARTER", true) });
    const suggestion = screen.getByRole("button", { name: /suggestion/i });
    const raccourci = screen.getByRole("link", { name: "Guide de démarrage" });
    expect(suggestion.parentElement).toContainElement(raccourci);
    expect(raccourci).toHaveAttribute("href", "/guide-demarrage");
  });

  it("la page du guide titre toujours l'onglet, bien qu'elle ne soit plus dans le menu", () => {
    renderManagerLayout("/guide-demarrage", agence);
    expect(document.title).toBe("Guide de démarrage | ImmoPlatform Pro");
  });

  it.each([
    ["sans abonnement chargé", gestionnaire],
    ["Starter", { ...gestionnaire, subscription: abonnement("STARTER") }],
    ["Professionnel", { ...gestionnaire, subscription: abonnement("PRO") }],
    ["essai terminé", { ...gestionnaire, subscription: { ...abonnement("STARTER"), status: "EXPIRED" as const, isSubscriptionActive: false, isExpired: true } }],
  ])("le raccourci du guide n'apparaît pas : %s", (_nom, utilisateur) => {
    renderManagerLayout("/dashboard", utilisateur as AuthUser);
    expect(screen.queryByRole("link", { name: "Guide de démarrage" })).not.toBeInTheDocument();
  });

  it("la recherche globale a un nom accessible, pas seulement un texte d'exemple", () => {
    renderManagerLayout("/dashboard");
    expect(screen.getByRole("textbox", { name: "Recherche globale" })).toBeInTheDocument();
  });
});

/**
 * Sur un téléphone, `100vh` est la hauteur de l'écran SANS la barre d'adresse du navigateur : une barre latérale
 * en `h-screen` dépasse alors le bas de l'écran visible, et le pied du menu (compte, déconnexion) reste hors de
 * vue. La hauteur dynamique (`dvh`) suit l'écran réellement visible. jsdom ne calcule aucune mise en page : ces
 * contrôles lisent donc les classes qui portent le correctif.
 */
describe("ManagerLayout — menu sur téléphone", () => {
  it("la barre latérale suit la hauteur visible de l'écran, pour que « Se déconnecter » reste atteignable", () => {
    const { container } = renderManagerLayout("/dashboard");
    const barre = container.querySelector("aside")!;
    expect(barre.className).toMatch(/(^|\s)h-dvh(\s|$)/);
    expect(barre.className).not.toMatch(/(^|\s)h-screen(\s|$)/);
  });

  it("le bouton de déconnexion est dans le pied du menu, qui ne rétrécit pas et respecte la zone de sécurité du bas", () => {
    const { container } = renderManagerLayout("/dashboard");
    const barre = container.querySelector("aside")!;
    const bouton = within(barre).getByRole("button", { name: "Se déconnecter" });
    const pied = bouton.parentElement!;
    expect(pied.className).toMatch(/shrink-0/);
    expect(pied.className).toMatch(/safe-area-inset-bottom/);
  });

  it("le sélecteur de monnaie reste dans la largeur du menu, même avec son libellé le plus long", () => {
    const { container } = renderManagerLayout("/dashboard");
    const barre = container.querySelector("aside")!;
    const select = within(barre).getByLabelText("Monnaie de règlement");
    expect(select.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect(select.className).toMatch(/min-w-0/);
    // Tous les conteneurs jusqu'au menu laissent le sélecteur se réduire à leur largeur.
    for (let noeud = select.parentElement; noeud && noeud !== barre; noeud = noeud.parentElement) {
      if (noeud.tagName === "DIV" && noeud.className.includes("border-t")) break;
      expect(noeud.className).toMatch(/(^|\s)(w-full|contents)(\s|$)/);
    }
  });

  it("le sélecteur de langue suit la même règle", () => {
    const { container } = renderManagerLayout("/dashboard");
    const select = within(container.querySelector("aside")!).getByLabelText("Changer de langue");
    expect(select.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect(select.className).toMatch(/min-w-0/);
  });
});

describe("ManagerLayout — navigation Retour / Suivant", () => {
  it("la barre du haut propose Retour et Suivant (le menu latéral n'en contient pas)", () => {
    const { container } = renderManagerLayout("/dashboard");
    const barre = container.querySelector("aside")!;
    expect(within(barre).queryByRole("button", { name: "Retour" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeInTheDocument();
  });
});

describe("ManagerLayout — bouton retour d'Android", () => {
  it("le menu ouvert sur téléphone se referme avec le bouton retour, avant toute navigation", async () => {
    const { container } = renderManagerLayout("/dashboard");
    const barre = container.querySelector("aside")!;
    expect(barre.className).toMatch(/-translate-x-full/);
    expect(traiterRetourSurCouche()).toBe(false);

    await userEvent.setup().click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    expect(barre.className).toMatch(/translate-x-0/);

    expect(traiterRetourSurCouche()).toBe(true);
    // Le menu se referme, puis React retire la couche dans un second temps (nettoyage d'effet différé) : on attend
    // l'un et l'autre plutôt que de supposer que le retrait a déjà eu lieu quand la classe change. Les délais sont
    // larges : la suite complète tourne en parallèle sur une machine chargée.
    await waitFor(() => expect(barre.className).toMatch(/-translate-x-full/), { timeout: 4000 });
    await waitFor(() => expect(traiterRetourSurCouche()).toBe(false), { timeout: 4000 });
  });
});

describe("ManagerLayout — confirmation de déconnexion", () => {
  it("le bouton du menu demande confirmation ; la fenêtre est hors de la barre latérale (qui est transformée)", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    const { container } = renderManagerLayout("/dashboard", gestionnaire, logout);
    const barre = container.querySelector("aside")!;

    await user.click(within(barre).getByRole("button", { name: "Se déconnecter" }));
    const fenetre = screen.getByRole("dialog", { name: "Se déconnecter ?" });
    expect(logout).not.toHaveBeenCalled();
    expect(barre).not.toContainElement(fenetre);

    await user.click(within(fenetre).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    await user.click(within(barre).getByRole("button", { name: "Se déconnecter" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Se déconnecter" }));
    expect(logout).toHaveBeenCalledTimes(1);
    // Après la fermeture de la session, on arrive sur la page de connexion.
    expect(await screen.findByText("Page de connexion")).toBeInTheDocument();
  });
});

