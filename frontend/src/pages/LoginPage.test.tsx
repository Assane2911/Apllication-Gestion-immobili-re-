import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import LoginPage from "./LoginPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<p>Espace gestionnaire</p>} />
          <Route path="/portail" element={<p>Espace locataire</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche le formulaire de connexion", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Gestion Immobilière" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("connecte le gestionnaire et redirige vers son tableau de bord", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_123",
        user: { id: "mgr-1", email: "agence@test.local", role: "MANAGER" },
      },
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/login", { email: "agence@test.local", password: "Password123!" });
    expect(localStorage.getItem("token")).toBe("tok_123");
  });

  it("redirige un locataire vers son portail", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: {
        token: "tok_456",
        user: { id: "tenant-1", email: "locataire@test.local", role: "TENANT" },
      },
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "locataire@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(screen.getByText("Espace locataire")).toBeInTheDocument());
  });

  it("affiche l'erreur du serveur en cas d'échec", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Email ou mot de passe incorrect" } },
      isAxiosError: true,
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "agence@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "mauvais-mdp");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(screen.getByText("Email ou mot de passe incorrect")).toBeInTheDocument());
  });

  it("propose de renvoyer l'email de confirmation quand le compte n'est pas vérifié", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Confirme ton email avant de te connecter", code: "EMAIL_NOT_VERIFIED" } },
      isAxiosError: true,
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "pas-encore-verifie@test.local");
    await user.type(screen.getByLabelText("Mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    const resendButton = await screen.findByRole("button", { name: "Renvoyer l'email de confirmation" });

    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    await user.click(resendButton);

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/auth/resend-verification", { email: "pas-encore-verifie@test.local" })
    );
    expect(await screen.findByText(/Email renvoyé/)).toBeInTheDocument();
  });
});
