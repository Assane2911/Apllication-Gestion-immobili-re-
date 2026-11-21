import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthContext } from "../../context/auth";
import type { AuthContextValue } from "../../context/auth";
import type { AuthUser, PlatformSettings } from "../../types";
import AdminSettingsPage from "./AdminSettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

// Les deux fenêtres de double authentification sont testées à part : ici on ne vérifie que ce que la PAGE en fait
// (les ouvrir, les refermer, et relire le compte quand l'opération a réussi).
vi.mock("../../components/TwoFactorSetupModal", () => ({
  default: ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Fenêtre d'activation">
      <button onClick={onSuccess}>Activation réussie</button>
      <button onClick={onClose}>Fermer l'activation</button>
    </div>
  ),
}));
vi.mock("../../components/TwoFactorDisableModal", () => ({
  default: ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Fenêtre de désactivation">
      <button onClick={onSuccess}>Désactivation réussie</button>
      <button onClick={onClose}>Fermer la désactivation</button>
    </div>
  ),
}));

const mockedApi = vi.mocked(api, { deep: true });

/**
 * La page des réglages de la plateforme (administrateur) : le compte bancaire où les gestionnaires virent leurs abonnements et
 * la sécurité du compte administrateur. Ce qui compte ici : un chargement raté ne doit jamais laisser enregistrer du vide, un
 * enregistrement refusé ne doit pas faire croire que tout est à jour, et la double authentification doit relire le compte.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400,
    statusText: "Bad Request",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function reglages(resultat: { data: PlatformSettings } | Error) {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/admin/maintenance") return { data: { maintenance: null } };
    if (resultat instanceof Error) throw resultat;
    return resultat;
  });
}
const configures = (): { data: PlatformSettings } => ({ data: { id: "platform", iban: "FR7630001007941234567890185", bic: "BDFEFRPPXXX" } as PlatformSettings });

function afficher(twoFactorEnabled: boolean) {
  const admin: AuthUser = { id: "a1", email: "admin@test.local", role: "ADMIN", twoFactorEnabled };
  const refreshUser = vi.fn(async () => admin);
  const valeur = {
    user: admin,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    loginWithGoogle: vi.fn(),
    verifyTwoFactor: vi.fn(),
    verifyEmail: vi.fn(),
    logout: async () => {},
    refreshUser,
  } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={valeur}>
      <AdminSettingsPage />
    </AuthContext.Provider>
  );
  return { refreshUser };
}

describe("AdminSettingsPage : sécurité du compte et enregistrements", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("activation : la fenêtre se referme et le compte est relu quand elle réussit, mais pas quand on la ferme", async () => {
    const user = userEvent.setup();
    reglages(configures());
    const { refreshUser } = afficher(false);

    await user.click(await screen.findByRole("button", { name: "Activer la double authentification" }));
    await user.click(screen.getByRole("button", { name: "Fermer l'activation" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refreshUser).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Activer la double authentification" }));
    await user.click(screen.getByRole("button", { name: "Activation réussie" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it("désactivation : la fenêtre s'ouvre, se referme sans rien changer, et relit le compte quand elle réussit", async () => {
    const user = userEvent.setup();
    reglages(configures());
    const { refreshUser } = afficher(true);

    await user.click(await screen.findByRole("button", { name: "Désactiver" }));
    expect(screen.getByRole("dialog", { name: "Fenêtre de désactivation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fermer la désactivation" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refreshUser).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Désactiver" }));
    await user.click(screen.getByRole("button", { name: "Désactivation réussie" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it("chargement raté : le message du serveur remplace le formulaire (rien à écraser) et « Réessayer » recharge la page", async () => {
    const recharger = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload: recharger } as Location);
    const user = userEvent.setup();
    reglages(erreurServeur("Accès réservé aux administrateurs."));
    afficher(false);

    expect(await screen.findByText("Accès réservé aux administrateurs.")).toBeInTheDocument();
    expect(screen.queryByLabelText("IBAN de la plateforme")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it("enregistrement refusé : l'erreur du serveur est montrée, les modifications restent signalées, le bouton se débloque", async () => {
    const user = userEvent.setup();
    reglages(configures());
    mockedApi.put.mockRejectedValueOnce(erreurServeur("IBAN refusé par la banque."));
    afficher(false);
    await screen.findByText("À jour");

    await user.type(screen.getByLabelText("BIC / SWIFT"), "A");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("IBAN refusé par la banque.");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(screen.queryByText("À jour")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  });

  it("le message « enregistré » disparaît au bout de 4 secondes, et une nouvelle tentative efface l'ancienne erreur", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    reglages(configures());
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Panne temporaire."));
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    afficher(false);
    await screen.findByText("À jour");
    const formulaire = screen.getByRole("button", { name: "Enregistrer" }).closest("form")!;

    fireEvent.submit(formulaire);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne temporaire.");

    fireEvent.submit(formulaire);
    expect(await screen.findByRole("status")).toHaveTextContent("Coordonnées bancaires enregistrées");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
