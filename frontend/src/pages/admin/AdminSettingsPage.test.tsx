import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthContext } from "../../context/auth";
import type { AuthContextValue } from "../../context/auth";
import type { AuthUser, PlatformSettings } from "../../types";
import AdminSettingsPage from "./AdminSettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function noop(): never {
  throw new Error("not implemented in this test");
}

function authValue(user: AuthUser): AuthContextValue {
  return {
    user,
    loading: false,
    login: noop,
    register: noop,
    loginWithGoogle: noop,
    verifyTwoFactor: noop,
    verifyEmail: noop,
    logout: async () => {},
    refreshUser: async () => user,
  };
}

function renderPage(twoFactorEnabled = false) {
  const admin: AuthUser = { id: "a1", email: "admin@test.local", role: "ADMIN", twoFactorEnabled };
  return render(
    <AuthContext.Provider value={authValue(admin)}>
      <AdminSettingsPage />
    </AuthContext.Provider>
  );
}

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
    mockedApi.post.mockReset();
  });

  it("pré-remplit le formulaire avec l'IBAN et le BIC déjà configurés", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: settings({ iban: "FR7630001007941234567890185", bic: "BDFEFRPPXXX" }),
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByLabelText("IBAN de la plateforme")).toHaveValue("FR7630001007941234567890185")
    );
    expect(screen.getByLabelText("BIC / SWIFT")).toHaveValue("BDFEFRPPXXX");
  });

  it("laisse le formulaire vide quand rien n'est encore configuré", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    renderPage();

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
    renderPage();

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
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Coordonnées bancaires enregistrées"));
  });

  it("affiche l'erreur du serveur quand l'IBAN saisi est invalide", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockRejectedValueOnce({
      response: { data: { error: "Requête invalide : données manquantes ou incorrectes (champ concerné : iban)." } },
      isAxiosError: true,
    });
    renderPage();

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
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("IBAN de la plateforme")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  // Le compte administrateur est le plus puissant de la plateforme : il doit pouvoir activer sa propre
  // double authentification, comme un gestionnaire (la page n'offrait aucun moyen de le faire).
  it("propose d'activer la double authentification et lance l'enrôlement", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.post.mockResolvedValueOnce({ data: { secret: "ABCDEFGH", qrCodeDataUrl: "data:image/png;base64,AAAA" } });
    renderPage(false);

    await user.click(await screen.findByRole("button", { name: "Activer la double authentification" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/setup"));
  });

  it("indique que la double authentification est activée et propose de la désactiver", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    renderPage(true);

    expect(await screen.findByText("Double authentification activée")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Désactiver" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activer la double authentification" })).not.toBeInTheDocument();
  });

  it("garde la sécurité du compte accessible même quand les coordonnées bancaires ne se chargent pas", async () => {
    mockedApi.get.mockRejectedValueOnce(new Error("réseau"));
    renderPage(false);

    expect(await screen.findByRole("button", { name: "Activer la double authentification" })).toBeInTheDocument();
  });

  it("contrôle la clé de l'IBAN et le format du BIC, sans empêcher l'enregistrement", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    renderPage();

    const iban = await screen.findByLabelText("IBAN de la plateforme");
    await user.type(iban, "FR7630001007941234567890186");
    expect(screen.getByText(/La clé de cet IBAN ne correspond pas/)).toBeInTheDocument();

    await user.clear(iban);
    await user.type(iban, "FR76 3000 1007 9412 3456 7890 185");
    expect(screen.getByText("Clé IBAN valide")).toBeInTheDocument();

    await user.type(screen.getByLabelText("BIC / SWIFT"), "BDFEFRP");
    expect(screen.getByText("Un BIC compte 8 ou 11 caractères")).toBeInTheDocument();
    await user.type(screen.getByLabelText("BIC / SWIFT"), "PXXX");
    expect(screen.getByText("Format BIC valide")).toBeInTheDocument();
  });

  it("montre l'aperçu de ce que verront les gestionnaires, IBAN groupé par quatre", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    renderPage();

    const apercu = await screen.findByRole("complementary", { name: "Ce que verront les gestionnaires" });
    expect(apercu).toHaveTextContent("Saisissez l'IBAN pour voir l'aperçu.");

    await user.type(screen.getByLabelText("IBAN de la plateforme"), "fr7630001007941234567890185");
    expect(apercu).toHaveTextContent("FR76 3000 1007 9412 3456 7890 185");
  });

  it("signale les modifications non enregistrées puis le retour à jour après l'enregistrement", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: settings({ iban: "FR7630001007941234567890185", bic: "BDFEFRPPXXX" }) });
    mockedApi.put.mockResolvedValueOnce({ data: settings() });
    renderPage();

    expect(await screen.findByText("À jour")).toBeInTheDocument();
    await user.type(screen.getByLabelText("BIC / SWIFT"), "A");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("À jour")).toBeInTheDocument();
  });
});
