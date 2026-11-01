import { act, render, screen } from "@testing-library/react";
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

  it("évalue le nouveau mot de passe au fil de la frappe et dit en direct s'il est bien confirmé", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nouveau mot de passe"), "Abcdefghijk1!");
    expect(screen.getByRole("meter", { name: "Force du mot de passe" })).toHaveAttribute("aria-valuenow", "4");

    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "Abcdefghij");
    expect(screen.getByText("Les mots de passe diffèrent")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "k1!");
    expect(screen.getByText("Les mots de passe correspondent")).toBeInTheDocument();
  });

  it("propose de se connecter tout de suite, sans attendre la redirection", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "Password123!");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));

    await user.click(await screen.findByRole("link", { name: "Se connecter maintenant" }));
    expect(screen.getByText("Page de connexion")).toBeInTheDocument();
  });

  it("redirige vers la connexion après un court délai", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "Password123!");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "Password123!");
    await user.click(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));
    await screen.findByText("Mot de passe mis à jour");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Page de connexion")).toBeInTheDocument();
  });
});
