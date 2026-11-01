import { act, render, screen, waitFor } from "@testing-library/react";
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
    vi.useRealTimers();
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

  it("rappelle l'adresse saisie une fois le lien envoyé, et permet d'en changer", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();
    await user.type(screen.getByLabelText("Email"), "quelqu-un@test.local");
    await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    expect(await screen.findByText("Envoyé à quelqu-un@test.local")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Utiliser une autre adresse" }));
    expect(screen.getByLabelText("Email")).toHaveValue("quelqu-un@test.local");
  });

  it("n'autorise le renvoi qu'après un délai, puis redemande le lien", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockedApi.post.mockResolvedValue({ data: { success: true } });
    renderPage();
    await user.type(screen.getByLabelText("Email"), "quelqu-un@test.local");
    await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    const bouton = await screen.findByRole("button", { name: /Renvoyer dans \d+ s/ });
    expect(bouton).toBeDisabled();

    // Le compte à rebours avance d'une seconde à la fois : React doit se mettre à jour entre deux tics.
    for (let seconde = 0; seconde < 31; seconde++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    const renvoyer = screen.getByRole("button", { name: "Renvoyer le lien" });
    expect(renvoyer).toBeEnabled();

    await user.click(renvoyer);
    expect(await screen.findByText("Un nouveau lien vient d'être envoyé.")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    // Le délai repart après chaque envoi.
    expect(screen.getByRole("button", { name: /Renvoyer dans \d+ s/ })).toBeDisabled();
  });
});
