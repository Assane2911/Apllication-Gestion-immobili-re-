import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthContext } from "../../context/auth";
import type { AuthContextValue } from "../../context/auth";
import type { AuthUser } from "../../types";
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
 * La page des réglages de la plateforme (administrateur) : la sécurité du compte administrateur et la maintenance planifiée.
 * Ce qui compte ici : la double authentification doit relire le compte quand elle réussit, et pas quand on ferme la fenêtre.
 */

function maintenanceAbsente() {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/admin/maintenance") return { data: { maintenance: null } };
    throw new Error(`appel inattendu : ${url}`);
  });
}

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
    maintenanceAbsente();
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
    maintenanceAbsente();
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
});
