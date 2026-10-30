import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import ResetPasswordPage from "./ResetPasswordPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage(path = "/reinitialiser-mot-de-passe?token=abc123") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>Page de connexion</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
    vi.useRealTimers();
  });

  it("affiche un message si le lien n'a pas de jeton", () => {
    renderPage("/reinitialiser-mot-de-passe");
    expect(screen.getByText("Ce lien de réinitialisation est incomplet ou invalide.")).toBeInTheDocument();
  });

  it("refuse si les deux mots de passe ne correspondent pas", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Nouveau mot de passe"), "Password123!");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "Autrechose1!");
    await user.click(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));

    expect(await screen.findByText("Les deux mots de passe ne correspondent pas.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("réinitialise le mot de passe avec le jeton de l'URL", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();

    await user.type(screen.getByLabelText("Nouveau mot de passe"), "Password123!");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));

    expect(await screen.findByText("Mot de passe mis à jour")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/reset-password", { token: "abc123", password: "Password123!" });
  });

  it("affiche l'erreur du serveur (ex: lien expiré)", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Ce lien a expiré" } },
      isAxiosError: true,
    });
    renderPage();

    await user.type(screen.getByLabelText("Nouveau mot de passe"), "Password123!");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));

    expect(await screen.findByText("Ce lien a expiré")).toBeInTheDocument();
  });
});
