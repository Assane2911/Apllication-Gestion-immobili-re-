import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import type { AuthUser } from "../types";
import { definirEtat, reinitialiserEtat } from "../utils/maintenance";
import PorteMaintenance from "./PorteMaintenance";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const get = vi.mocked(api.get);

const H = 3_600_000;
const fenetre = (debutMs: number, finMs: number, message: string | null = null) => ({ debut: new Date(Date.now() + debutMs).toISOString(), fin: new Date(Date.now() + finMs).toISOString(), message });

function noop(): never {
  throw new Error("non utilisé");
}
const auth = (user: AuthUser | null): AuthContextValue => ({ user, loading: false, login: noop, register: noop, loginWithGoogle: noop, verifyTwoFactor: noop, verifyEmail: noop, logout: async () => {}, refreshUser: async () => user as AuthUser });
const gestionnaire: AuthUser = { id: "m1", email: "agence@test.local", role: "MANAGER" };
const administrateur: AuthUser = { id: "a1", email: "admin@test.local", role: "ADMIN" };

/** `serveur` : ce que répond /maintenance ; l'état initial du magasin est posé séparément pour ne pas attendre le premier tour. */
function afficher(serveur: unknown, user: AuthUser | null = gestionnaire, chemin = "/dashboard") {
  get.mockResolvedValue({ data: { maintenance: serveur } });
  return render(
    <MemoryRouter initialEntries={[chemin]}>
      <AuthContext.Provider value={auth(user)}>
        <PorteMaintenance>
          <p>Contenu de l'application</p>
        </PorteMaintenance>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  reinitialiserEtat();
  get.mockReset();
  sessionStorage.clear();
});
afterEach(() => reinitialiserEtat());

describe("PorteMaintenance — pendant la maintenance", () => {
  it("remplace l'application par l'écran de maintenance, avec le message de l'équipe et l'heure de retour", async () => {
    afficher(fenetre(-H, H, "Mise à niveau de la base"));
    expect(await screen.findByRole("heading", { name: "Nous revenons très vite" })).toBeInTheDocument();
    expect(screen.getByText("Mise à niveau de la base")).toBeInTheDocument();
    expect(screen.getByText("Retour prévu")).toBeInTheDocument();
    expect(screen.queryByText("Contenu de l'application")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accès administrateur" })).toHaveAttribute("href", "/login");
  });

  it("l'écran vaut pour toutes les pages, y compris l'accueil public et l'inscription", async () => {
    for (const chemin of ["/", "/inscription", "/portail", "/proprietaire/messages"]) {
      const { unmount } = afficher(fenetre(-H, H), null, chemin);
      expect(await screen.findByRole("heading", { name: "Nous revenons très vite" })).toBeInTheDocument();
      unmount();
      reinitialiserEtat();
    }
  });

  it("laisse accessibles la connexion (pour que l'administrateur entre) et les textes légaux", async () => {
    for (const chemin of ["/login", "/cgu", "/mentions-legales", "/confidentialite"]) {
      const { unmount } = afficher(fenetre(-H, H), null, chemin);
      await waitFor(() => expect(get).toHaveBeenCalled());
      expect(await screen.findByText("Contenu de l'application")).toBeInTheDocument();
      unmount();
      reinitialiserEtat();
      get.mockClear();
    }
  });

  it("l'administrateur garde l'application, avec un bandeau qui le lui rappelle et mène aux réglages", async () => {
    afficher(fenetre(-H, H), administrateur, "/admin/parametres");
    expect(await screen.findByText("Contenu de l'application")).toBeInTheDocument();
    expect(await screen.findByText("Maintenance en cours")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gérer la maintenance" })).toHaveAttribute("href", "/admin/parametres");
    expect(screen.queryByRole("button", { name: "Fermer l'annonce" })).not.toBeInTheDocument();
  });

  it("une réponse 503 reçue ailleurs (intercepteur) fait apparaître l'écran tout de suite", async () => {
    afficher(null);
    expect(await screen.findByText("Contenu de l'application")).toBeInTheDocument();
    await act(async () => { definirEtat(fenetre(-1000, H)); });
    expect(await screen.findByRole("heading", { name: "Nous revenons très vite" })).toBeInTheDocument();
  });

  it("« Vérifier maintenant » relit l'état, et à la fin de la maintenance recharge la page pour repartir sur des données fraîches", async () => {
    const recharger = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: recharger });
    afficher(fenetre(-H, H));
    const bouton = await screen.findByRole("button", { name: "Vérifier maintenant" });
    expect(recharger).not.toHaveBeenCalled();

    get.mockResolvedValue({ data: { maintenance: null } }); // l'administrateur l'a terminée
    await userEvent.setup().click(bouton);
    await waitFor(() => expect(recharger).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });
});

describe("PorteMaintenance — avant et sans maintenance", () => {
  it("sans maintenance, n'affiche que l'application, sans bandeau", async () => {
    afficher(null);
    expect(await screen.findByText("Contenu de l'application")).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("annonce une maintenance dans les 24 h, avec ses horaires et son message, sans bloquer l'application", async () => {
    afficher(fenetre(2 * H, 3 * H, "Sauvegarde annuelle"));
    const annonce = await screen.findByRole("status", { name: "Maintenance prévue" });
    expect(annonce).toHaveTextContent("Sauvegarde annuelle");
    expect(annonce).toHaveTextContent("Enregistrez votre travail");
    expect(screen.getByText("Contenu de l'application")).toBeInTheDocument();
  });

  it("n'annonce pas une maintenance lointaine : elle viendra en son temps", async () => {
    afficher(fenetre(5 * 24 * H, 5 * 24 * H + H));
    await screen.findByText("Contenu de l'application");
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("l'annonce se ferme pour la session, et ne reparaît pas à l'affichage suivant", async () => {
    const un = afficher(fenetre(2 * H, 3 * H));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Fermer l'annonce" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    un.unmount();
    reinitialiserEtat();

    // Même fenêtre (même début) : déjà fermée dans cette session. On rejoue exactement la même.
    const f = fenetre(2 * H, 3 * H);
    sessionStorage.setItem(`maintenance-annoncee:${f.debut}`, "1");
    afficher(f);
    await screen.findByText("Contenu de l'application");
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
