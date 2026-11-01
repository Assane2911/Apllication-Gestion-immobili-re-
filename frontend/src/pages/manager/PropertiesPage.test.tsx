import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Owner, PaginatedResponse, Property } from "../../types";
import PropertiesPage from "./PropertiesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    title: "Studio Centre-ville",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 500,
    currency: "EUR",
    status: "AVAILABLE",
    description: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Property[]): { data: PaginatedResponse<Property> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

// PropertiesPage récupère aussi la liste des propriétaires (pour le
// sélecteur du formulaire) via un effet séparé, monté une seule fois — on
// répond systématiquement vide ici, ces tests ne portant pas sur ce sélecteur.
function paginatedOwners(items: Owner[] = []): { data: PaginatedResponse<Owner> } {
  return { data: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <PropertiesPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

// Vérifie le contenu d'un FormData sans dépendre de l'égalité stricte
// (toHaveBeenCalledWith ne compare pas bien les instances de FormData).
function formDataEntries(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fd.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

// Les <label> du formulaire ne sont pas associés aux champs (pas de htmlFor) :
// on cible donc les champs par rôle + ordre d'apparition dans le DOM plutôt
// que par getByLabelText, qui ne trouverait aucune association.
// Ordre des champs "textbox" (input texte + textarea) : Titre, Adresse, Description.
// Ordre des champs "spinbutton" (input number) : Surface, Loyer.
// Ordre des champs "combobox" : Statut, Propriétaire.
function getFormFields() {
  const textboxes = screen.getAllByRole("textbox");
  const spinbuttons = screen.getAllByRole("spinbutton");
  const comboboxes = screen.getAllByRole("combobox");
  return {
    title: textboxes[0],
    address: textboxes[1],
    description: textboxes[2],
    surface: spinbuttons[0],
    rent: spinbuttons[1],
    status: comboboxes[0],
    owner: comboboxes[1],
  };
}

describe("PropertiesPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des biens avec statut, surface et loyer", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    renderPage();

    await waitFor(() => expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument());
    expect(screen.getByText("1 rue de la Paix")).toBeInTheDocument();
    expect(screen.getByText("30 m²")).toBeInTheDocument();
    // Le loyer figure aussi dans la synthèse du parc : on lit celui de la fiche du bien.
    const fiche = screen.getByRole("article");
    expect(within(fiche).getByText(/500 €/)).toBeInTheDocument();
    expect(within(fiche).getByText("Disponible")).toBeInTheDocument();
  });

  /**
   * Régression a11y : le titre de chaque carte de bien sautait de h2 (titre de
   * la page) directement à h4, sans h3 intermédiaire — un niveau de titre
   * invalide pour la navigation par en-têtes des lecteurs d'écran.
   */
  it("titre chaque carte de bien avec un niveau de titre h3, pas h4", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    renderPage();

    expect(await screen.findByRole("heading", { level: 3, name: "Studio Centre-ville" })).toBeInTheDocument();
  });

  // Régression. L'écran lisait `res.data.items` sans vérifier que c'en était
  // un tableau, puis enchaînait sur `.length` et `.map()` PENDANT le rendu.
  // Une réponse de forme inattendue ne donnait donc pas un message d'erreur
  // mais la disparition de l'écran entier, derrière l'ErrorBoundary.
  //
  // Ce n'est pas théorique : le projet expose deux formes de réponse pour des
  // listes — tableau nu côté locataire, objet paginé côté gestionnaire.
  // Uniformiser la pagination côté serveur viderait la moitié de
  // l'application sans autre symptôme qu'une page blanche.
  it.each([
    ["un objet d'erreur", { data: { error: "Accès refusé" } }],
    ["une liste nulle", { data: { items: null, total: 0 } }],
    ["un tableau nu au lieu d'un objet paginé", { data: [] }],
  ])("reste affiché quand le serveur renvoie %s", async (_cas, reponse) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedApi.get.mockResolvedValueOnce(reponse);
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());

    renderPage();

    // L'écran tient debout et affiche son état vide au lieu de disparaître.
    await waitFor(() => expect(screen.getByText("Aucun bien pour l'instant")).toBeInTheDocument());
  });

  it("affiche l'état vide avec un bouton d'ajout quand il n'y a aucun bien", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Ajouter un bien" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument());
  });

  it("crée un bien : envoie un FormData avec les bons champs, y compris l'image", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    mockedApi.post.mockResolvedValueOnce({ data: { id: "prop-new" } });
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-new" })]));

    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un bien" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un bien" })[0]);

    const fields = getFormFields();
    await user.type(fields.title, "Loft Lumineux");
    await user.type(fields.address, "10 avenue des Fleurs");
    await user.type(fields.surface, "45");
    await user.type(fields.rent, "750");
    await user.selectOptions(fields.status, "MAINTENANCE");
    await user.type(fields.description, "Beau volume, lumière naturelle");

    const file = new File(["fake-image-content"], "photo.jpg", { type: "image/jpeg" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/properties");
    const entries = formDataEntries(formData as FormData);
    expect(entries.title).toBe("Loft Lumineux");
    expect(entries.address).toBe("10 avenue des Fleurs");
    expect(entries.surface).toBe("45");
    expect(entries.rent).toBe("750");
    expect(entries.status).toBe("MAINTENANCE");
    expect(entries.description).toBe("Beau volume, lumière naturelle");
    expect((entries.image as File).name).toBe("photo.jpg");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  it("modifie un bien existant : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-1", title: "Studio Centre-ville" })]));
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-1", title: "Studio Rénové" })]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const fields = getFormFields();
    const titleInput = fields.title as HTMLInputElement;
    expect(titleInput.value).toBe("Studio Centre-ville");
    await user.clear(titleInput);
    await user.type(titleInput, "Studio Rénové");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/properties/prop-1");
    expect(formDataEntries(formData as FormData).title).toBe("Studio Rénové");
  });

  it("supprime un bien après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-1" })]));
    mockedApi.get.mockResolvedValueOnce(paginatedOwners());
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/properties/prop-1"));
  });

  describe("synthèse, recherche et vues", () => {
    const parc = [
      property({ id: "p1", title: "Villa Baobab", address: "Almadies, Dakar", surface: 120, rent: 1200, status: "OCCUPIED", ownerId: "o1" }),
      property({ id: "p2", title: "Studio Plateau", address: "Plateau, Dakar", surface: 25, rent: 400, status: "AVAILABLE" }),
      property({ id: "p3", title: "Atelier Mermoz", address: "Mermoz, Dakar", surface: 60, rent: 700, status: "OCCUPIED" }),
      property({ id: "p4", title: "Loft Sacré-Cœur", address: "Sacré-Cœur, Dakar", surface: 80, rent: 900, status: "MAINTENANCE" }),
    ];
    const proprietaire: Owner = {
      id: "o1",
      firstName: "Awa",
      lastName: "Ndiaye",
      companyName: "SCI Baobab",
      email: "awa@exemple.com",
      phone: "+221770000000",
      managementFeeRate: 8,
      portalStatus: "NONE",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    async function afficher() {
      mockedApi.get.mockImplementation(async (url: string) => (url === "/owners" ? paginatedOwners([proprietaire]) : paginated(parc)));
      renderPage();
      await screen.findByText("Villa Baobab");
    }

    it("résume le parc : occupation, loyers loués et manque à gagner", async () => {
      await afficher();
      const synthese = screen.getByLabelText("Synthèse du parc");
      expect(within(synthese).getByText("50 %")).toBeInTheDocument();
      expect(within(synthese).getByText("1 900 €")).toBeInTheDocument();
      expect(within(synthese).getByText("400 €")).toBeInTheDocument();
    });

    it("filtre par statut en indiquant l'effectif de chaque statut", async () => {
      const user = userEvent.setup();
      await afficher();
      const filtres = screen.getByRole("group", { name: "Filtrer par statut" });
      expect(within(filtres).getByRole("button", { name: /Tous\s*4/ })).toHaveAttribute("aria-pressed", "true");
      await user.click(within(filtres).getByRole("button", { name: /Occupé\s*2/ }));
      expect(screen.getByText("Villa Baobab")).toBeInTheDocument();
      expect(screen.queryByText("Studio Plateau")).not.toBeInTheDocument();
    });

    it("cherche sans tenir compte des accents ni de la casse, y compris dans le nom du propriétaire", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "sacre coeur");
      expect(screen.getByText("Loft Sacré-Cœur")).toBeInTheDocument();
      expect(screen.queryByText("Villa Baobab")).not.toBeInTheDocument();

      await user.clear(screen.getByRole("searchbox"));
      await user.type(screen.getByRole("searchbox"), "sci baobab");
      expect(screen.getByText("Villa Baobab")).toBeInTheDocument();
      expect(screen.queryByText("Studio Plateau")).not.toBeInTheDocument();
    });

    it("propose de réinitialiser quand rien ne correspond", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "zzzz");
      expect(screen.getByText("Aucun résultat pour ces critères.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));
      expect(screen.getByText("Villa Baobab")).toBeInTheDocument();
    });

    it("trie par loyer décroissant", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.selectOptions(screen.getByLabelText("Trier par"), "Loyer décroissant");
      const titres = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(titres.filter((t) => t !== "Synthèse du parc")).toEqual(["Villa Baobab", "Loft Sacré-Cœur", "Atelier Mermoz", "Studio Plateau"]);
    });

    it("nomme le propriétaire de chaque bien", async () => {
      await afficher();
      expect(screen.getByText("Propriétaire : SCI Baobab")).toBeInTheDocument();
      expect(screen.getAllByText("Sans propriétaire")).toHaveLength(3);
    });

    it("bascule en vue tableau, avec le loyer au m², et mémorise le choix", async () => {
      const user = userEvent.setup();
      localStorage.removeItem("immoplatform.biens.vue");
      await afficher();
      await user.click(screen.getByRole("button", { name: "Tableau" }));
      const tableau = screen.getByRole("table");
      const ligne = within(tableau).getByText("Villa Baobab").closest("tr") as HTMLElement;
      expect(within(ligne).getByText("10 €")).toBeInTheDocument();
      expect(localStorage.getItem("immoplatform.biens.vue")).toBe("tableau");
      await user.click(screen.getByRole("button", { name: "Cartes" }));
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      localStorage.removeItem("immoplatform.biens.vue");
    });

    it("exporte les biens affichés en CSV", async () => {
      const user = userEvent.setup();
      let blob: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", { value: (b: Blob) => ((blob = b), "blob:test"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      await afficher();
      await user.type(screen.getByRole("searchbox"), "plateau");
      await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
      const texte = await new Promise<string>((resolve) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.readAsText(blob!);
      });
      const lignes = texte.split("\n");
      expect(lignes).toHaveLength(2);
      expect(lignes[1]).toContain('"Studio Plateau"');
      expect(lignes[1]).toContain("400,00");
    });
  });
});
