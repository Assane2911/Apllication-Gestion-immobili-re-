import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import type { AuthUser } from "../types";
import DemarrageAgence from "./DemarrageAgence";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Liste de démarrage du tableau de bord : identifiants légaux, premier bien, premier locataire, premier bail actif. Un repère,
 * jamais un blocage : elle disparaît quand tout est fait ou quand le gestionnaire la masque.
 */
const AUCUN = { totalProperties: 0, totalTenants: 0, activeContracts: 0 };

function noop(): never {
  throw new Error("not implemented in this test");
}

function rendre(pays: string | null, stats = AUCUN) {
  const user = { id: "m1", email: "m@test.local", role: "MANAGER", country: pays } as AuthUser;
  const auth: AuthContextValue = { user, loading: false, login: noop, register: noop, loginWithGoogle: noop, verifyTwoFactor: noop, verifyEmail: noop, logout: async () => {}, refreshUser: async () => user };
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <DemarrageAgence stats={stats} />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

const reglages = (siretOrId: string | null) => mockedApi.get.mockResolvedValue({ data: { siretOrId } });

describe("DemarrageAgence", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    try {
      localStorage.clear();
    } catch {
      // Stockage indisponible dans cet environnement : le composant le tolère aussi.
    }
  });

  it("France : quatre étapes à faire, le SIRET pour les identifiants, et le rappel du pays et de la devise", async () => {
    reglages("");
    rendre("FR");

    expect(await screen.findByText("Renseigner les identifiants légaux de l'agence")).toBeInTheDocument();
    expect(screen.getByText(/Votre SIRET\./)).toBeInTheDocument();
    expect(screen.getByText("Ajouter votre premier bien")).toBeInTheDocument();
    expect(screen.getByText("Ajouter un locataire")).toBeInTheDocument();
    expect(screen.getByText("Créer un bail actif")).toBeInTheDocument();
    expect(screen.getByText(/configurée pour France \(devise : EUR\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ouvrir" }).map((l) => l.getAttribute("href"))).toEqual(["/agency", "/properties", "/tenants", "/contracts"]);
  });

  it("Sénégal : le NINEA et le RCCM ; autre pays de la zone : le numéro d'immatriculation et l'identifiant fiscal", async () => {
    reglages(null);
    const { unmount } = rendre("SN");
    expect(await screen.findByText(/Votre NINEA et votre RCCM/)).toBeInTheDocument();
    expect(screen.getByText(/configurée pour Sénégal \(devise : XOF\)/)).toBeInTheDocument();
    unmount();

    rendre("CI");
    expect(await screen.findByText(/numéro d'immatriculation de votre agence et son identifiant fiscal/)).toBeInTheDocument();
    expect(screen.getByText(/configurée pour Côte d’Ivoire \(devise : XOF\)/)).toBeInTheDocument();
  });

  it("marque ce qui est fait et ne propose plus d'ouvrir une étape faite", async () => {
    reglages("NINEA 123");
    rendre("SN", { totalProperties: 2, totalTenants: 0, activeContracts: 0 });

    await waitFor(() => expect(screen.getAllByLabelText("Fait")).toHaveLength(2));
    expect(screen.getAllByLabelText("À faire")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Ouvrir" }).map((l) => l.getAttribute("href"))).toEqual(["/tenants", "/contracts"]);
  });

  it("disparaît quand tout est fait", async () => {
    reglages("NINEA 123");
    const { container } = rendre("SN", { totalProperties: 1, totalTenants: 1, activeContracts: 1 });

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/agency"));
    expect(container).toBeEmptyDOMElement();
  });

  it("réglages illisibles : l'étape des identifiants est omise, les trois autres restent", async () => {
    mockedApi.get.mockRejectedValue(new Error("réseau"));
    rendre("SN");

    expect(await screen.findByText("Ajouter votre premier bien")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(screen.queryByText("Renseigner les identifiants légaux de l'agence")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ouvrir" })).toHaveLength(3);
  });

  it("sans réponse des réglages (valeur vide), n'échoue pas", async () => {
    mockedApi.get.mockResolvedValue(undefined as never);
    rendre("SN");
    expect(await screen.findByText("Ajouter votre premier bien")).toBeInTheDocument();
    expect(screen.queryByText("Renseigner les identifiants légaux de l'agence")).not.toBeInTheDocument();
  });

  it("sans pays connu : le même guide, sans le rappel du pays", async () => {
    reglages("");
    rendre(null);
    expect(await screen.findByText("Pour bien démarrer")).toBeInTheDocument();
    expect(screen.getByText("Quatre gestes suffisent pour émettre vos premiers documents.")).toBeInTheDocument();
    expect(screen.queryByText(/configurée pour/)).not.toBeInTheDocument();
  });

  it("se masque, et le reste à la visite suivante sans relire les réglages", async () => {
    reglages("");
    const premiere = rendre("SN");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Masquer ce guide" }));
    expect(screen.queryByText("Pour bien démarrer")).not.toBeInTheDocument();
    premiere.unmount();

    mockedApi.get.mockClear();
    rendre("SN");
    expect(screen.queryByText("Pour bien démarrer")).not.toBeInTheDocument();
    expect(mockedApi.get).not.toHaveBeenCalled();
  });
});
