import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import AgencySettingsPage from "./AgencySettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

/**
 * Un formulaire vide ne veut pas dire « rien à conserver ».
 *
 * Le chargement des paramètres n'avait aucun `catch` : une panne réseau
 * affichait le formulaire VIDE, indiscernable d'une agence jamais renseignée.
 * Le gestionnaire retapait les deux champs obligatoires, enregistrait, et le
 * PUT écrasait IBAN, BIC, adresse et mentions légales par des chaînes vides.
 * Une perte de données définitive, causée par une coupure passagère.
 */
describe("Paramètres d'agence — échec de chargement", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
    localStorage.clear();
  });

  it("n'affiche aucun formulaire modifiable quand les paramètres n'ont pas pu être lus", async () => {
    mockedApi.get.mockRejectedValue(new Error("réseau indisponible"));

    render(
      <AuthProvider>
        <MemoryRouter>
          <AgencySettingsPage />
        </MemoryRouter>
      </AuthProvider>
    );

    // Le bouton d'enregistrement ne doit pas exister : c'est lui qui écraserait.
    await waitFor(() => expect(screen.queryByText("Nom commercial de l'agence *")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Enregistrer les paramètres/ })).not.toBeInTheDocument();
    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it("propose de réessayer plutôt que de laisser l'écran muet", async () => {
    mockedApi.get.mockRejectedValue(new Error("réseau indisponible"));

    render(
      <AuthProvider>
        <MemoryRouter>
          <AgencySettingsPage />
        </MemoryRouter>
      </AuthProvider>
    );

    expect(await screen.findByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
