import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import TwoFactorDisableModal from "./TwoFactorDisableModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

// Même double minimal que DeleteAccountModal.test.tsx / LoginPage.test.tsx.
vi.mock("./GoogleSignInButton", () => ({
  default: ({ onCredential, onError }: { onCredential: (credential: string) => void; onError?: () => void }) => (
    <div>
      <button type="button" onClick={() => onCredential("fake-google-credential")}>
        Simuler connexion Google
      </button>
      <button type="button" onClick={() => onError?.()}>
        Simuler échec script Google
      </button>
    </div>
  ),
}));

const mockedApi = vi.mocked(api, { deep: true });

type SeedUser = { id: string; email: string; role: "MANAGER"; hasPassword?: boolean };

function renderModal(user: SeedUser) {
  localStorage.setItem("user", JSON.stringify(user));

  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <AuthProvider>
      <TwoFactorDisableModal onSuccess={onSuccess} onClose={onClose} />
    </AuthProvider>
  );
  return { onSuccess, onClose };
}

describe("TwoFactorDisableModal", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    localStorage.clear();
  });

  it("demande le mot de passe pour un compte qui en a un", () => {
    renderModal({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", hasPassword: true });
    expect(screen.getByLabelText("Ressaisissez votre mot de passe actuel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simuler connexion Google" })).not.toBeInTheDocument();
  });

  it("propose une reconnexion Google pour un compte Google-only", () => {
    renderModal({ id: "mgr-2", email: "google-manager@test.local", role: "MANAGER", hasPassword: false });
    expect(screen.getByRole("button", { name: "Simuler connexion Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Ressaisissez votre mot de passe actuel")).not.toBeInTheDocument();
  });

  it("appelle POST /auth/2fa/disable avec le mot de passe, puis onSuccess", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    const { onSuccess } = renderModal({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", hasPassword: true });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Ressaisissez votre mot de passe actuel"), "mon-mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Désactiver" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/disable", { password: "mon-mot-de-passe" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("appelle POST /auth/2fa/disable avec googleCredential pour un compte Google-only", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    const { onSuccess } = renderModal({ id: "mgr-2", email: "google-manager@test.local", role: "MANAGER", hasPassword: false });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));
    await user.click(screen.getByRole("button", { name: "Désactiver" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/disable", { googleCredential: "fake-google-credential" })
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("affiche l'erreur du serveur avec un mauvais mot de passe, sans appeler onSuccess", async () => {
    mockedApi.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Mot de passe incorrect" } } });
    const { onSuccess } = renderModal({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", hasPassword: true });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Ressaisissez votre mot de passe actuel"), "mauvais");
    await user.click(screen.getByRole("button", { name: "Désactiver" }));

    expect(await screen.findByText("Mot de passe incorrect")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("le bouton de confirmation reste désactivé tant qu'aucun mot de passe n'est saisi", () => {
    renderModal({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", hasPassword: true });
    expect(screen.getByRole("button", { name: "Désactiver" })).toBeDisabled();
  });
});
