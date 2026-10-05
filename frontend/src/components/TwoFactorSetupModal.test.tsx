import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import TwoFactorSetupModal from "./TwoFactorSetupModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function renderModal() {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(<TwoFactorSetupModal onSuccess={onSuccess} onClose={onClose} />);
  return { onSuccess, onClose };
}

describe("TwoFactorSetupModal", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
  });

  it("lance l'enrôlement au montage et affiche le QR code et le secret", async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { secret: "ABCD1234EFGH5678", otpauthUrl: "otpauth://totp/...", qrCodeDataUrl: "data:image/png;base64,xxx" },
    });
    renderModal();

    expect(await screen.findByAltText("QR code de double authentification")).toBeInTheDocument();
    expect(screen.getByText("ABCD1234EFGH5678")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/setup");
  });

  it("affiche une erreur si l'enrôlement échoue, avec un bouton pour fermer", async () => {
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "La double authentification est déjà activée sur ce compte." } },
    });
    const { onClose } = renderModal();

    expect(await screen.findByText("La double authentification est déjà activée sur ce compte.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("confirme avec le code saisi, affiche les codes de secours, puis appelle onSuccess", async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { secret: "ABCD1234EFGH5678", otpauthUrl: "otpauth://totp/...", qrCodeDataUrl: "data:image/png;base64,xxx" },
    });
    const { onSuccess } = renderModal();
    const user = userEvent.setup();
    await screen.findByLabelText("Code affiché par l'application");

    mockedApi.post.mockResolvedValueOnce({
      data: { success: true, backupCodes: ["a1b2c3d4e5", "f6a7b8c9d0", "11223344aa", "bbccddeeff", "00112233aa", "aabbccddee", "9988776655", "ffeeddccbb"] },
    });
    await user.type(screen.getByLabelText("Code affiché par l'application"), "123456");
    await user.click(screen.getByRole("button", { name: "Activer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenLastCalledWith("/auth/2fa/confirm", { code: "123456" }));
    expect(await screen.findByText("a1b2c3d4e5")).toBeInTheDocument();
    expect(screen.getAllByText(/^[a-f0-9]{10}$/)).toHaveLength(8);

    await user.click(screen.getByRole("button", { name: "J'ai noté mes codes de secours" }));
    expect(onSuccess).toHaveBeenCalled();
  });

  it("affiche l'erreur du serveur pour un code incorrect, sans quitter l'étape de confirmation", async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { secret: "ABCD1234EFGH5678", otpauthUrl: "otpauth://totp/...", qrCodeDataUrl: "data:image/png;base64,xxx" },
    });
    renderModal();
    const user = userEvent.setup();
    await screen.findByLabelText("Code affiché par l'application");

    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "Code invalide. Vérifiez l'heure de votre téléphone et réessayez." } },
    });
    await user.type(screen.getByLabelText("Code affiché par l'application"), "000000");
    await user.click(screen.getByRole("button", { name: "Activer" }));

    expect(await screen.findByText("Code invalide. Vérifiez l'heure de votre téléphone et réessayez.")).toBeInTheDocument();
    expect(screen.getByLabelText("Code affiché par l'application")).toBeInTheDocument();
  });
});
