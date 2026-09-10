import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "../context/AuthContext";
import VerifyEmailPage from "./VerifyEmailPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage(path = "/verifier-email?token=abc123") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/verifier-email" element={<VerifyEmailPage />} />
          <Route path="/" element={<p>Accueil</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche un message si le lien n'a pas de jeton", () => {
    renderPage("/verifier-email");
    expect(screen.getByText("Ce lien de confirmation est incomplet ou invalide.")).toBeInTheDocument();
  });

  it("affiche l'écran de succès une fois l'email confirmé", async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "tok_123", user: { id: "mgr-1", email: "agence@test.local", role: "MANAGER" } },
    });
    renderPage();

    expect(screen.getByText("Vérification en cours...")).toBeInTheDocument();
    expect(await screen.findByText("Email confirmé !")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/verify-email", { token: "abc123" });
  });

  it("affiche une erreur si le lien est invalide ou expiré", async () => {
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Ce lien a expiré" } },
      isAxiosError: true,
    });
    renderPage();

    expect(await screen.findByText("Ce lien a expiré")).toBeInTheDocument();
  });
});
