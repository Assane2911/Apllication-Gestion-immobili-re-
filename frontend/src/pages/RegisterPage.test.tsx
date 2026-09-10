import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import RegisterPage from "./RegisterPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/inscription"]}>
      <AuthProvider>
        <RegisterPage />
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
});
