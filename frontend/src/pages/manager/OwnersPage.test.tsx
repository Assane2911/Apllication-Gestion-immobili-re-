import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Owner, PaginatedResponse } from "../../types";
import OwnersPage from "./OwnersPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function owner(overrides: Partial<Owner> = {}): Owner {
  return {
    id: "own-1",
    civility: "MME",
    firstName: "Awa",
    lastName: "Diallo",
    companyName: null,
    email: "awa@example.com",
    phone: "+221771223344",
    address: null,
    iban: null,
    bic: null,
    managementFeeRate: 8,
    notes: null,
    portalStatus: "NONE",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Owner[]): { data: PaginatedResponse<Owner> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

type LigneSynthese = { ownerId: string; ownerName: string; hasIban: boolean; resteByCurrency: Record<string, number> };

// Reproduit l'ordre des appels de load() : /owners, puis la synthèse des reversements du mois écoulé.
function queueOwners(items: Owner[], synthese: LigneSynthese[] = []) {
  mockedApi.get.mockResolvedValueOnce(paginated(items));
  mockedApi.get.mockResolvedValueOnce({ data: { month: 9, year: 2026, owners: synthese } });
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter>
          <OwnersPage />
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("OwnersPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des propriétaires (nom, téléphone, email, commission)", async () => {
    queueOwners([owner()]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
    expect(screen.getAllByText("+221771223344").length).toBeGreaterThan(0);
    expect(screen.getAllByText("awa@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aucun accès").length).toBeGreaterThan(0);
  });

  it("la colonne des boutons d'action a un en-tête lisible par un lecteur d'écran", async () => {
    queueOwners([owner()]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });

  it("affiche l'état vide avec un bouton d'ajout", async () => {
    queueOwners([]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun propriétaire pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    queueOwners([owner()]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
  });

  it("crée un propriétaire : envoie les champs renseignés, sans les champs facultatifs vides", async () => {
    const user = userEvent.setup();
    queueOwners([]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "own-new" } });
    queueOwners([owner({ id: "own-new" })]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" })[0]);

    await user.type(screen.getByLabelText("Prénom"), "Moussa");
    await user.type(screen.getByLabelText("Nom"), "Traoré");
    await user.type(screen.getByLabelText("Téléphone"), "77 122 33 44");
    await user.type(screen.getByLabelText("Email"), "moussa@example.com");
    await user.clear(screen.getByLabelText("Taux de commission (%)"));
    await user.type(screen.getByLabelText("Taux de commission (%)"), "10");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/owners");
    expect(body).toMatchObject({
      firstName: "Moussa",
      lastName: "Traoré",
      email: "moussa@example.com",
      phone: "+221771223344",
      managementFeeRate: "10",
      civility: undefined,
      companyName: undefined,
      address: undefined,
      iban: undefined,
      bic: undefined,
      notes: undefined,
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  describe("langue des e-mails du propriétaire", () => {
    it("propose les quatre langues et la langue de l'interface par défaut", async () => {
      const user = userEvent.setup();
      queueOwners([]);
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" })[0]);

      const champ = screen.getByLabelText("Langue des e-mails") as HTMLSelectElement;
      expect(Array.from(champ.options).map((o) => [o.value, o.textContent])).toEqual([
        ["fr", "Français"],
        ["en", "English"],
        ["pt", "Português"],
        ["es", "Español"],
      ]);
      expect(champ.value).toBe("fr");
    });

    it("envoie la langue choisie avec la fiche", async () => {
      const user = userEvent.setup();
      queueOwners([]);
      mockedApi.post.mockResolvedValueOnce({ data: { id: "own-new" } });
      queueOwners([]);
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" })[0]);

      await user.type(screen.getByLabelText("Prénom"), "Moussa");
      await user.type(screen.getByLabelText("Nom"), "Traoré");
      await user.type(screen.getByLabelText("Téléphone"), "77 122 33 44");
      await user.type(screen.getByLabelText("Email"), "moussa@example.com");
      await user.selectOptions(screen.getByLabelText("Langue des e-mails"), "es");
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      expect(mockedApi.post.mock.calls[0][1]).toMatchObject({ language: "es" });
    });

    it("à la modification, montre la langue enregistrée, ou le français pour une fiche d'avant", async () => {
      const user = userEvent.setup();
      queueOwners([owner({ language: "pt" })]);
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
      expect((screen.getByLabelText("Langue des e-mails") as HTMLSelectElement).value).toBe("pt");
    });

    it("une fiche sans langue (d'avant) s'ouvre en français", async () => {
      const user = userEvent.setup();
      queueOwners([owner({ language: null })]);
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
      expect((screen.getByLabelText("Langue des e-mails") as HTMLSelectElement).value).toBe("fr");
    });
  });

  it("modifie un propriétaire existant : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    queueOwners([owner({ id: "own-1", companyName: "SCI Diallo" })]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueOwners([owner({ id: "own-1", lastName: "Diallo-Ndiaye" })]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

    const lastNameInput = screen.getByLabelText("Nom") as HTMLInputElement;
    expect(lastNameInput.value).toBe("Diallo");
    expect((screen.getByLabelText("Raison sociale (optionnel)") as HTMLInputElement).value).toBe("SCI Diallo");
    await user.clear(lastNameInput);
    await user.type(lastNameInput, "Diallo-Ndiaye");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/owners/own-1");
    expect(body).toMatchObject({ lastName: "Diallo-Ndiaye", companyName: "SCI Diallo" });
  });

  it("à la modification seulement, prévient qu'un nouveau taux vaut à partir du mois en cours", async () => {
    const user = userEvent.setup();
    queueOwners([owner({ id: "own-1" })]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
    const mention = /à partir du mois en cours/;

    await user.click(screen.getByRole("button", { name: "+ Ajouter un propriétaire" }));
    expect(screen.queryByText(mention)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    expect(screen.getByText(mention)).toBeInTheDocument();
  });

  it("supprime un propriétaire après confirmation", async () => {
    const user = userEvent.setup();
    queueOwners([owner({ id: "own-1" })]);
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    queueOwners([]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/owners/own-1"));
  });

  it("invite un propriétaire sans accès portail, puis affiche la confirmation d'envoi", async () => {
    const user = userEvent.setup();
    queueOwners([owner({ id: "own-1", portalStatus: "NONE" })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    queueOwners([owner({ id: "own-1", portalStatus: "PENDING" })]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Inviter" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Inviter" })[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/owners/own-1/invite"));
    await waitFor(() => expect(screen.getAllByText("Invitation envoyée avec succès.").length).toBeGreaterThan(0));
  });

  it("anonymise un propriétaire après confirmation (droit à l'effacement)", async () => {
    const user = userEvent.setup();
    queueOwners([owner({ id: "own-1" })]);
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    queueOwners([owner({ id: "own-1", anonymizedAt: "2026-10-04T00:00:00.000Z" })]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Anonymiser" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Anonymiser" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/owners/own-1/anonymiser"));
    await waitFor(() => expect(screen.getAllByText("Anonymisé").length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("button", { name: "Anonymiser" })).toHaveLength(0);
  });

  it("rappelle les reversements du mois écoulé restant à faire, avec un lien vers le CRG de ce mois", async () => {
    queueOwners(
      [owner({ id: "own-1" }), owner({ id: "own-2", firstName: "Moussa" })],
      [
        { ownerId: "own-1", ownerName: "Mme Awa Diallo", hasIban: false, resteByCurrency: { EUR: 300 } },
        { ownerId: "own-2", ownerName: "Moussa Diallo", hasIban: true, resteByCurrency: { EUR: 0 } },
      ]
    );
    renderPage();

    const encart = await screen.findByRole("region", { name: /Reversements de .* à effectuer \(1\)/ });
    expect(encart).toHaveTextContent("Mme Awa Diallo");
    expect(encart).toHaveTextContent("Pas d'IBAN renseigné");
    expect(encart).not.toHaveTextContent("Moussa Diallo");
    expect(encart.querySelector("a")?.getAttribute("href")).toBe("/proprietaires/own-1/crg?month=9&year=2026");
    expect(mockedApi.get).toHaveBeenCalledWith("/crg/payouts/summary", expect.objectContaining({ params: expect.any(Object) }));
  });

  it("rien à reverser, ou une erreur sur la synthèse : pas d'encart, la liste reste utilisable", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([owner()]));
    mockedApi.get.mockRejectedValueOnce(new Error("panne"));
    renderPage();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/crg/payouts/summary", expect.anything()));
    expect(screen.getAllByText(/Awa/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: /Reversements de/ })).not.toBeInTheDocument();
  });

  describe("synthèse, recherche, filtres et IBAN", () => {
    const parc = [
      owner({ id: "o1", firstName: "Awa", lastName: "Diallo", iban: "FR7630006000011234567890189", portalStatus: "ACTIVE", managementFeeRate: 6 }),
      owner({ id: "o2", firstName: "Moussa", lastName: "Ba", companyName: "SCI Baobab", email: "moussa@example.com", portalStatus: "PENDING", managementFeeRate: 10 }),
      owner({ id: "o3", firstName: "Élodie", lastName: "Sow", email: "elodie@example.com", iban: "FR7630006000011234567890189", managementFeeRate: 8 }),
      owner({ id: "o4", firstName: "Ibrahima", lastName: "Fall", email: "ibra@example.com", managementFeeRate: 12 }),
    ];

    async function afficher(synthese: LigneSynthese[] = []) {
      queueOwners(parc, synthese);
      renderPage();
      await screen.findByRole("table");
    }

    const lignes = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

    it("résume les accès, la commission moyenne et les propriétaires sans IBAN", async () => {
      await afficher();
      const synthese = screen.getByLabelText("Synthèse des propriétaires");
      expect(within(synthese).getByText("1 / 4")).toBeInTheDocument();
      expect(within(synthese).getByText("1 invité(s), 2 sans accès")).toBeInTheDocument();
      expect(within(synthese).getByText("9 %")).toBeInTheDocument();
      expect(within(synthese).getByText("2")).toBeInTheDocument(); // sans IBAN
    });

    it("filtre les propriétaires sans accès, invités ou sans IBAN", async () => {
      const user = userEvent.setup();
      await afficher();
      const filtres = screen.getByRole("group", { name: "Filtrer les propriétaires" });

      await user.click(within(filtres).getByRole("button", { name: /Invités\s*1/ }));
      expect(lignes()).toHaveLength(1);
      expect(lignes()[0]).toContain("Moussa Ba");

      await user.click(within(filtres).getByRole("button", { name: /Sans IBAN\s*2/ }));
      expect(lignes()).toHaveLength(2);
    });

    it("cherche par société, et trie par commission décroissante", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "sci baobab");
      expect(lignes()).toHaveLength(1);
      expect(lignes()[0]).toContain("Moussa Ba");

      await user.clear(screen.getByRole("searchbox"));
      await user.selectOptions(screen.getByLabelText("Trier par"), "Commission décroissante");
      expect(lignes().map((l) => ["Ibrahima", "Moussa", "Élodie", "Awa"].find((p) => l.includes(p)))).toEqual(["Ibrahima", "Moussa", "Élodie", "Awa"]);
    });

    it("totalise les reversements à effectuer devise par devise", async () => {
      await afficher([
        { ownerId: "o1", ownerName: "Awa Diallo", hasIban: true, resteByCurrency: { EUR: 400 } },
        { ownerId: "o3", ownerName: "Élodie Sow", hasIban: false, resteByCurrency: { EUR: 250, XOF: 300000 } },
      ]);
      const bloc = await screen.findByRole("region", { name: /Reversements de/ });
      expect(within(bloc).getByText(/Total à reverser : 650 € \+ 300 000/)).toBeInTheDocument();
      expect(within(bloc).getByText("Pas d'IBAN renseigné")).toBeInTheDocument();
    });

    it("exporte les propriétaires en CSV, sans l'IBAN", async () => {
      const user = userEvent.setup();
      let blob: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", { value: (b: Blob) => ((blob = b), "blob:test"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      await afficher();
      await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
      const texte = await new Promise<string>((resolve) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.readAsText(blob!);
      });
      expect(texte.split("\n")).toHaveLength(5);
      expect(texte).not.toContain("FR7630");
      expect(texte).toContain('"SCI Baobab"');
    });
  });

  it("indique si la clé de contrôle de l'IBAN saisi est valide, sans bloquer l'enregistrement", async () => {
    const user = userEvent.setup();
    queueOwners([]);
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: "+ Ajouter un propriétaire" }))[0]);

    const iban = screen.getByLabelText(/IBAN/);
    await user.type(iban, "FR7630006000011234567890189");
    expect(screen.getByText("Clé de contrôle valide")).toBeInTheDocument();
    await user.clear(iban);
    await user.type(iban, "FR7630006000011234567890180");
    expect(screen.getByText("La clé de contrôle ne correspond pas : vérifiez la saisie.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();

    await user.type(screen.getByLabelText(/BIC/), "ABC");
    expect(screen.getByText("Un BIC compte 8 ou 11 caractères.")).toBeInTheDocument();
  });
});
