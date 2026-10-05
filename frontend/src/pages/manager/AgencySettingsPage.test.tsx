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
function echeancesVides() {
  return {
    calculeLe: "2026-09-24T00:00:00.000Z",
    durees: { journauxJours: 365, ficheSansBailJours: 90, apresFinDeBailJours: 1825, leadProspectionJours: 1095 },
    fichesSansBail: [],
    bauxClosDepuisLongtemps: [],
    leadsAnciens: [],
    total: 0,
  };
}

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
    // La page charge DEUX ressources au montage : les paramètres d'agence
    // d'abord, puis les échéances de conservation. Les tests posent la
    // première avec mockResolvedValueOnce ; celle-ci sert de réponse par
    // défaut à la seconde, pour qu'ils n'aient pas tous à s'en occuper.
    mockedApi.get.mockResolvedValue({ data: echeancesVides() });
    localStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("pré-remplit le formulaire avec les coordonnées existantes de l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: settings() });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
    expect(screen.getByLabelText("Email de contact officiel *")).toHaveValue("contact@agenceduport.com");
    // Le champ téléphone se relit en deux parties depuis la valeur stockée :
    // l'indicatif dans la liste, le reste dans la saisie. Un numéro déjà
    // enregistré au format international revient donc sans son « +33 ».
    //
    // `waitFor` et non une assertion directe : les autres champs sont liés
    // à l'état du formulaire, celui-ci le DÉRIVE dans un effet. Il se peuple
    // donc un rendu plus tard que les autres — ce qui n'a aucun effet visible
    // à l'écran, mais se voit dans un test qui n'attend pas.
    await waitFor(() => expect(screen.getByLabelText("Téléphone de l'agence")).toHaveValue("140000000"));
    expect(screen.getByLabelText("Indicatif du pays")).toHaveValue("FR");
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
      expect(screen.getByRole("status")).toHaveTextContent(/Paramètres de l'agence mis à jour avec succès/)
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
      // La déconnexion vide le profil du stockage local — signe que logout() a
      // bien été appelé (le jeton, lui, n'y est plus stocké côté web : voir
      // AuthContext.tsx).
      await waitFor(() => expect(localStorage.getItem("user")).toBeNull());
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
      await waitFor(() => expect(localStorage.getItem("user")).toBeNull());
    });

    /**
     * Régression : ce bouton déconnecte IMMÉDIATEMENT l'appareil courant, sans
     * demander confirmation — un clic accidentel coupait la session en cours
     * sans le moindre recours, contrairement aux autres actions destructrices
     * de l'écran (suppression du compte, résiliation de contrat) qui en ont
     * toutes une.
     */
    it("ne ferme aucune session si le gestionnaire annule la confirmation", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      vi.spyOn(window, "confirm").mockReturnValue(false);
      localStorage.setItem("token", "fake-token");
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Déconnecter tous mes appareils" }));

      expect(mockedApi.post).not.toHaveBeenCalled();
      expect(localStorage.getItem("token")).toBe("fake-token");
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

  describe("Double authentification", () => {
    it("propose de l'activer quand elle n'est pas encore activée", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      renderPage();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      expect(screen.getByRole("button", { name: "Activer la double authentification" })).toBeInTheDocument();
      expect(screen.queryByText("Activée")).not.toBeInTheDocument();
    });

    it("affiche le badge « Activée » et le bouton Désactiver quand elle l'est déjà", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      localStorage.setItem(
        "user",
        JSON.stringify({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", twoFactorEnabled: true })
      );
      renderPage();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      expect(screen.getByText("Activée")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Désactiver" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Activer la double authentification" })).not.toBeInTheDocument();
    });

    it("ouvre la modale d'enrôlement au clic sur « Activer »", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      mockedApi.post.mockResolvedValueOnce({
        data: { secret: "SECRET123", otpauthUrl: "otpauth://totp/...", qrCodeDataUrl: "data:image/png;base64,xxx" },
      });
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Activer la double authentification" }));

      expect(await screen.findByRole("heading", { name: "Activer la double authentification" })).toBeInTheDocument();
      expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/setup");
    });

    it("ouvre la modale de désactivation au clic sur « Désactiver »", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      localStorage.setItem(
        "user",
        JSON.stringify({ id: "mgr-1", email: "manager@test.local", role: "MANAGER", twoFactorEnabled: true })
      );
      renderPage();
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByLabelText("Nom commercial de l'agence *")).toHaveValue("Agence du Port"));
      await user.click(screen.getByRole("button", { name: "Désactiver" }));

      expect(screen.getByRole("heading", { name: "Désactiver la double authentification" })).toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });
  });

  /**
   * Le Service ne détruit pas les données locatives de ses clients : pour
   * elles, le gestionnaire est responsable de traitement et le Service
   * sous-traitant, et lui seul sait si un litige en cours justifie de
   * conserver un dossier. L'écran SIGNALE donc, et ne propose aucun bouton
   * qui efface — c'est ce que ces deux tests verrouillent.
   */
  describe("données arrivées à échéance", () => {
    it("liste les fiches signalées, avec la raison", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() }).mockResolvedValueOnce({
        data: {
          ...echeancesVides(),
          fichesSansBail: [
            { id: "t1", firstName: "Awa", lastName: "Diallo", phone: "", email: "", createdAt: "2026-01-01" },
          ],
          total: 1,
        },
      });
      renderPage();

      expect(await screen.findByText(/Awa Diallo/)).toBeInTheDocument();
      expect(screen.getByText(/Fiche sans aucun bail/)).toBeInTheDocument();
    });

    it("n'offre aucune action de suppression, seulement un renvoi vers les fiches", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() }).mockResolvedValueOnce({
        data: {
          ...echeancesVides(),
          fichesSansBail: [
            { id: "t1", firstName: "Awa", lastName: "Diallo", phone: "", email: "", createdAt: "2026-01-01" },
          ],
          total: 1,
        },
      });
      renderPage();

      await screen.findByText(/Awa Diallo/);
      expect(screen.getByRole("button", { name: "Ouvrir la liste des locataires" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /purger/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /anonymiser/i })).not.toBeInTheDocument();
    });

    /**
     * Régression : les demandes de contact reçues sur la vitrine publique
     * (listingLeads) n'étaient jusqu'ici signalées nulle part — seule leur
     * suppression en cascade avec l'annonce entière existait (bien trop
     * grossier pour honorer une demande d'effacement individuelle).
     */
    it("liste aussi les demandes de contact anciennes, avec un lien dédié vers le CRM", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() }).mockResolvedValueOnce({
        data: {
          ...echeancesVides(),
          leadsAnciens: [
            {
              id: "lead-1",
              listingId: "list-1",
              managerId: "mgr-1",
              prospectName: "Moussa Fall",
              prospectEmail: "moussa@example.com",
              prospectPhone: "+221 77 000 00 00",
              requestType: "INFO",
              status: "ARCHIVED",
              createdAt: "2020-01-01",
              updatedAt: "2020-01-01",
            },
          ],
          total: 1,
        },
      });
      renderPage();

      expect(await screen.findByText(/Moussa Fall/)).toBeInTheDocument();
      expect(screen.getByText(/Demande de contact reçue sur une annonce/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ouvrir les demandes de contact" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Ouvrir la liste des locataires" })).not.toBeInTheDocument();
    });

    it("annonce qu'il n'y a rien à traiter quand aucune durée n'est atteinte", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: settings() });
      renderPage();

      expect(
        await screen.findByText("Aucune donnée n'a atteint sa durée de conservation.")
      ).toBeInTheDocument();
    });
  });
});
