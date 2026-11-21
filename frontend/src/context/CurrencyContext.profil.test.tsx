import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { AuthUser } from "../types";
import { AuthContext } from "./auth";
import type { AuthContextValue } from "./auth";
import { CurrencyProvider } from "./CurrencyContext";
import { useCurrency } from "./currency";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * La devise d'affichage et le profil : la devise choisie sur le profil doit gagner quand l'utilisateur se connecte, un choix
 * local déjà fait ne doit pas être écrasé au démarrage, et un serveur qui refuse la sauvegarde ne doit jamais faire perdre le
 * choix à l'écran. Une devise qui change toute seule change le sens de tous les montants affichés.
 */

const utilisateur = (extra: Partial<AuthUser> = {}): AuthUser => ({ id: "u1", email: "a@test.local", role: "MANAGER", ...extra }) as AuthUser;

function valeur(user: AuthUser | null): AuthContextValue {
  return { user, loading: false, login: vi.fn(), register: vi.fn(), loginWithGoogle: vi.fn(), verifyTwoFactor: vi.fn(), verifyEmail: vi.fn(), logout: async () => {}, refreshUser: async () => user } as unknown as AuthContextValue;
}

function Affichage() {
  const { currency, formatMoney, setCurrency } = useCurrency();
  return (
    <div>
      <span data-testid="devise">{currency}</span>
      <span data-testid="montant">{formatMoney(500)}</span>
      <button onClick={() => void setCurrency("XOF")}>Passer en FCFA</button>
    </div>
  );
}

function monter(user: AuthUser | null) {
  const rendu = render(
    <AuthContext.Provider value={valeur(user)}>
      <CurrencyProvider>
        <Affichage />
      </CurrencyProvider>
    </AuthContext.Provider>
  );
  /** Simule la connexion (ou la mise à jour du profil) : le contexte d'authentification change, pas la page. */
  const changerUtilisateur = (suivant: AuthUser | null) =>
    rendu.rerender(
      <AuthContext.Provider value={valeur(suivant)}>
        <CurrencyProvider>
          <Affichage />
        </CurrencyProvider>
      </AuthContext.Provider>
    );
  return { changerUtilisateur };
}

describe("CurrencyProvider : devise du profil et sauvegarde", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedApi.patch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("démarre sur la devise du profil quand aucun choix local n'a été fait", () => {
    monter(utilisateur({ currency: "XOF" }));

    expect(screen.getByTestId("devise")).toHaveTextContent("XOF");
    expect(screen.getByTestId("montant")).toHaveTextContent("500 FCFA");
  });

  it("un choix local déjà fait prime sur celui du profil au démarrage", () => {
    localStorage.setItem("app_currency", "EUR");

    monter(utilisateur({ currency: "XOF" }));

    expect(screen.getByTestId("devise")).toHaveTextContent("EUR");
  });

  it("à la connexion, la devise du profil remplace celle affichée et est mémorisée localement", () => {
    const { changerUtilisateur } = monter(null);
    expect(screen.getByTestId("devise")).toHaveTextContent("EUR");

    act(() => changerUtilisateur(utilisateur({ currency: "XOF" })));

    expect(screen.getByTestId("devise")).toHaveTextContent("XOF");
    expect(screen.getByTestId("montant")).toHaveTextContent("500 FCFA");
    expect(localStorage.getItem("app_currency")).toBe("XOF");
  });

  it("une mise à jour du profil sans devise ne change pas la devise affichée", () => {
    const { changerUtilisateur } = monter(utilisateur({ currency: "XOF" }));

    act(() => changerUtilisateur(utilisateur({ currency: undefined })));

    expect(screen.getByTestId("devise")).toHaveTextContent("XOF");
  });

  it("une déconnexion garde la devise affichée (elle ne revient pas à l'euro)", () => {
    const { changerUtilisateur } = monter(utilisateur({ currency: "XOF" }));

    act(() => changerUtilisateur(null));

    expect(screen.getByTestId("devise")).toHaveTextContent("XOF");
  });

  it("sans utilisateur connecté, le choix est gardé en local sans rien envoyer au serveur", async () => {
    monter(null);

    await act(async () => {
      screen.getByRole("button", { name: "Passer en FCFA" }).click();
    });

    expect(screen.getByTestId("devise")).toHaveTextContent("XOF");
    expect(localStorage.getItem("app_currency")).toBe("XOF");
    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it("le serveur refuse la sauvegarde : le choix reste à l'écran et l'échec est journalisé, sans erreur", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedApi.patch.mockRejectedValueOnce(new Error("réseau coupé"));
    monter(utilisateur({ currency: "EUR" }));

    await act(async () => {
      screen.getByRole("button", { name: "Passer en FCFA" }).click();
    });

    expect(mockedApi.patch).toHaveBeenCalledWith("/auth/currency", { currency: "XOF" });
    expect(screen.getByTestId("devise")).toHaveTextContent("XOF");
    expect(localStorage.getItem("app_currency")).toBe("XOF");
    expect(avertir).toHaveBeenCalledWith(expect.stringContaining("Impossible de sauvegarder la devise"), expect.any(Error));
  });
});
