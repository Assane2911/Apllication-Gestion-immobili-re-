import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import ForgotPasswordPage from "./ForgotPasswordPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/mot-de-passe-oublie"]}>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
  });

  it("affiche un message de succès générique après l'envoi, que l'email existe ou non", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "quelqu-un@test.local");
    await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    expect(await screen.findByText("Email envoyé")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "quelqu-un@test.local" })
    );
  });

  it("affiche l'erreur du serveur en cas d'échec réseau", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await user.type(screen.getByLabelText("Email"), "quelqu-un@test.local");
    await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    expect(await screen.findByText("Erreur serveur")).toBeInTheDocument();
  });
});
