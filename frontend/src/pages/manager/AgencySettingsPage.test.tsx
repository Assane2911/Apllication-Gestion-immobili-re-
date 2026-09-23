import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { AgencySettings } from "../../types";
import AgencySettingsPage from "./AgencySettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

// La page utilise désormais useAuth() (zone de danger — déconnexion après
// suppression du compte) et useNavigate() (redirection vers /login) : elle a
// donc besoin d'un AuthProvider et d'un Router autour d'elle, comme
// SubscriptionPage.test.tsx le fait déjà pour les mêmes raisons.
function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <AgencySettingsPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

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
    mockedApi.post.mockReset();
    mockedApi.delete.mockReset();
    localStorage.clear();
  });

  it("pré-remplit le formulaire avec les coordonnées existantes de l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    expect(screen.getByLabelText("Email de contact officiel *")).toHaveValue("contact@agenceduport.com");
    expect(screen.getByLabelText("Téléphone de l'agence")).toHaveValue("+33 1 40 00 00 00");
  });

  it("pré-remplit aussi l'IBAN et le BIC quand ils sont déjà renseignés", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: settings({ iban: "FR7630006000011234567890189", bic: "BNPAFRPPXXX" }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("IBAN")).toHaveValue("FR7630006000011234567890189"));
    expect(screen.getByLabelText("BIC / SWIFT")).toHaveValue("BNPAFRPPXXX");
  });

  it("enregistre l'IBAN et le BIC saisis", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockResolvedValueOnce({
      data: settings({ iban: "FR7630006000011234567890189", bic: "BNPAFRPPXXX" }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    await userEvent.setup().type(screen.getByLabelText("IBAN"), "FR7630006000011234567890189");
    await userEvent.setup().type(screen.getByLabelText("BIC / SWIFT"), "BNPAFRPPXXX");
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(
        "/agency",
        expect.objectContaining({ iban: "FR7630006000011234567890189", bic: "BNPAFRPPXXX" })
      )
    );
  });

  it("affiche l'erreur du serveur quand l'IBAN saisi est invalide", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockRejectedValueOnce({
      response: { data: { error: "Requête invalide : données manquantes ou incorrectes (champ concerné : iban)." } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    await userEvent.setup().type(screen.getByLabelText("IBAN"), "FR00INVALIDE");
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

    await waitFor(() => expect(screen.getByText(/champ concerné : iban/)).toBeInTheDocument());
  });

  it("enregistre les modifications et affiche un message de succès", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    mockedApi.put.mockResolvedValueOnce({ data: settings({ agencyName: "Agence du Port Renommée" }) });
    renderPage();

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
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  describe("Zone de danger — suppression du compte", () => {
    it("ouvre la modale de confirmation au clic sur « Supprimer mon compte »", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      renderPage();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer mon compte" }));

      expect(screen.getByRole("heading", { name: "Supprimer définitivement mon compte" })).toBeInTheDocument();
      expect(mockedApi.delete).not.toHaveBeenCalled();
    });

    it("n'active le bouton de confirmation que si le mot « SUPPRIMER » est saisi", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));

      const confirmButton = screen.getByRole("button", { name: "Supprimer définitivement mon compte" });
      expect(confirmButton).toBeDisabled();

      await user.type(screen.getByLabelText(/Tapez/), "SUPPRIMER");
      await user.type(screen.getByLabelText("Ressaisissez votre mot de passe actuel"), "Password123!");

      expect(confirmButton).toBeEnabled();
    });

    it("appelle DELETE /auth/account avec le mot de passe puis redirige vers la connexion", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      mockedApi.delete.mockResolvedValueOnce({ data: undefined });
      localStorage.setItem("token", "fake-token");
      localStorage.setItem(
        "user",
        JSON.stringify({ id: "mgr-1", email: "manager@test.local", role: "MANAGER" })
      );
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
      await user.type(screen.getByLabelText(/Tapez/), "SUPPRIMER");
      await user.type(screen.getByLabelText("Ressaisissez votre mot de passe actuel"), "Password123!");
      await user.click(screen.getByRole("button", { name: "Supprimer définitivement mon compte" }));

      await waitFor(() =>
        expect(mockedApi.delete).toHaveBeenCalledWith("/auth/account", { data: { password: "Password123!" } })
      );
      // La déconnexion vide le stockage local — signe que logout() a bien été appelé.
      await waitFor(() => expect(localStorage.getItem("token")).toBeNull());
    });

    /**
     * Fermer toutes les sessions invalide AUSSI le jeton courant (voir
     * logoutAllDevices côté backend) : rester sur la page laisserait une
     * application qui se croit connectée et dont chaque requête repartirait
     * en 401. La déconnexion locale fait donc partie du geste, elle n'en est
     * pas une conséquence accessoire.
     */
    it("ferme toutes les sessions puis déconnecte l'appareil courant", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
      localStorage.setItem("token", "fake-token");
      localStorage.setItem(
        "user",
        JSON.stringify({ id: "mgr-1", email: "manager@test.local", role: "MANAGER" })
      );
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Déconnecter tous mes appareils" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/auth/logout-all"));
      await waitFor(() => expect(localStorage.getItem("token")).toBeNull());
    });

    it("garde la session ouverte et affiche l'erreur si la fermeture des sessions échoue", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      mockedApi.post.mockRejectedValueOnce({
        response: { data: { error: "Service indisponible" } },
        isAxiosError: true,
      });
      localStorage.setItem("token", "fake-token");
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Déconnecter tous mes appareils" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Service indisponible");
      // L'échec ne doit pas déconnecter : les sessions sont toujours ouvertes.
      expect(localStorage.getItem("token")).toBe("fake-token");
    });

    it("affiche l'erreur du serveur si le mot de passe est incorrect, sans déconnecter", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      mockedApi.delete.mockRejectedValueOnce({
        response: { data: { error: "Mot de passe incorrect" } },
        isAxiosError: true,
      });
      localStorage.setItem("token", "fake-token");
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
      await user.type(screen.getByLabelText(/Tapez/), "SUPPRIMER");
      await user.type(screen.getByLabelText("Ressaisissez votre mot de passe actuel"), "MauvaisMotDePasse");
      await user.click(screen.getByRole("button", { name: "Supprimer définitivement mon compte" }));

      await waitFor(() => expect(screen.getByText("Mot de passe incorrect")).toBeInTheDocument());
      expect(localStorage.getItem("token")).toBe("fake-token");
    });
  });
});
