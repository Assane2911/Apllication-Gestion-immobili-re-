import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import RegisterPage from "./RegisterPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

// Même double minimal que LoginPage.test.tsx — voir son commentaire.
vi.mock("../components/GoogleSignInButton", () => ({
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/inscription"]}>
      <AuthProvider>
        <Routes>
          <Route path="/inscription" element={<RegisterPage />} />
          <Route path="/dashboard" element={<p>Espace gestionnaire</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, password = "Password123!", confirm = password) {
  await user.type(screen.getByLabelText("Email"), "nouvelle-agence@test.local");
  await user.type(screen.getByLabelText("Mot de passe"), password);
  await user.type(screen.getByLabelText("Confirmer le mot de passe"), confirm);
}

describe("RegisterPage", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
  });

  it("affiche le formulaire d'inscription", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Créer un compte" })).toBeInTheDocument();
  });

  it("refuse si les deux mots de passe ne correspondent pas, sans appeler l'API", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillForm(user, "Password123!", "Autrechose1!");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Les deux mots de passe ne correspondent pas.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("refuse un mot de passe trop court, sans appeler l'API", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillForm(user, "court12", "court12");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Le mot de passe doit contenir au moins 8 caractères.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("inscrit le gestionnaire et affiche l'écran d'attente de confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { pendingVerification: true, email: "nouvelle-agence@test.local" } });
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Vérifie ta boîte mail")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/register", {
      email: "nouvelle-agence@test.local",
      password: "Password123!",
    });
  });

  it("affiche l'erreur du serveur (ex: email déjà utilisé)", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Cet email est déjà utilisé" } },
      isAxiosError: true,
    });
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByText("Cet email est déjà utilisé")).toBeInTheDocument();
  });

  it("ne montre pas le bouton Google si VITE_GOOGLE_CLIENT_ID n'est pas configuré", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Simuler connexion Google" })).not.toBeInTheDocument();
  });
});

describe("RegisterPage — inscription avec Google (VITE_GOOGLE_CLIENT_ID configuré)", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("affiche le bouton Google", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Simuler connexion Google" })).toBeInTheDocument();
  });

  it("crée le compte gestionnaire via Google (email déjà vérifié) et redirige directement, sans écran d'attente", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_google_reg",
        user: { id: "mgr-google-2", email: "nouvelle-agence-google@test.local", role: "MANAGER" },
      },
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/google", { credential: "fake-google-credential" });
    expect(screen.queryByText("Vérifie ta boîte mail")).not.toBeInTheDocument();
  });

  it("affiche l'erreur du serveur si la connexion Google est refusée", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: {
        data: { error: "La connexion avec Google est réservée aux comptes gestionnaire", code: "GOOGLE_LOGIN_WRONG_ROLE" },
      },
      isAxiosError: true,
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler connexion Google" }));

    expect(await screen.findByText("La connexion avec Google est réservée aux comptes gestionnaire")).toBeInTheDocument();
  });

  it("affiche un message d'erreur si le script Google échoue à charger", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Simuler échec script Google" }));

    expect(await screen.findByText("La connexion avec Google a échoué. Réessaie.")).toBeInTheDocument();
  });
});
