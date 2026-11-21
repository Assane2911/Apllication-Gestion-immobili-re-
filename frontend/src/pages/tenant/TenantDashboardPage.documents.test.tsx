import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Contract } from "../../types";
import TenantDashboardPage from "./TenantDashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les documents du bail depuis le portail du locataire : le bail PDF, et le contrat papier scanné. Le scan peut être une adresse
 * directe (http/https) ou un chemin du stockage PRIVÉ, qui ne s'ouvre qu'avec un lien signé demandé à la volée : un chemin ne
 * doit jamais être mis tel quel dans un cadre, et un lien signé refusé doit se dire au lieu de laisser un clic sans effet.
 */

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    propertyId: "prop-1",
    tenantId: "ten-1",
    rent: 500,
    deposit: 1000,
    currency: "EUR",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    status: "ACTIVE",
    signedByTenantAt: null,
    property: { id: "prop-1", title: "Studio Centre-ville", address: "1 rue de la Paix" } as Contract["property"],
    invoices: [],
    ...overrides,
  };
}

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 404,
    statusText: "Not Found",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CurrencyProvider>
          <TenantDashboardPage />
        </CurrencyProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function chargerLePortail(contrats: Contract[]) {
  mockedApi.get.mockResolvedValueOnce({ data: contrats });
  mockedApi.get.mockResolvedValueOnce({ data: [] }); // /inspections/mine
}

describe("TenantDashboardPage : le bail PDF et le contrat papier scanné", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("« Voir le bail PDF » ouvre l'aperçu du bail de CE contrat", async () => {
    const user = userEvent.setup();
    chargerLePortail([contract({ id: "c1" })]);
    mockedApi.get.mockResolvedValueOnce({ data: "<p>Bail de location du studio</p>" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Voir le bail PDF/ }));

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/documents/lease/c1", expect.anything()));
    const apercu = await screen.findByTitle("Contrat de Bail - Studio Centre-ville");
    expect(apercu.getAttribute("srcdoc")).toContain("Bail de location du studio");
  });

  it("aucun bouton de scan quand le bail n'a pas été numérisé", async () => {
    chargerLePortail([contract({ scannedContractUrl: null })]);
    renderPage();
    await screen.findByText("Studio Centre-ville");

    expect(screen.queryByRole("button", { name: /contrat papier scanné/ })).not.toBeInTheDocument();
  });

  it("scan à adresse directe (https) : s'ouvre sans rien demander au serveur", async () => {
    const user = userEvent.setup();
    chargerLePortail([contract({ scannedContractUrl: "https://stockage.test/bail-scanne.pdf" })]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: /contrat papier scanné/ }));

    await waitFor(() => expect(document.querySelector('iframe[src="https://stockage.test/bail-scanne.pdf"]')).not.toBeNull());
    expect(mockedApi.get).toHaveBeenCalledTimes(2); // le chargement du portail seulement
  });

  it("scan rangé dans le stockage privé (simple chemin) : demande un lien signé et l'ouvre, jamais le chemin tel quel", async () => {
    const user = userEvent.setup();
    chargerLePortail([contract({ id: "c1", scannedContractUrl: "contracts/c1/scan.pdf" })]);
    mockedApi.get.mockResolvedValueOnce({ data: { url: "https://stockage.test/signe/scan.pdf?token=abc" } });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /contrat papier scanné/ }));

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/documents/lease-scan/c1"));
    await waitFor(() => expect(document.querySelector('iframe[src="https://stockage.test/signe/scan.pdf?token=abc"]')).not.toBeNull());
    expect(document.querySelector('iframe[src="contracts/c1/scan.pdf"]')).toBeNull();
  });

  it("lien signé refusé : l'erreur du serveur est montrée et aucun aperçu ne s'ouvre", async () => {
    const user = userEvent.setup();
    chargerLePortail([contract({ scannedContractUrl: "contracts/c1/scan.pdf" })]);
    mockedApi.get.mockRejectedValueOnce(erreurServeur("Le scan de ce bail est introuvable."));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /contrat papier scanné/ }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Le scan de ce bail est introuvable."));
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("une adresse qui ne commence pas par http(s) n'est jamais ouverte directement (javascript:, data:…)", async () => {
    const user = userEvent.setup();
    chargerLePortail([contract({ scannedContractUrl: "javascript:alert(1)" })]);
    mockedApi.get.mockRejectedValueOnce(erreurServeur("Lien indisponible."));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /contrat papier scanné/ }));

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/documents/lease-scan/c1"));
    expect(document.querySelector('iframe[src^="javascript:"]')).toBeNull();
  });
});
