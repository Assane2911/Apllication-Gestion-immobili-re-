import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { AgencySettings } from "../../types";
import AgencySettingsPage from "./AgencySettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function settings(overrides: Partial<AgencySettings> = {}): AgencySettings {
  return {
    id: "agency-1",
    userId: "mgr-1",
    agencyName: "Agence du Port",
    siretOrId: "849 203 194 00012",
    address: "12 Avenue des Champs-Élysées, 75008 Paris",
    phone: "+33 1 40 00 00 00",
    email: "contact@agenceduport.com",
    legalNotice: "SARL au capital de 50 000€.",
    ...overrides,
  };
}

describe("AgencySettingsPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
  });

  it("pré-remplit le formulaire avec les coordonnées existantes de l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    render(<AgencySettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    expect(screen.getByLabelText("Email de contact officiel *")).toHaveValue("contact@agenceduport.com");
    expect(screen.getByLabelText("Téléphone de l'agence")).toHaveValue("+33 1 40 00 00 00");
  });

  it("enregistre les modifications et affiche un message de succès", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockResolvedValueOnce({ data: settings({ agencyName: "Agence du Port Renommée" }) });
    render(<AgencySettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));

    await userEvent.setup().clear(screen.getByLabelText("Nom commercial de l'agence *"));
    await userEvent.setup().type(screen.getByLabelText("Nom commercial de l'agence *"), "Agence du Port Renommée");
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

    await waitFor(() =>
      expect(screen.getByText(/Paramètres de l'agence mis à jour avec succès/)).toBeInTheDocument()
    );
    expect(mockedApi.put).toHaveBeenCalledWith(
      "/agency",
      expect.objectContaining({ agencyName: "Agence du Port Renommée" })
    );
  });

  it("affiche une erreur si l'enregistrement échoue", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    render(<AgencySettingsPage />);

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });
});
