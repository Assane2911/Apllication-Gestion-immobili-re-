import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { SESSION_HINT_KEY } from "../../utils/sessionLocale";
import AgencySettingsPage from "./AgencySettingsPage";

// Les sections qui chargent leurs propres ressources voleraient les réponses simulées de la page.
vi.mock("../../components/SectionPaiementEnLigne", () => ({ default: () => null }));
// Les trois fenêtres sont testées à part : ici, seulement ce que la PAGE en fait (les ouvrir, les fermer, réagir à leur succès).
vi.mock("../../components/TwoFactorSetupModal", () => ({
  default: ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Fenêtre d'activation">
      <button onClick={onSuccess}>Activation réussie</button>
      <button onClick={onClose}>Fermer l'activation</button>
    </div>
  ),
}));
vi.mock("../../components/TwoFactorDisableModal", () => ({
  default: ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Fenêtre de désactivation">
      <button onClick={onSuccess}>Désactivation réussie</button>
      <button onClick={onClose}>Fermer la désactivation</button>
    </div>
  ),
}));
vi.mock("../../components/DeleteAccountModal", () => ({
  default: ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Fenêtre de suppression">
      <button onClick={onSuccess}>Compte supprimé</button>
      <button onClick={onClose}>Fermer la suppression</button>
    </div>
  ),
}));

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les paramètres de l'agence : ce que les autres tests n'exerçaient pas. Un chargement raté ne doit jamais laisser enregistrer
 * du vide par-dessus les vraies coordonnées ; la double authentification doit relire le compte (le badge change) seulement
 * quand l'opération réussit ; les échéances de conservation renvoient vers les bonnes listes ; supprimer le compte déconnecte.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 500,
    statusText: "Server Error",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const agence = { id: "a1", userId: "mgr-1", agencyName: "Agence du Port", siretOrId: "", address: "", phone: "", email: "contact@port.fr", legalNotice: "" };
const echeancesVides = () => ({ calculeLe: "2026-11-21T00:00:00.000Z", durees: { ficheSansBailJours: 365, leadJours: 730 }, fichesSansBail: [], bauxClosDepuisLongtemps: [], leadsAnciens: [], total: 0 });

function Chemin() {
  return <p data-testid="chemin">{useLocation().pathname}</p>;
}

function afficher() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/parametres"]}>
        <Routes>
          <Route path="/parametres" element={<AgencySettingsPage />} />
          <Route path="*" element={<Chemin />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

/**
 * Le gestionnaire connecté, avec ou sans double authentification. `/auth/me` répond l'état courant du « serveur », que le test
 * change au moment voulu (`serveur.twoFactorEnabled`) : la page doit le relire seulement quand l'opération a réussi.
 */
function connecter(twoFactorEnabled: boolean, echeances: unknown = echeancesVides()) {
  const serveur = { twoFactorEnabled };
  localStorage.setItem("user", JSON.stringify({ id: "mgr-1", email: "proprio@test.local", role: "MANAGER", twoFactorEnabled, subscription: { plan: "PRO" } }));
  localStorage.setItem(SESSION_HINT_KEY, "1");
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/auth/me") return { data: { id: "mgr-1", email: "proprio@test.local", role: "MANAGER", twoFactorEnabled: serveur.twoFactorEnabled, subscription: { plan: "PRO" } } };
    if (url === "/agency") return { data: agence };
    if (url === "/conservation/echeances") {
      if (echeances instanceof Error) throw echeances;
      return { data: echeances };
    }
    return { data: {} };
  });
  return serveur;
}
const attendreLaPage = () => screen.findByLabelText("Nom commercial de l'agence *");

describe("AgencySettingsPage : parcours", () => {
  beforeEach(() => {
    for (const m of Object.values(mockedApi)) (m as ReturnType<typeof vi.fn>).mockReset?.();
    localStorage.clear();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  describe("double authentification", () => {
    it("activation réussie : le compte est relu (le bouton devient « Désactiver ») ; fermer la fenêtre ne change rien", async () => {
      const serveur = connecter(false);
      const user = userEvent.setup();
      afficher();
      await attendreLaPage();

      await user.click(screen.getByRole("button", { name: "Activer la double authentification" }));
      await user.click(screen.getByRole("button", { name: "Fermer l'activation" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Activer la double authentification" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Activer la double authentification" }));
      serveur.twoFactorEnabled = true;
      await user.click(screen.getByRole("button", { name: "Activation réussie" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Désactiver" })).toBeInTheDocument();
    });

    it("désactivation réussie : le compte est relu (le bouton redevient « Activer ») ; fermer la fenêtre ne change rien", async () => {
      const serveur = connecter(true);
      const user = userEvent.setup();
      afficher();
      await attendreLaPage();

      await user.click(screen.getByRole("button", { name: "Désactiver" }));
      await user.click(screen.getByRole("button", { name: "Fermer la désactivation" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Désactiver" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Désactiver" }));
      serveur.twoFactorEnabled = false;
      await user.click(screen.getByRole("button", { name: "Désactivation réussie" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Activer la double authentification" })).toBeInTheDocument();
    });
  });

  describe("suppression du compte", () => {
    it("fermer la fenêtre garde la session ; un compte supprimé déconnecte et renvoie à la connexion", async () => {
      connecter(false);
      mockedApi.post.mockResolvedValue({ data: {} });
      const user = userEvent.setup();
      afficher();
      await attendreLaPage();

      await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
      await user.click(screen.getByRole("button", { name: "Fermer la suppression" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(localStorage.getItem("user")).not.toBeNull();

      await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
      await user.click(screen.getByRole("button", { name: "Compte supprimé" }));

      await waitFor(() => expect(screen.getByTestId("chemin")).toHaveTextContent("/login"));
      expect(localStorage.getItem("user")).toBeNull();
    });
  });

  it("chargement raté : le message du serveur remplace le formulaire (rien à écraser) et « Réessayer » recharge la page", async () => {
    connecter(false);
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/agency") throw erreurServeur("Agence introuvable.");
      return { data: echeancesVides() };
    });
    const recharger = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload: recharger } as Location);
    const user = userEvent.setup();
    afficher();

    expect(await screen.findByText("Agence introuvable.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nom commercial de l'agence *")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer les paramètres" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it("coordonnées saisies : identifiants légaux, e-mail, adresse et mentions légales partent avec l'enregistrement", async () => {
    connecter(false);
    mockedApi.put.mockResolvedValue({ data: agence });
    const user = userEvent.setup();
    afficher();
    await attendreLaPage();

    await user.type(screen.getByLabelText("Identifiants légaux (SIRET, NIF, NINEA, RCCM…)"), "NINEA 123456789");
    await user.clear(screen.getByLabelText("Email de contact officiel *"));
    await user.type(screen.getByLabelText("Email de contact officiel *"), "nouveau@port.fr");
    await user.type(screen.getByLabelText("Adresse du siège de l'agence"), "5 quai du Port, Dakar");
    await user.type(screen.getByLabelText("Mentions légales du pied de page des quittances"), "SARL au capital de 1 000 000 FCFA");
    await user.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalled());
    expect(mockedApi.put).toHaveBeenCalledWith(
      "/agency",
      expect.objectContaining({
        siretOrId: "NINEA 123456789",
        email: "nouveau@port.fr",
        address: "5 quai du Port, Dakar",
        legalNotice: "SARL au capital de 1 000 000 FCFA",
      })
    );
  });

  describe("données arrivées à échéance", () => {
    it("échéances illisibles : un message le dit, sans casser le reste de la page", async () => {
      connecter(false, erreurServeur("Calcul indisponible."));
      afficher();

      expect(await screen.findByText("Impossible de charger les échéances.")).toBeInTheDocument();
      expect(screen.getByLabelText("Nom commercial de l'agence *")).toBeInTheDocument();
    });

    it("un bail clos depuis longtemps est listé, et « Ouvrir la liste des locataires » mène à la liste des locataires", async () => {
      connecter(false, {
        ...echeancesVides(),
        bauxClosDepuisLongtemps: [{ id: "t9", firstName: "Ibrahima", lastName: "Ndiaye", endDate: "2019-01-01", contractId: "c9" }],
        total: 1,
      });
      const user = userEvent.setup();
      afficher();

      expect(await screen.findByText(/Ibrahima Ndiaye/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Ouvrir la liste des locataires" }));

      expect(screen.getByTestId("chemin")).toHaveTextContent("/tenants");
    });

    it("« Ouvrir les demandes de contact » mène au CRM des demandes", async () => {
      connecter(false, {
        ...echeancesVides(),
        leadsAnciens: [{ id: "l1", listingId: "x", managerId: "mgr-1", prospectName: "Moussa Fall", prospectEmail: "m@f.sn", prospectPhone: "", requestType: "INFO", status: "ARCHIVED", createdAt: "2020-01-01", updatedAt: "2020-01-01" }],
        total: 1,
      });
      const user = userEvent.setup();
      afficher();
      await screen.findByText(/Moussa Fall/);

      await user.click(screen.getByRole("button", { name: "Ouvrir les demandes de contact" }));

      expect(screen.getByTestId("chemin")).toHaveTextContent("/leads");
    });
  });
});
