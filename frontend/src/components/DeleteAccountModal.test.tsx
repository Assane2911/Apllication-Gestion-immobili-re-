import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import DeleteAccountModal from "./DeleteAccountModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), delete: vi.fn() } };
});

// Même mock minimal que LoginPage.test.tsx : on ne teste pas ici le vrai
// chargement du script Google Identity Services (couvert par
// GoogleSignInButton.test.tsx), seulement le branchement de DeleteAccountModal
// selon que le compte a ou non un vrai mot de passe.
vi.mock("./GoogleSignInButton", () => ({
  default: ({
    onCredential,
    onError,
  }: {
    onCredential: (credential: string) => void;
    onError?: () => void;
  }) => (
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
  localStorage.setItem("token", "fake-token");
  localStorage.setItem("user", JSON.stringify(user));
  // AuthProvider rafraîchit via GET /auth/me au montage : on renvoie un objet
  // cohérent avec le seed localStorage pour éviter tout écart entre l'état
  // initial (synchrone) et celui posé après coup par refreshUser().
  mockedApi.get.mockResolvedValue({
    data: { ...user, tenant: null, owner: null, subscription: null },
  });

  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <AuthProvider>
      <DeleteAccountModal onSuccess={onSuccess} onClose={onClose} />
    </AuthProvider>
  );
  return { onSuccess, onClose };
}

describe("DeleteAccountModal", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.delete.mockReset();
    localStorage.clear();
  });

  it("demande le mot de passe pour un compte qui en a un (hasPassword true)", async () => {
    renderModal({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", hasPassword: true });

    expect(await screen.findByLabelText("Ressaisissez votre mot de passe actuel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simuler connexion Google" })).not.toBeInTheDocument();
  });

  it("traite l'absence de hasPassword (réponses plus anciennes) comme un compte avec mot de passe", async () => {
    renderModal({ id: "mgr-1", email: "manager@test.local", role: "MANAGER" });

    expect(await screen.findByLabelText("Ressaisissez votre mot de passe actuel")).toBeInTheDocument();
  });

  it("propose une reconnexion Google, sans champ mot de passe, pour un compte Google-only (hasPassword false)", async () => {
    renderModal({ id: "mgr-2", email: "google-manager@test.local", role: "MANAGER", hasPassword: false });

    expect(await screen.findByRole("button", { name: "Simuler connexion Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Ressaisissez votre mot de passe actuel")).not.toBeInTheDocument();
  });

  it("n'active le bouton de confirmation qu'après le mot « SUPPRIMER » ET la reconnexion Google", async () => {
    renderModal({ id: "mgr-2", email: "google-manager@test.local", role: "MANAGER", hasPassword: false });
    const user = userEvent.setup();

    const confirmButton = await screen.findByRole("button", { name: "Supprimer définitivement mon compte" });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Tapez/), "SUPPRIMER");
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));
    expect(confirmButton).toBeEnabled();
  });

  it("appelle DELETE /auth/account avec googleCredential (pas de mot de passe) pour un compte Google-only", async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: undefined });
    const { onSuccess } = renderModal({
      id: "mgr-2",
      email: "google-manager@test.local",
      role: "MANAGER",
      hasPassword: false,
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Tapez/), "SUPPRIMER");
    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement mon compte" }));

    await waitFor(() =>
      expect(mockedApi.delete).toHaveBeenCalledWith("/auth/account", {
        data: { googleCredential: "fake-google-credential" },
      })
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("affiche une erreur si le script Google échoue à charger", async () => {
    renderModal({ id: "mgr-2", email: "google-manager@test.local", role: "MANAGER", hasPassword: false });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Simuler échec script Google" }));

    expect(await screen.findByText("La connexion avec Google a échoué. Réessaie.")).toBeInTheDocument();
  });
});
