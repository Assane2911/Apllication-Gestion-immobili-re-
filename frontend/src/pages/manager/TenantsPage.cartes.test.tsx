import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
 * Les fiches locataires sur téléphone (cartes) et le formulaire : chaque action d'une carte doit viser CE locataire (supprimer,
 * anonymiser ou exporter la mauvaise fiche est irréversible ou expose des données personnelles), et le formulaire doit envoyer
 * la civilité choisie et se fermer sans rien envoyer quand on annule.
 */

const locataire = (o: Partial<Tenant> = {}): Tenant =>
  ({ id: "t1", firstName: "Awa", lastName: "Diallo", phone: "0600000000", email: "awa@example.com", idDocument: null, userId: null, createdAt: "2026-01-01T00:00:00.000Z", ...o }) as Tenant;
const page = (items: Tenant[]): { data: PaginatedResponse<Tenant> } => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } });
const entrees = (fd: FormData) => {
  const sortie: Record<string, unknown> = {};
  fd.forEach((valeur, cle) => {
    sortie[cle] = valeur;
  });
  return sortie;
};

const deux = () => [locataire({ id: "t1", firstName: "Awa", lastName: "Diallo" }), locataire({ id: "t2", firstName: "Moussa", lastName: "Ba", idDocument: "documents/t2.pdf", email: "moussa@example.com" })];

function afficher(items: Tenant[]) {
  mockedApi.get.mockResolvedValue(page(items));
  return render(
    <AuthProvider>
      <TenantsPage />
    </AuthProvider>
  );
}
/** Les cartes (écran de téléphone) sont dans le conteneur `sm:hidden` ; le tableau, lui, sert les écrans larges. */
const cartes = (conteneur: HTMLElement) => conteneur.querySelector<HTMLElement>(".sm\\:hidden.space-y-3") as HTMLElement;
const carteDe = (conteneur: HTMLElement, nom: string) => within(cartes(conteneur)).getByText(nom).closest(".space-y-3 > div") as HTMLElement;

describe("TenantsPage : cartes mobiles et formulaire", () => {
  beforeEach(() => {
    for (const m of Object.values(mockedApi)) (m as ReturnType<typeof vi.fn>).mockReset?.();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  describe("chaque action d'une carte vise la bonne fiche (ici la deuxième)", () => {
    it("« Modifier » ouvre le formulaire pré-rempli avec ce locataire", async () => {
      const user = userEvent.setup();
      const { container } = afficher(deux());
      await waitFor(() => expect(cartes(container)).not.toBeNull());

      await user.click(within(carteDe(container, "Moussa Ba")).getByRole("button", { name: "Modifier" }));

      expect(await screen.findByDisplayValue("Moussa")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Ba")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Awa")).not.toBeInTheDocument();
    });

    it("« Supprimer » demande confirmation avec le nom, puis supprime cette fiche et pas l'autre", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockResolvedValue({ data: {} });
      const { container } = afficher(deux());
      await waitFor(() => expect(cartes(container)).not.toBeNull());

      await user.click(within(carteDe(container, "Moussa Ba")).getByRole("button", { name: "Supprimer" }));

      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Moussa Ba"));
      await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/tenants/t2"));
      expect(mockedApi.delete).toHaveBeenCalledTimes(1);
    });

    it("« Anonymiser » demande confirmation puis anonymise cette fiche et pas l'autre", async () => {
      const user = userEvent.setup();
      mockedApi.post.mockResolvedValue({ data: {} });
      const { container } = afficher(deux());
      await waitFor(() => expect(cartes(container)).not.toBeNull());

      await user.click(within(carteDe(container, "Moussa Ba")).getByRole("button", { name: "Anonymiser" }));

      expect(window.confirm).toHaveBeenCalled();
      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/tenants/t2/anonymiser"));
      expect(mockedApi.post).toHaveBeenCalledTimes(1);
    });

    it("« Exporter ses données » demande le dossier de cette fiche", async () => {
      const user = userEvent.setup();
      Object.defineProperty(URL, "createObjectURL", { value: vi.fn().mockReturnValue("blob:dossier"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const { container } = afficher(deux());
      await waitFor(() => expect(cartes(container)).not.toBeNull());
      mockedApi.get.mockResolvedValueOnce({ data: new Blob(["{}"], { type: "application/json" }) });

      await user.click(within(carteDe(container, "Moussa Ba")).getByRole("button", { name: "Exporter ses données" }));

      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/tenants/t2/export", { responseType: "blob" }));
    });

    it("« Voir la pièce d'identité » demande un lien temporaire pour cette fiche et l'ouvre", async () => {
      const user = userEvent.setup();
      const { container } = afficher(deux());
      await waitFor(() => expect(cartes(container)).not.toBeNull());
      mockedApi.get.mockResolvedValueOnce({ data: { url: "https://stockage.test/t2.pdf?signature=abc" } });

      await user.click(within(carteDe(container, "Moussa Ba")).getByRole("button", { name: "Voir la pièce d'identité" }));

      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/tenants/t2/id-document-url"));
      await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://stockage.test/t2.pdf?signature=abc", "_blank", "noopener,noreferrer"));
    });

    it("« Créer l'accès » ouvre le panneau du portail pour ce locataire", async () => {
      const user = userEvent.setup();
      const { container } = afficher(deux());
      await waitFor(() => expect(cartes(container)).not.toBeNull());

      await user.click(within(carteDe(container, "Moussa Ba")).getByRole("button", { name: "Créer l'accès" }));

      expect(await screen.findByText("Créer l'accès portail pour Moussa Ba")).toBeInTheDocument();
    });
  });

  it("une carte dit si le portail est activé et si une pièce d'identité manque, sans proposer d'action inutile", async () => {
    const { container } = afficher([locataire({ id: "t1", firstName: "Awa", lastName: "Diallo", userId: "u1" }), locataire({ id: "t2", firstName: "Moussa", lastName: "Ba", idDocument: "x" })]);
    await waitFor(() => expect(cartes(container)).not.toBeNull());

    const awa = within(carteDe(container, "Awa Diallo"));
    expect(awa.getByText("Portail activé")).toBeInTheDocument();
    expect(awa.queryByRole("button", { name: "Créer l'accès" })).not.toBeInTheDocument();
    expect(awa.getByText("Pas de pièce d'identité")).toBeInTheDocument();
    expect(awa.queryByRole("button", { name: "Voir la pièce d'identité" })).not.toBeInTheDocument();
  });

  describe("formulaire et panneau du portail", () => {
    it("la civilité choisie part avec la fiche", async () => {
      const user = userEvent.setup();
      mockedApi.post.mockResolvedValue({ data: { id: "nouveau" } });
      afficher([]);
      await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un locataire" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "+ Ajouter un locataire" })[0]);

      await user.selectOptions(screen.getByLabelText("Civilité"), "MME");
      const champs = screen.getAllByRole("textbox");
      await user.type(champs[0], "Fatou");
      await user.type(champs[1], "Sy");
      await user.type(champs[2], "77 122 33 44");
      await user.type(champs[3], "fatou@example.com");
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      expect(entrees(mockedApi.post.mock.calls[0][1] as FormData)).toMatchObject({ civility: "MME", firstName: "Fatou", lastName: "Sy" });
    });

    it("« Annuler » ferme le formulaire sans rien envoyer", async () => {
      const user = userEvent.setup();
      afficher([]);
      await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un locataire" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "+ Ajouter un locataire" })[0]);
      await user.type(screen.getAllByRole("textbox")[0], "Fatou");

      await user.click(screen.getByRole("button", { name: "Annuler" }));

      expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("« Fermer » referme le panneau du portail sans rien créer", async () => {
      const user = userEvent.setup();
      afficher([locataire()]);
      await user.click((await screen.findAllByRole("button", { name: "Créer l'accès" }))[0]);
      expect(await screen.findByText("Créer l'accès portail pour Awa Diallo")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Fermer" }));

      expect(screen.queryByText("Créer l'accès portail pour Awa Diallo")).not.toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("presse-papiers refusé : le mot de passe généré reste affiché, sans faux « Copié »", async () => {
      const user = userEvent.setup();
      afficher([locataire()]);
      await user.click((await screen.findAllByRole("button", { name: "Créer l'accès" }))[0]);
      await user.click(screen.getByRole("button", { name: "Générer" }));
      const ecrire = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("permission refusée"));

      await user.click(screen.getByRole("button", { name: "Copier" }));

      await waitFor(() => expect(ecrire).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Copié" })).not.toBeInTheDocument();
      expect((screen.getByLabelText("Mot de passe temporaire") as HTMLInputElement).value).toHaveLength(12);
    });
  });

  it("recherche sans résultat : le dit, et « Réinitialiser les filtres » ramène la liste", async () => {
    const user = userEvent.setup();
    afficher([
      locataire({ id: "a", firstName: "Awa", lastName: "Diallo" }),
      locataire({ id: "b", firstName: "Moussa", lastName: "Ba", email: "m@example.com" }),
      locataire({ id: "c", firstName: "Élodie", lastName: "Sow", email: "e@example.com" }),
      locataire({ id: "d", firstName: "Ibrahima", lastName: "Fall", email: "i@example.com" }),
    ]);
    await screen.findByRole("table");

    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("Aucun résultat pour ces critères.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));

    expect(within(screen.getByRole("table")).getAllByRole("row").length).toBeGreaterThan(4);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
