import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { PlatformSettings } from "../../types";
import AdminSettingsPage from "./AdminSettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function settings(overrides: Partial<PlatformSettings> = {}): PlatformSettings {
  return {
    id: "platform",
    iban: null,
    bic: null,
    ...overrides,
  };
}

describe("AdminSettingsPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
  });

  it("pré-remplit le formulaire avec l'IBAN et le BIC déjà configurés", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: settings({ iban: "FR7630001007941234567890185", bic: "BDFEFRPPXXX" }),
    });
    render(<AdminSettingsPage />);

    await waitFor(() =>
      expect(screen.getByLabelText("IBAN de la plateforme")).toHaveValue("FR7630001007941234567890185")
    );
    expect(screen.getByLabelText("BIC / SWIFT")).toHaveValue("BDFEFRPPXXX");
  });

  it("laisse le formulaire vide quand rien n'est encore configuré", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    render(<AdminSettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("IBAN de la plateforme")).toBeInTheDocument());
    expect(screen.getByLabelText("IBAN de la plateforme")).toHaveValue("");
    expect(screen.getByLabelText("BIC / SWIFT")).toHaveValue("");
  });

  it("enregistre l'IBAN et le BIC saisis et affiche un message de succès", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockResolvedValueOnce({
      data: settings({ iban: "FR7630001007941234567890185", bic: "BDFEFRPPXXX" }),
    });
    render(<AdminSettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("IBAN de la plateforme")).toBeInTheDocument());
    await user.type(screen.getByLabelText("IBAN de la plateforme"), "FR7630001007941234567890185");
    await user.type(screen.getByLabelText("BIC / SWIFT"), "BDFEFRPPXXX");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith("/admin/settings", {
        iban: "FR7630001007941234567890185",
        bic: "BDFEFRPPXXX",
      })
    );
    await waitFor(() => expect(screen.getByText("Coordonnées bancaires enregistrées")).toBeInTheDocument());
  });

  it("affiche l'erreur du serveur quand l'IBAN saisi est invalide", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockRejectedValueOnce({
      response: { data: { error: "Requête invalide : données manquantes ou incorrectes (champ concerné : iban)." } },
      isAxiosError: true,
    });
    render(<AdminSettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("IBAN de la plateforme")).toBeInTheDocument());
    await user.type(screen.getByLabelText("IBAN de la plateforme"), "FR00INVALIDE");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(screen.getByText(/champ concerné : iban/)).toBeInTheDocument());
  });

  it("affiche une erreur générique si l'enregistrement échoue", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    render(<AdminSettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("IBAN de la plateforme")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });
});
