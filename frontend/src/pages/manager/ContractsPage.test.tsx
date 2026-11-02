import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import { changerLangue } from "../../i18n";
import type { Contract, PaginatedResponse, Property, Tenant } from "../../types";
import ContractsPage, { changementsDuContrat, formulaireDepuisContrat } from "./ContractsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

// jsdom n'implémente pas l'API Canvas : on la stub pour pouvoir tester le
// parcours complet de signature électronique (SignatureModal) sans crasher.
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  lineWidth: 0,
  lineCap: "",
  lineJoin: "",
  strokeStyle: "",
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = vi
  .fn()
  .mockReturnValue("data:image/png;base64,fake") as unknown as typeof HTMLCanvasElement.prototype.toDataURL;

const DAY_MS = 24 * 60 * 60 * 1000;

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    title: "Studio Centre-ville",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 500,
    currency: "EUR",
    status: "AVAILABLE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "ten-1",
    firstName: "Awa",
    lastName: "Diallo",
    phone: "0600000000",
    email: "awa@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    propertyId: "prop-1",
    tenantId: "ten-1",
    rent: 500,
    deposit: 1000,
    currency: "EUR",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: new Date(Date.now() + 200 * DAY_MS).toISOString(),
    status: "ACTIVE",
    signedByManagerAt: null,
    signedByTenantAt: null,
    property: { title: "Studio Centre-ville" } as unknown as Property,
    tenant: { firstName: "Awa", lastName: "Diallo" } as unknown as Tenant,
    ...overrides,
  };
}

function paginated<T>(items: T[]): { data: PaginatedResponse<T> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

// Reproduit l'ordre fixe des appels de load() : /contracts, /properties, /tenants
// (Promise.all), puis /contracts/revisions-due une fois la liste chargée.
function queueLoad(contracts: Contract[], properties: Property[] = [], tenants: Tenant[] = [], aReviser: unknown[] = []) {
  mockedApi.get.mockResolvedValueOnce(paginated(contracts));
  mockedApi.get.mockResolvedValueOnce(paginated(properties));
  mockedApi.get.mockResolvedValueOnce(paginated(tenants));
  mockedApi.get.mockResolvedValueOnce({ data: aReviser });
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <ContractsPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("ContractsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des contrats avec loyer, durée, statut et signatures", async () => {
    queueLoad([contract({ id: "c1" })]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
    expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Actif").length).toBeGreaterThan(0);
    expect(screen.getAllByText("500 €").length).toBeGreaterThan(0);
    // Aucune signature encore posée : bouton "Signer" pour l'agence, mention "En attente" pour le locataire.
    expect(screen.getAllByRole("button", { name: /Signer/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("En attente").length).toBeGreaterThan(0);
  });

  it("le bouton de remplacement du scan suit la langue choisie (il était écrit en dur en français)", async () => {
    await changerLangue("en");
    try {
      queueLoad([contract({ id: "c1", scannedContractUrl: "https://stockage.test/scan.pdf" })]);
      renderPage();

      await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
      expect(screen.getAllByText("Replace scan").length).toBeGreaterThan(0);
      expect(screen.queryByText("Remplacer scan")).not.toBeInTheDocument();
    } finally {
      await changerLangue("fr");
    }
  });

  it("propose « Remplacer scan » en français quand un scan existe déjà", async () => {
    queueLoad([contract({ id: "c1", scannedContractUrl: "https://stockage.test/scan.pdf" })]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Remplacer scan").length).toBeGreaterThan(0));
  });

  it("les boutons d'action du tableau passent à la ligne au lieu d'élargir le tableau hors de l'écran", async () => {
    queueLoad([contract({ id: "c1" })]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
    const cellule = screen.getAllByRole("button", { name: /Bail PDF/ })[0].closest("td");
    expect(cellule?.className).not.toContain("whitespace-nowrap");
    expect(cellule?.querySelector(".flex-wrap")).not.toBeNull();
  });

  it("affiche le bail comme signé quand signedByManagerAt/signedByTenantAt sont renseignés", async () => {
    queueLoad([contract({ signedByManagerAt: "2026-02-01T00:00:00.000Z", signedByTenantAt: "2026-02-02T00:00:00.000Z" })]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Signé").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Signer/ })).not.toBeInTheDocument();
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    queueLoad([contract({ id: "c1" })]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
  });

  it("crée un nouveau contrat : pré-remplit loyer/dépôt depuis le bien choisi et envoie le bon payload", async () => {
    const user = userEvent.setup();
    queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
    queueLoad([]); // rechargement après création

    const { container } = renderPage();

    await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "prop-1");
    await user.selectOptions(selects[1], "ten-1");

    const rentInput = screen.getAllByRole("spinbutton")[0];
    const depositInput = screen.getAllByRole("spinbutton")[1];
    expect(rentInput).toHaveValue(500);
    expect(depositInput).toHaveValue(1000);

    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-03-01" } });

    await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/contracts", {
        propertyId: "prop-1",
        tenantId: "ten-1",
        rent: "500",
        deposit: "1000",
        startDate: "2026-03-01",
        endDate: "2027-03-01",
        paymentDay: 5,
        leaseType: "HABITATION",
      })
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Créer le contrat" })).not.toBeInTheDocument());
  });

  it("envoie les clauses particulières saisies (sans espaces superflus), et les imprime sur le bail", async () => {
    const user = userEvent.setup();
    queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
    queueLoad([]);

    const { container } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "prop-1");
    await user.selectOptions(selects[1], "ten-1");
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-03-01" } });

    const champ = screen.getByLabelText("Clauses particulières (facultatif)");
    expect(champ).toHaveAttribute("maxlength", "10000");
    expect(screen.getByText(/ne pourront plus être modifiées une fois le bail signé/)).toBeInTheDocument();
    await user.type(champ, "  Animaux interdits.  ");
    await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/contracts", {
        propertyId: "prop-1",
        tenantId: "ten-1",
        rent: "500",
        deposit: "1000",
        startDate: "2026-03-01",
        endDate: "2027-03-01",
        terms: "Animaux interdits.",
        paymentDay: 5,
        leaseType: "HABITATION",
      })
    );
  });

  it("n'envoie pas de clauses quand le champ reste vide ou ne contient que des espaces", async () => {
    const user = userEvent.setup();
    queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
    queueLoad([]);

    const { container } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "prop-1");
    await user.selectOptions(selects[1], "ten-1");
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-03-01" } });
    await user.type(screen.getByLabelText("Clauses particulières (facultatif)"), "   ");
    await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post.mock.calls[0][1]).not.toHaveProperty("terms");
  });

  it("insère le modèle de clause de caution, et refuse d'enregistrer tant qu'il reste des passages entre crochets", async () => {
    const user = userEvent.setup();
    queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);

    const { container } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "prop-1");
    await user.selectOptions(selects[1], "ten-1");
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-03-01" } });

    const champ = screen.getByLabelText("Clauses particulières (facultatif)") as HTMLTextAreaElement;
    await user.click(screen.getByRole("button", { name: "Insérer un modèle de clause de caution" }));
    expect(champ.value).toContain("Engagement de caution");
    expect(screen.getByText(/faites-le valider par un juriste/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Créer le contrat" }));
    expect(await screen.findByText(/complétez-les ou retirez-les avant d.enregistrer/)).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("enregistre la clause de caution une fois complétée", async () => {
    const user = userEvent.setup();
    queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
    queueLoad([]);

    const { container } = renderPage();
    await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "prop-1");
    await user.selectOptions(selects[1], "ten-1");
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-03-01" } });

    const champ = screen.getByLabelText("Clauses particulières (facultatif)") as HTMLTextAreaElement;
    await user.click(screen.getByRole("button", { name: "Insérer un modèle de clause de caution" }));
    fireEvent.change(champ, { target: { value: champ.value.replace(/\[[^\]]*\]/g, "X") } });
    await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(String((mockedApi.post.mock.calls[0][1] as { terms: string }).terms)).toContain("Engagement de caution");
  });

  it("propose de réviser le loyer d'un bail actif seulement, et ouvre la fenêtre de révision", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1" }), contract({ id: "c2", status: "ENDED" })]);
    // Historique chargé à l'ouverture de la fenêtre.
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Réviser le loyer" }).length).toBeGreaterThan(0));
    // Deux contrats, un seul actif : un lien par présentation (tableau + cartes) pour le seul bail actif.
    const liens = screen.getAllByRole("button", { name: "Réviser le loyer" });
    expect(liens.length).toBeLessThanOrEqual(2);

    await user.click(liens[0]);
    expect(await screen.findByRole("dialog", { name: "Réviser le loyer" })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/c1/rent-revisions"));
  });

  it("rappelle les baux à réviser et ouvre la révision au premier mois proposé", async () => {
    const user = userEvent.setup();
    const dans3Mois = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 3, 1)).toISOString();
    queueLoad([contract({ id: "c1" })], [], [], [
      {
        contractId: "c1",
        propertyTitle: "Studio Centre-ville",
        tenantName: "Awa Diallo",
        rent: 500,
        currency: "EUR",
        endDate: new Date(Date.now() + 400 * DAY_MS).toISOString(),
        anniversaire: dans3Mois,
        dateSuggeree: dans3Mois,
      },
    ]);
    mockedApi.get.mockResolvedValueOnce({ data: [] }); // historique de la fenêtre
    renderPage();

    const encart = await screen.findByRole("region", { name: "Baux à réviser (1)" });
    expect(within(encart).getByText("Studio Centre-ville")).toBeInTheDocument();
    expect(within(encart).getByText(/loyer actuel 500 €/)).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/revisions-due", expect.anything()));

    await user.click(within(encart).getByRole("button", { name: "Réviser" }));
    const fenetre = await screen.findByRole("dialog", { name: "Réviser le loyer" });
    expect((within(fenetre).getByLabelText("À compter du mois de") as HTMLSelectElement).value).toBe(dans3Mois.slice(0, 10));
  });

  it("sans bail à réviser, aucun encart", async () => {
    queueLoad([contract({ id: "c1" })]);
    renderPage();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/revisions-due", expect.anything()));
    expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: /Baux à réviser/ })).not.toBeInTheDocument();
  });

  it("une erreur sur le rappel des révisions ne gêne pas la page", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([contract({ id: "c1" })]));
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockRejectedValueOnce(new Error("panne"));
    renderPage();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/revisions-due", expect.anything()));
    expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: /Baux à réviser/ })).not.toBeInTheDocument();
    expect(screen.queryByText("panne")).not.toBeInTheDocument();
  });

  it("affiche le nombre de garants et ouvre leur gestion, en consultation seule si le bail est signé", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", guarantorsCount: 2, signedByTenantAt: "2026-02-01T00:00:00.000Z" })]);
    mockedApi.get.mockResolvedValueOnce({ data: [] }); // garants chargés à l'ouverture
    renderPage();

    const liens = await screen.findAllByRole("button", { name: "Garants (2)" });
    await user.click(liens[0]);
    expect(await screen.findByRole("dialog", { name: "Garants du bail" })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/c1/guarantors"));
    expect(screen.getByText(/signé par le locataire : ses garants/)).toBeInTheDocument();
  });

  it("affiche les colocataires à côté du titulaire et ouvre leur gestion", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", cotenantNames: ["Binta Kane"] })], [], [tenant({ id: "ten-1" }), tenant({ id: "ten-2", firstName: "Binta" })]);
    mockedApi.get.mockResolvedValueOnce({ data: [] }); // colocataires chargés à l'ouverture
    renderPage();

    expect((await screen.findAllByText(/Binta Kane/)).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Colocataires (1)" })[0]);
    expect(await screen.findByRole("dialog", { name: "Colocataires du bail" })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/c1/cotenants"));
  });

  it("modifier un contrat : formulaire pré-rempli, seuls les champs changés partent au serveur", async () => {
    const user = userEvent.setup();
    const c = contract({ id: "c1", rent: 500, deposit: 1000, startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-12-31T00:00:00.000Z", paymentDay: 5, terms: "Clause A" });
    queueLoad([c], [property({ id: "prop-1", status: "OCCUPIED" })], [tenant({ id: "ten-1" })]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([c]);
    renderPage();

    await user.click((await screen.findAllByRole("button", { name: "Modifier" }))[0]);
    expect(screen.getByText("Modifier le contrat")).toBeInTheDocument();
    // Le bien du contrat reste proposé bien qu'occupé (par ce contrat).
    expect(screen.getByLabelText(/Bien/)).toHaveValue("prop-1");
    expect(screen.getByLabelText(/Loyer/)).toHaveValue(500);
    expect(screen.getByLabelText(/Date de début/)).toHaveValue("2026-01-01");

    await user.clear(screen.getByLabelText(/Loyer/));
    await user.type(screen.getByLabelText(/Loyer/), "650");
    await user.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1", { rent: 650 }));
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("pas de lien « Modifier » sur un bail signé par le locataire", async () => {
    queueLoad([contract({ id: "c1", signedByTenantAt: "2026-02-01T00:00:00.000Z" })]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });

  it("workflow de renouvellement : propose de renouveler quand le bail expire bientôt", async () => {
    const user = userEvent.setup();
    const soon = contract({ id: "c1", endDate: new Date(Date.now() + 5 * DAY_MS).toISOString() });
    queueLoad([soon]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    queueLoad([soon]);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Renouveler/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByText("Ne pas renouveler").length).toBeGreaterThan(0);

    const buttons = screen.getAllByRole("button", { name: /Renouveler/ });
    await user.click(buttons[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/renew", { months: 12 }));
  });

  it('"Ne pas renouveler" termine le contrat (statut ENDED)', async () => {
    const user = userEvent.setup();
    const soon = contract({ id: "c1", endDate: new Date(Date.now() + 5 * DAY_MS).toISOString() });
    queueLoad([soon]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([soon]);

    renderPage();

    await waitFor(() => expect(screen.getAllByText("Ne pas renouveler").length).toBeGreaterThan(0));
    const buttons = screen.getAllByText("Ne pas renouveler");
    await user.click(buttons[0]);

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1", { status: "ENDED" }));
  });

  it("résilier un contrat actif envoie le bon statut", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", status: "ACTIVE" })]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([contract({ id: "c1", status: "TERMINATED" })]);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Résilier" }).length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole("button", { name: "Résilier" });
    await user.click(buttons[0]);

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1", { status: "TERMINATED" }));
  });

  /**
   * Régression : "Résilier" n'avait pas de confirmation, contrairement à
   * "Supprimer" et "Renouveler" juste à côté — un clic malheureux résiliait
   * immédiatement un bail actif (arrêt de la facturation du locataire).
   */
  it("résilier un contrat actif demande confirmation, et n'envoie rien si l'utilisateur refuse", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", status: "ACTIVE" })]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Résilier" }).length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole("button", { name: "Résilier" });
    await user.click(buttons[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it("supprimer un contrat après confirmation", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1" })]);
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    queueLoad([]);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole("button", { name: "Supprimer" });
    await user.click(buttons[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/contracts/c1"));
  });

  it("signer le bail : ouvre la modale de signature, dessine et enregistre la signature", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", signedByManagerAt: null })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    queueLoad([contract({ id: "c1", signedByManagerAt: "2026-05-01T00:00:00.000Z" })]);

    const { container } = renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Signer/ }).length).toBeGreaterThan(0));
    const signButtons = screen.getAllByRole("button", { name: /Signer/ });
    await user.click(signButtons[0]);

    await waitFor(() => expect(screen.getByText(/Bail - Studio Centre-ville/)).toBeInTheDocument());

    const canvas = container.querySelector("canvas")!;
    fireEvent.mouseDown(canvas);

    await user.click(screen.getByRole("button", { name: "Valider ma signature" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/sign", {
        signatureDataUrl: "data:image/png;base64,fake",
      })
    );
    await waitFor(() => expect(screen.queryByText(/Bail - Studio Centre-ville/)).not.toBeInTheDocument());
  });

  describe("restitution du dépôt de garantie", () => {
    it("n'affiche pas le bouton de restitution sur un contrat actif", async () => {
      queueLoad([contract({ id: "c1", status: "ACTIVE" })]);
      renderPage();

      await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: /Restituer le dépôt/ })).not.toBeInTheDocument();
    });

    it("enregistre une restitution intégrale sans retenue", async () => {
      const user = userEvent.setup();
      queueLoad([contract({ id: "c1", status: "ENDED", deposit: 1000 })]);
      mockedApi.put.mockResolvedValueOnce({ data: {} });
      queueLoad([contract({ id: "c1", status: "ENDED", deposit: 1000, depositRefundedAt: "2026-06-01T00:00:00.000Z", depositDeductions: [] })]);

      renderPage();

      await waitFor(() => expect(screen.getAllByRole("button", { name: /Restituer le dépôt/ }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: /Restituer le dépôt/ })[0]);

      await waitFor(() => expect(screen.getByText("Restitution du dépôt de garantie")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Enregistrer la restitution" }));

      await waitFor(() =>
        expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1/deposit-refund", { deductions: [] })
      );
    });

    it("enregistre une restitution avec une retenue ajoutée dans la modale", async () => {
      const user = userEvent.setup();
      queueLoad([contract({ id: "c1", status: "TERMINATED", deposit: 1000 })]);
      mockedApi.put.mockResolvedValueOnce({ data: {} });
      queueLoad([
        contract({
          id: "c1",
          status: "TERMINATED",
          deposit: 1000,
          depositRefundedAt: "2026-06-01T00:00:00.000Z",
          depositDeductions: [{ label: "Nettoyage", amount: 50 }],
        }),
      ]);

      renderPage();

      await waitFor(() => expect(screen.getAllByRole("button", { name: /Restituer le dépôt/ }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: /Restituer le dépôt/ })[0]);

      await waitFor(() => expect(screen.getByText("Restitution du dépôt de garantie")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: /Ajouter une retenue/ }));
      await user.type(screen.getByPlaceholderText("Motif"), "Nettoyage");
      await user.type(screen.getByPlaceholderText("Montant"), "50");
      await user.click(screen.getByRole("button", { name: "Enregistrer la restitution" }));

      await waitFor(() =>
        expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1/deposit-refund", {
          deductions: [{ label: "Nettoyage", amount: 50 }],
        })
      );
    });

    it("annule une restitution déjà enregistrée après confirmation", async () => {
      const user = userEvent.setup();
      queueLoad([
        contract({ id: "c1", status: "ENDED", deposit: 1000, depositRefundedAt: "2026-06-01T00:00:00.000Z", depositDeductions: [] }),
      ]);
      mockedApi.put.mockResolvedValueOnce({ data: {} });
      queueLoad([contract({ id: "c1", status: "ENDED", deposit: 1000, depositRefundedAt: null, depositDeductions: null })]);

      renderPage();

      await waitFor(() => expect(screen.getAllByRole("button", { name: /Dépôt restitué/ }).length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: /Dépôt restitué/ })[0]);

      expect(window.confirm).toHaveBeenCalled();
      await waitFor(() =>
        expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1/deposit-refund", { deductions: null })
      );
    });
  });

  /**
   * Un bail créé avec une date de début passée recevait une facture par mois depuis cette date, toutes « en retard » : neuf
   * notifications pour un bail commencé en janvier. Le formulaire propose maintenant « Facturer à partir du », seulement quand
   * le bail commence avant le mois en cours ; vide, il garde le comportement d'avant.
   */
  describe("début de la facturation (bail commencé dans le passé)", () => {
    async function ouvrirFormulaire(debut: string) {
      const user = userEvent.setup();
      queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
      const rendu = renderPage();
      await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));
      await user.selectOptions(screen.getAllByRole("combobox")[0], "prop-1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "ten-1");
      const dates = rendu.container.querySelectorAll('input[type="date"]');
      fireEvent.change(dates[0], { target: { value: debut } });
      fireEvent.change(dates[1], { target: { value: "2101-01-01" } });
      return { user };
    }

    it("n'apparaît pas pour un bail qui commence plus tard que ce mois-ci", async () => {
      await ouvrirFormulaire("2099-01-01");
      expect(screen.queryByLabelText("Facturer à partir du")).not.toBeInTheDocument();
    });

    it("apparaît pour un bail commencé dans le passé, vide par défaut : rien n'est envoyé", async () => {
      const { user } = await ouvrirFormulaire("2020-01-01");
      expect(screen.getByLabelText("Facturer à partir du")).toHaveValue("");
      mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
      queueLoad([]);

      await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      expect(mockedApi.post.mock.calls[0][1]).not.toHaveProperty("billingFrom");
    });

    it("envoie la date choisie", async () => {
      const { user } = await ouvrirFormulaire("2020-01-01");
      fireEvent.change(screen.getByLabelText("Facturer à partir du"), { target: { value: "2020-06-01" } });
      mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
      queueLoad([]);

      await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts", expect.objectContaining({ startDate: "2020-01-01", billingFrom: "2020-06-01" })));
    });

    it("« Mois en cours » règle la date au premier jour du mois courant", async () => {
      const { user } = await ouvrirFormulaire("2020-01-01");
      const maintenant = new Date();
      const attendu = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-01`;

      await user.click(screen.getByRole("button", { name: "Mois en cours" }));

      expect(screen.getByLabelText("Facturer à partir du")).toHaveValue(attendu);
    });

    it("n'est pas proposé à la modification d'un bail, et ne part jamais avec les changements", async () => {
      const user = userEvent.setup();
      const c = contract({ id: "c1", rent: 500, deposit: 1000, startDate: "2020-01-01T00:00:00.000Z", endDate: "2101-01-01T00:00:00.000Z", paymentDay: 5 });
      queueLoad([c], [property({ id: "prop-1", status: "OCCUPIED" })], [tenant({ id: "ten-1" })]);
      renderPage();

      await user.click((await screen.findAllByRole("button", { name: "Modifier" }))[0]);

      expect(screen.queryByLabelText("Facturer à partir du")).not.toBeInTheDocument();
      expect(changementsDuContrat(formulaireDepuisContrat(c), { ...formulaireDepuisContrat(c), billingFrom: "2020-06-01" })).toEqual({});
    });
  });

  describe("jour d'échéance du loyer", () => {
    it("propose le 5 par défaut à la création, avec le repli « jour du début du bail », et l'envoie", async () => {
      const user = userEvent.setup();
      queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
      mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
      queueLoad([]);
      const { container } = renderPage();
      await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));

      const champ = screen.getByLabelText("Jour d'échéance du loyer");
      expect(champ).toHaveValue("5");
      expect(within(champ).getByRole("option", { name: "Jour du début du bail" })).toBeInTheDocument();
      expect(within(champ).getByRole("option", { name: "Dernier jour du mois" })).toBeInTheDocument();
      expect(within(champ).getAllByRole("option")).toHaveLength(30);

      await user.selectOptions(screen.getAllByRole("combobox")[0], "prop-1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "ten-1");
      const dates = container.querySelectorAll('input[type="date"]');
      fireEvent.change(dates[0], { target: { value: "2026-03-24" } });
      fireEvent.change(dates[1], { target: { value: "2027-03-23" } });
      await user.selectOptions(champ, "31");
      await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

      await waitFor(() =>
        expect(mockedApi.post).toHaveBeenCalledWith("/contracts", expect.objectContaining({ paymentDay: 31 }))
      );
    });

    it("« jour du début du bail » n'envoie aucun jour (le serveur garde le comportement d'avant)", async () => {
      const user = userEvent.setup();
      queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
      mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
      queueLoad([]);
      const { container } = renderPage();
      await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));
      await user.selectOptions(screen.getAllByRole("combobox")[0], "prop-1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "ten-1");
      const dates = container.querySelectorAll('input[type="date"]');
      fireEvent.change(dates[0], { target: { value: "2026-03-24" } });
      fireEvent.change(dates[1], { target: { value: "2027-03-23" } });
      await user.selectOptions(screen.getByLabelText("Jour d'échéance du loyer"), "");
      await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
      expect(mockedApi.post.mock.calls[0][1]).not.toHaveProperty("paymentDay");
    });

    it("affiche l'échéance de chaque contrat actif : le jour réglé, sinon le jour du début du bail", async () => {
      queueLoad([
        contract({ id: "a", paymentDay: 5 }),
        contract({ id: "b", paymentDay: null, startDate: "2026-01-24T00:00:00.000Z" }),
        contract({ id: "c", paymentDay: 31 }),
      ]);
      renderPage();
      await screen.findAllByText("Studio Centre-ville");
      expect(screen.getAllByText(/Échéance : le 5/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Échéance : le 24/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Échéance : dernier jour du mois/).length).toBeGreaterThan(0);
    });

    it("modifie le jour d'un contrat existant", async () => {
      const user = userEvent.setup();
      queueLoad([contract({ id: "a", paymentDay: null, startDate: "2026-01-24T00:00:00.000Z" })]);
      mockedApi.put.mockResolvedValueOnce({ data: {} });
      queueLoad([contract({ id: "a", paymentDay: 5 })]);
      renderPage();
      await screen.findAllByText("Studio Centre-ville");

      await user.click(screen.getAllByRole("button", { name: "Modifier l'échéance" })[0]);
      const fenetre = await screen.findByRole("dialog");
      const select = within(fenetre).getByLabelText("Jour d'échéance du loyer");
      expect(select).toHaveValue("");
      expect(within(fenetre).getByRole("option", { name: "Jour du début du bail (24)" })).toBeInTheDocument();
      await user.selectOptions(select, "5");
      await user.click(within(fenetre).getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/a", { paymentDay: 5 }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("ne propose plus de modifier l'échéance une fois le bail signé par le locataire", async () => {
      queueLoad([contract({ id: "a", signedByTenantAt: "2026-02-01T00:00:00.000Z" })]);
      renderPage();
      await screen.findAllByText("Studio Centre-ville");
      expect(screen.getAllByText(/Échéance : le/).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Modifier l'échéance" })).not.toBeInTheDocument();
    });
  });

  describe("type de bail et droit applicable", () => {
    async function remplir() {
      const user = userEvent.setup();
      queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
      mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
      queueLoad([]);
      const { container } = renderPage();
      await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));
      await user.selectOptions(screen.getAllByRole("combobox")[0], "prop-1");
      await user.selectOptions(screen.getAllByRole("combobox")[1], "ten-1");
      const dates = container.querySelectorAll('input[type="date"]');
      fireEvent.change(dates[0], { target: { value: "2026-03-01" } });
      fireEvent.change(dates[1], { target: { value: "2027-03-01" } });
      return user;
    }

    it("propose Habitation par défaut, avec les quatre types", async () => {
      await remplir();
      const champ = screen.getByLabelText("Type de bail");
      expect(champ).toHaveValue("HABITATION");
      expect(within(champ).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Habitation",
        "Habitation meublée",
        "Commercial",
        "Professionnel",
      ]);
    });

    it("envoie le type choisi et le droit applicable saisi (sans espaces superflus)", async () => {
      const user = await remplir();
      await user.selectOptions(screen.getByLabelText("Type de bail"), "COMMERCIAL");
      await user.type(screen.getByLabelText("Droit applicable (facultatif)"), "  Droit OHADA  ");
      expect(screen.getByText(/ne certifie pas|n'atteste pas la conformité/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

      await waitFor(() =>
        expect(mockedApi.post).toHaveBeenCalledWith(
          "/contracts",
          expect.objectContaining({ leaseType: "COMMERCIAL", applicableLaw: "Droit OHADA" })
        )
      );
    });

    it("n'envoie pas de droit applicable vide", async () => {
      const user = await remplir();
      await user.type(screen.getByLabelText("Droit applicable (facultatif)"), "   ");
      await user.click(screen.getByRole("button", { name: "Créer le contrat" }));
      await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
      expect(mockedApi.post.mock.calls[0][1]).not.toHaveProperty("applicableLaw");
    });
  });
});

describe("changementsDuContrat", () => {
  const avant = formulaireDepuisContrat(contract({ rent: 500, deposit: 1000, paymentDay: 5, terms: "A", applicableLaw: "Droit X" }));

  it("rien de changé : rien à envoyer", () => {
    expect(changementsDuContrat(avant, { ...avant })).toEqual({});
  });

  it("convertit les nombres, vide le jour d'échéance en null, nettoie les textes", () => {
    expect(changementsDuContrat(avant, { ...avant, rent: "650", deposit: "1300", paymentDay: "", terms: "  B  ", applicableLaw: "" })).toEqual({
      rent: 650,
      deposit: 1300,
      paymentDay: null,
      terms: "B",
      applicableLaw: "",
    });
  });

  it("un changement sur une mention du logement renvoie toutes les mentions, en un seul objet", () => {
    const base = formulaireDepuisContrat(contract({ housingMentions: { dpe: "D", chauffage: "Gaz" } }));
    expect(changementsDuContrat(base, { ...base })).toEqual({});
    expect(changementsDuContrat(base, { ...base, dpe: "C", loyerReference: "24,5" })).toEqual({
      housingMentions: { dpe: "C", chauffage: "Gaz", loyerReference: 24.5 },
    });
  });

  it("vider toutes les mentions envoie null, pas un objet vide", () => {
    const base = formulaireDepuisContrat(contract({ housingMentions: { dpe: "D" } }));
    expect(changementsDuContrat(base, { ...base, dpe: "" })).toEqual({ housingMentions: null });
  });

  it("les frais d'agence partent en nombre, ou null quand le champ est vidé", () => {
    const base = formulaireDepuisContrat(contract({ agencyFee: 100000 }));
    expect(base.agencyFee).toBe("100000");
    expect(changementsDuContrat(base, { ...base })).toEqual({});
    expect(changementsDuContrat(base, { ...base, agencyFee: "90000" })).toEqual({ agencyFee: 90000 });
    expect(changementsDuContrat(base, { ...base, agencyFee: "" })).toEqual({ agencyFee: null });
    expect(formulaireDepuisContrat(contract({})).agencyFee).toBe("");
  });

  describe("synthèse, filtres, recherche et export", () => {
    const parc = () => [
      contract({ id: "a", rent: 800, property: { title: "Villa Baobab" } as never, tenant: { firstName: "Awa", lastName: "Diallo" } as never, signedByManagerAt: "2026-01-01T00:00:00.000Z", signedByTenantAt: "2026-01-02T00:00:00.000Z", endDate: new Date(Date.now() + 300 * DAY_MS).toISOString() }),
      contract({ id: "b", rent: 400, property: { title: "Studio Plateau" } as never, tenant: { firstName: "Moussa", lastName: "Ba" } as never, signedByManagerAt: "2026-01-01T00:00:00.000Z", signedByTenantAt: null, endDate: new Date(Date.now() + 30 * DAY_MS).toISOString() }),
      contract({ id: "c", rent: 600, property: { title: "Atelier Mermoz" } as never, tenant: { firstName: "Élodie", lastName: "Sow" } as never, signedByManagerAt: "2026-01-01T00:00:00.000Z", signedByTenantAt: "2026-01-02T00:00:00.000Z", endDate: new Date(Date.now() + 250 * DAY_MS).toISOString() }),
      contract({ id: "d", rent: 700, status: "ENDED", property: { title: "Loft Sacré-Cœur" } as never, tenant: { firstName: "Ibrahima", lastName: "Fall" } as never, endDate: new Date(Date.now() - 20 * DAY_MS).toISOString() }),
    ];

    async function afficher() {
      queueLoad(parc());
      renderPage();
      await screen.findByRole("table");
    }

    const lignes = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

    it("résume les baux actifs, les loyers, les fins proches et les signatures en attente", async () => {
      await afficher();
      const synthese = screen.getByLabelText("Synthèse des baux");
      expect(within(synthese).getByText("3")).toBeInTheDocument(); // actifs
      expect(within(synthese).getByText("1 800 €")).toBeInTheDocument(); // 800 + 400 + 600
      expect(within(synthese).getAllByText("1")).toHaveLength(2); // une fin proche, une signature en attente
    });

    it("filtre les baux à signer, à la fin proche ou terminés", async () => {
      const user = userEvent.setup();
      await afficher();
      const filtres = screen.getByRole("group", { name: "Filtrer les baux" });

      await user.click(within(filtres).getByRole("button", { name: /À signer\s*1/ }));
      expect(lignes()).toHaveLength(1);
      expect(lignes()[0]).toContain("Studio Plateau");

      await user.click(within(filtres).getByRole("button", { name: /Terminés\s*1/ }));
      expect(lignes()).toHaveLength(1);
      expect(lignes()[0]).toContain("Loft Sacré-Cœur");

      await user.click(within(filtres).getByRole("button", { name: /Fin proche\s*1/ }));
      expect(lignes()[0]).toContain("Studio Plateau");
    });

    it("cherche par bien ou par locataire, sans tenir compte des accents", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "elodie");
      expect(lignes()).toHaveLength(1);
      expect(lignes()[0]).toContain("Atelier Mermoz");
    });

    it("trie par fin la plus proche, les baux actifs d'abord", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.selectOptions(screen.getByLabelText("Trier par"), "Fin la plus proche");
      expect(lignes().map((l) => ["Studio Plateau", "Atelier Mermoz", "Villa Baobab", "Loft Sacré-Cœur"].find((b) => l.includes(b)))).toEqual([
        "Studio Plateau",
        "Atelier Mermoz",
        "Villa Baobab",
        "Loft Sacré-Cœur",
      ]);
    });

    it("trace l'avancement de chaque bail actif", async () => {
      await afficher();
      const barres = within(screen.getByRole("table")).getAllByRole("progressbar");
      expect(barres).toHaveLength(3); // pas pour le bail terminé
      expect(barres[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Avancement du bail : \d+ %$/));
    });

    it("exporte les baux affichés en CSV, avec les signatures", async () => {
      const user = userEvent.setup();
      let blob: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", { value: (b: Blob) => ((blob = b), "blob:test"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      await afficher();
      await user.type(screen.getByRole("searchbox"), "moussa");
      await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
      const texte = await new Promise<string>((resolve) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.readAsText(blob!);
      });
      const l = texte.split("\n");
      expect(l).toHaveLength(2);
      expect(l[1]).toContain('"Studio Plateau";"Moussa Ba";400,00;"EUR"');
      expect(l[1]).toMatch(/"Oui";"Non"$/);
    });
  });
});
