import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { PaginatedResponse, Tenant } from "../../types";
import TenantsPage from "./TenantsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les actions d'une fiche locataire que les autres tests n'exerçaient pas : l'export des données personnelles (droit d'accès
 * et portabilité, RGPD), les refus de confirmation (supprimer, anonymiser), les erreurs du serveur, l'enregistrement d'une
 * fiche refusé, l'accès au portail refusé, et le presse-papiers indisponible. Une erreur doit toujours être montrée : elle ne
 * doit jamais passer pour une action réussie.
 */

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "ten-1",
    firstName: "Awa",
    lastName: "Diallo",
    phone: "0600000000",
    email: "awa@example.com",
    idDocument: null,
    userId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Tenant[]): { data: PaginatedResponse<Tenant> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    statusText: "Conflict",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function renderPage() {
  return render(
    <AuthProvider>
      <TenantsPage />
    </AuthProvider>
  );
}

/** La page rend le tableau (bureau) ET les cartes (téléphone) : chaque locataire apparaît deux fois. */
async function attendreLaListe() {
  await screen.findAllByText("Awa Diallo");
}

describe("TenantsPage : exports, refus de confirmation et erreurs du serveur", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("exporter les données d'un locataire (droit d'accès et portabilité)", () => {
    it("demande le dossier complet en blob et le télécharge sous un nom lisible, en minuscules", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([tenant({ firstName: "Awa", lastName: "Diallo" })]));
      mockedApi.get.mockResolvedValueOnce({ data: new Blob(['{"locataire":"Awa"}'], { type: "application/json" }) });
      const creer = vi.fn().mockReturnValue("blob:dossier");
      const revoquer = vi.fn();
      Object.defineProperty(URL, "createObjectURL", { value: creer, configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: revoquer, configurable: true });
      const telechargements: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        telechargements.push(this.download);
      });
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: "Exporter ses données" })[0]);

      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/tenants/ten-1/export", { responseType: "blob" }));
      await waitFor(() => expect(telechargements).toEqual(["donnees-awa-diallo.json"]));
      expect(creer).toHaveBeenCalledTimes(1);
      expect(revoquer).toHaveBeenCalledWith("blob:dossier"); // l'adresse temporaire est libérée
    });

    it("erreur du serveur : le message est montré et rien n'est téléchargé", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
      mockedApi.get.mockRejectedValueOnce(erreurServeur("Cette fiche a été anonymisée : plus rien à exporter."));
      const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: "Exporter ses données" })[0]);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Cette fiche a été anonymisée : plus rien à exporter."));
      expect(clic).not.toHaveBeenCalled();
    });
  });

  it("voir la pièce d'identité : si le lien signé ne peut pas être obtenu, l'erreur est montrée et rien ne s'ouvre", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant({ idDocument: "carte.pdf" })]));
    mockedApi.get.mockRejectedValueOnce(erreurServeur("Le fichier est introuvable."));
    const ouvrir = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPage();
    await attendreLaListe();

    await user.click(screen.getAllByRole("button", { name: /Voir/ })[0]);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Le fichier est introuvable."));
    expect(ouvrir).not.toHaveBeenCalled();
  });

  describe("supprimer une fiche", () => {
    it("confirmation refusée : rien n'est supprimé", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

      expect(window.confirm).toHaveBeenCalled();
      expect(mockedApi.delete).not.toHaveBeenCalled();
    });

    it("refusée par le serveur (un bail existe) : l'erreur est montrée", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
      mockedApi.delete.mockRejectedValueOnce(erreurServeur("Ce locataire a encore un bail : anonymisez la fiche plutôt que de la supprimer."));
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

      await waitFor(() =>
        expect(window.alert).toHaveBeenCalledWith("Ce locataire a encore un bail : anonymisez la fiche plutôt que de la supprimer.")
      );
    });
  });

  it("anonymiser : l'erreur du serveur est montrée", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
    mockedApi.post.mockRejectedValueOnce(erreurServeur("L'anonymisation a échoué."));
    renderPage();
    await attendreLaListe();

    await user.click(screen.getAllByRole("button", { name: "Anonymiser" })[0]);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("L'anonymisation a échoué."));
  });

  it("enregistrer une fiche refusée : l'erreur s'affiche dans le formulaire, qui reste ouvert", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([tenant()]));
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Cette adresse e-mail est déjà utilisée par un autre locataire."));
    renderPage();
    await attendreLaListe();

    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Cette adresse e-mail est déjà utilisée par un autre locataire.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
  });

  describe("accès au portail", () => {
    async function ouvrirLaCreation(user: ReturnType<typeof userEvent.setup>) {
      mockedApi.get.mockResolvedValue(paginated([tenant({ userId: null })]));
      renderPage();
      await user.click((await screen.findAllByRole("button", { name: "Créer l'accès" }))[0]);
    }

    it("refusé par le serveur : l'erreur s'affiche dans le panneau et le bouton n'est pas bloqué", async () => {
      const user = userEvent.setup();
      mockedApi.post.mockRejectedValueOnce(erreurServeur("Ce locataire a déjà un accès au portail."));
      await ouvrirLaCreation(user);
      await user.type(screen.getByRole("textbox"), "temp1234");

      await user.click(screen.getAllByRole("button", { name: "Créer l'accès" })[0]);

      expect(await screen.findByText("Ce locataire a déjà un accès au portail.")).toBeInTheDocument();
      expect(screen.queryByText(/Accès portail créé avec succès/)).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Créer l'accès" })[0]).toBeEnabled();
    });

    it("presse-papiers indisponible : « Copier » ne plante pas, le mot de passe reste affiché pour être recopié", async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("refusé")) }, configurable: true });
      await ouvrirLaCreation(user);
      await user.click(screen.getByRole("button", { name: "Générer" }));
      const champ = screen.getByLabelText("Mot de passe temporaire") as HTMLInputElement;
      const motDePasse = champ.value;

      await user.click(screen.getByRole("button", { name: "Copier" }));

      expect(screen.queryByRole("button", { name: "Copié" })).not.toBeInTheDocument(); // pas de faux « Copié »
      expect(champ.value).toBe(motDePasse);
    });
  });
});
