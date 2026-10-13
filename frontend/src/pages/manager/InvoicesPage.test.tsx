import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Invoice, PaginatedResponse } from "../../types";
import InvoicesPage from "./InvoicesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * La page charge les factures, puis les baux à mettre en demeure. Les réponses aux factures se
 * programment sur `getFactures` ; les baux à mettre en demeure sur `aMettreEnDemeure`.
 */
const getFactures = vi.fn();
let aMettreEnDemeure: unknown[] = [];

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    contractId: "c1",
    periodMonth: 6,
    periodYear: 2026,
    amount: 500,
    currency: "EUR",
    dueDate: "2026-06-20T00:00:00.000Z",
    status: "PENDING",
    contract: {
      id: "c1",
      property: { title: "Studio Centre-ville" },
      tenant: { firstName: "Awa", lastName: "Diallo", email: "awa@example.com" },
    } as unknown as Invoice["contract"],
    ...overrides,
  };
}

function paginated(items: Invoice[], overrides: Partial<PaginatedResponse<Invoice>> = {}): {
  data: PaginatedResponse<Invoice>;
} {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...overrides },
  };
}

// Le <select> de filtre contient aussi des <option> avec le même libellé que les badges de
// statut (ex: "En attente", "Réglée") — on les exclut pour ne compter que les badges affichés.
function countNonOptionMatches(text: string | RegExp) {
  return screen.getAllByText(text).filter((el) => el.tagName !== "OPTION").length;
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <InvoicesPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("InvoicesPage (manager)", () => {
  beforeEach(() => {
    getFactures.mockReset();
    aMettreEnDemeure = [];
    mockedApi.get.mockReset();
    mockedApi.get.mockImplementation(((url: string, config?: unknown) =>
      url === "/contracts/formal-notices-due" ? Promise.resolve({ data: aMettreEnDemeure }) : getFactures(url, config)) as never);
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("affiche la liste des factures avec montant et statut (tableau + cartes mobiles)", async () => {
    getFactures.mockResolvedValueOnce(
      paginated([
        invoice({ id: "inv-pending", status: "PENDING" }),
        invoice({ id: "inv-paid", status: "PAID", amount: 650 }),
      ])
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/)).toHaveLength(4));
    expect(screen.getAllByText("Awa Diallo")).toHaveLength(4);
    expect(countNonOptionMatches("En attente")).toBe(2);
    expect(countNonOptionMatches("Réglée")).toBe(2);
    expect(screen.getAllByText("650 €")).toHaveLength(2);
    // Le bouton "Marquer réglée" n'apparaît que pour la facture PENDING (une fois par vue = 2)
    expect(screen.getAllByRole("button", { name: "Marquer réglée" })).toHaveLength(2);
    // Le bouton "Quittance PDF" n'apparaît que pour la facture PAID (une fois par vue = 2)
    expect(screen.getAllByRole("button", { name: /Quittance PDF/ })).toHaveLength(2);
  });

  it("indique le niveau de relance d'un impayé déjà relancé, pas celui d'une facture réglée", async () => {
    getFactures.mockResolvedValueOnce(
      paginated([
        invoice({ id: "inv-late", status: "LATE", overdueReminderLevel: 2, overdueReminderSentAt: "2026-10-20T09:00:00.000Z" }),
        invoice({ id: "inv-paid", status: "PAID", overdueReminderLevel: 3, overdueReminderSentAt: "2026-10-30T09:00:00.000Z" }),
      ])
    );
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Relance 2\/3 le/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Relance 3\/3/)).not.toBeInTheDocument();
  });

  it("affiche un message quand il n'y a aucune facture pour le filtre", async () => {
    getFactures.mockResolvedValueOnce(paginated([]));
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Aucune facture pour ce filtre").length).toBeGreaterThan(0));
  });

  it("affiche une erreur si le chargement échoue", async () => {
    getFactures.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  it("changer le filtre de statut recharge la liste avec le bon paramètre", async () => {
    const user = userEvent.setup();
    getFactures.mockResolvedValueOnce(paginated([invoice({ status: "PENDING" })]));
    getFactures.mockResolvedValueOnce(paginated([invoice({ status: "LATE" })]));

    renderPage();
    await waitFor(() => expect(getFactures).toHaveBeenCalledTimes(1));
    expect(getFactures).toHaveBeenNthCalledWith(1, "/invoices", {
      params: { page: 1, pageSize: 20 },
      signal: expect.anything(),
    });

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "LATE");

    await waitFor(() => expect(getFactures).toHaveBeenCalledTimes(2));
    expect(getFactures).toHaveBeenNthCalledWith(2, "/invoices", {
      params: { page: 1, pageSize: 20, status: "LATE" },
      signal: expect.anything(),
    });
    await waitFor(() => expect(countNonOptionMatches("En retard")).toBeGreaterThan(0));
  });

  /**
   * Régression : sans AbortController, changer rapidement de filtre lançait
   * une nouvelle requête sans annuler la précédente. Si la première (page
   * initiale, sans filtre) répondait APRÈS la seconde (filtre "LATE"), sa
   * réponse — désormais périmée — écrasait l'affichage avec les mauvaises
   * données. Ici la première requête ne se résout qu'après la seconde, et ne
   * doit donc plus jamais aboutir : elle est annulée dès le changement de
   * filtre.
   */
  it("annule la requête de la page précédente quand le filtre change avant qu'elle ne réponde", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (err: unknown) => void;
    const firstRequest = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    getFactures.mockImplementationOnce((_url: string, config?: { signal?: AbortSignal }) => {
      config?.signal?.addEventListener("abort", () => rejectFirst({ __CANCEL__: true }));
      return firstRequest;
    });
    getFactures.mockResolvedValueOnce(paginated([invoice({ status: "LATE" })]));

    renderPage();
    await waitFor(() => expect(getFactures).toHaveBeenCalledTimes(1));

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "LATE");

    // La requête filtrée aboutit et s'affiche normalement.
    await waitFor(() => expect(countNonOptionMatches("En retard")).toBeGreaterThan(0));
    // La requête de la page initiale a bien été annulée (jamais laissée
    // pendante à écraser l'affichage si elle finissait par répondre).
    await expect(firstRequest).rejects.toEqual({ __CANCEL__: true });
    // Aucun message d'erreur ne doit apparaître pour cette annulation volontaire.
    expect(screen.queryByText(/erreur/i)).not.toBeInTheDocument();
  });

  it("marquer une facture réglée : envoie la requête puis recharge la liste", async () => {
    const user = userEvent.setup();
    getFactures.mockResolvedValueOnce(paginated([invoice({ id: "inv-1", status: "PENDING" })]));
    getFactures.mockResolvedValueOnce(paginated([invoice({ id: "inv-1", status: "PAID" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { invoice: invoice({ status: "PAID" }) } });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Marquer réglée" }).length).toBeGreaterThan(0));

    const buttons = screen.getAllByRole("button", { name: "Marquer réglée" });
    await user.click(buttons[0]);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Marquer réglée" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/invoices/inv-1/mark-paid",
        expect.objectContaining({ paymentMethod: "BANK_TRANSFER", paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
      )
    );
    await waitFor(() => expect(getFactures).toHaveBeenCalledTimes(2));
  });

  it("relancer une facture individuellement : envoie la requête et affiche le message de confirmation", async () => {
    const user = userEvent.setup();
    getFactures.mockResolvedValue(paginated([invoice({ id: "inv-1", status: "PENDING" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Relance envoyée à Awa Diallo." } });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Relancer/ }).length).toBeGreaterThan(0));

    const buttons = screen.getAllByRole("button", { name: /Relancer/ });
    await user.click(buttons[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/send-reminder"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Relance envoyée à Awa Diallo\./));
  });

  it("envoyer les alertes mensuelles : demande confirmation puis envoie la requête", async () => {
    const user = userEvent.setup();
    getFactures.mockResolvedValue(paginated([invoice({ id: "inv-1", status: "PENDING" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { message: "12 avis envoyés.", sent: 12 } });

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/invoices/send-monthly-reminders"));
    await waitFor(() => expect(screen.getByText(/12 avis envoyés\./)).toBeInTheDocument());
  });

  it("n'envoie pas les alertes mensuelles si la confirmation est annulée", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    getFactures.mockResolvedValue(paginated([invoice({ id: "inv-1", status: "PENDING" })]));

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

describe("InvoicesPage — marquer une facture réglée", () => {
  beforeEach(() => {
    getFactures.mockReset();
    mockedApi.post.mockReset();
  });

  /**
   * Le geste est SANS RETOUR : `PAID` est un état terminal côté serveur,
   * `cancelInvoice` refuse une facture réglée, et aucun chemin ne ramène
   * jamais une facture à `PENDING`. Il déclenche en outre l'envoi immédiat de
   * la quittance au locataire. Une fenêtre demande donc confirmation, rappelle
   * QUI et COMBIEN, et fait choisir le moyen et la date réelle d'encaissement.
   */
  async function ouvrirLaFenetre() {
    const user = userEvent.setup();
    getFactures.mockResolvedValue(paginated([invoice()]));
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Marquer réglée" })[0]);
    return { user, fenetre: await screen.findByRole("dialog") };
  }

  it("ouvre une fenêtre de confirmation au lieu d'envoyer tout de suite", async () => {
    await ouvrirLaFenetre();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("nomme le locataire et le montant dans la fenêtre", async () => {
    // Une confirmation qui dirait seulement « Êtes-vous sûr ? » se clique
    // sans lire. Celle-ci doit rappeler QUI et COMBIEN.
    const { fenetre } = await ouvrirLaFenetre();
    expect(fenetre).toHaveTextContent("Awa Diallo");
    expect(fenetre).toHaveTextContent("500");
    expect(fenetre).toHaveTextContent("DÉFINITIVE");
  });

  it("annuler ferme la fenêtre sans rien envoyer", async () => {
    const { user } = await ouvrirLaFenetre();
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("propose virement par défaut et la date du jour, sans dépasser aujourd'hui", async () => {
    const { fenetre } = await ouvrirLaFenetre();
    expect(within(fenetre).getByLabelText("Moyen de paiement")).toHaveValue("BANK_TRANSFER");
    const date = within(fenetre).getByLabelText("Date d'encaissement") as HTMLInputElement;
    const d = new Date();
    const aujourdhui = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(date.value).toBe(aujourdhui);
    expect(date.max).toBe(aujourdhui);
  });

  it("envoie le moyen, la date réelle et la référence choisis", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const { user, fenetre } = await ouvrirLaFenetre();

    await user.selectOptions(within(fenetre).getByLabelText("Moyen de paiement"), "CHEQUE");
    fireEvent.change(within(fenetre).getByLabelText("Date d'encaissement"), { target: { value: "2025-12-28" } });
    await user.type(within(fenetre).getByLabelText("Référence (facultatif)"), "CHQ 0045871");
    await user.click(within(fenetre).getByRole("button", { name: "Marquer réglée" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/mark-paid", {
        paymentMethod: "CHEQUE",
        amount: 500,
        paidAt: "2025-12-28",
        paymentRef: "CHQ 0045871",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("n'envoie pas de référence vide", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const { user, fenetre } = await ouvrirLaFenetre();
    await user.click(within(fenetre).getByRole("button", { name: "Marquer réglée" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post.mock.calls[0][1]).not.toHaveProperty("paymentRef");
  });

  it("garde la fenêtre ouverte et affiche l'erreur si le serveur refuse (ex. date future)", async () => {
    mockedApi.post.mockRejectedValue(
      new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 400,
        data: { error: "La date d'encaissement ne peut pas être dans le futur." },
      } as never)
    );
    const { user, fenetre } = await ouvrirLaFenetre();
    await user.click(within(fenetre).getByRole("button", { name: "Marquer réglée" }));
    expect(await within(fenetre).findByRole("alert")).toHaveTextContent("futur");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  describe("paiement partiel", () => {
    async function ouvrir(inv: Invoice) {
      const user = userEvent.setup();
      getFactures.mockResolvedValue(paginated([inv]));
      renderPage();
      await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
      await user.click(screen.getAllByRole("button", { name: "Marquer réglée" })[0]);
      return { user, fenetre: await screen.findByRole("dialog") };
    }

    it("propose le reste dû comme montant par défaut et l'indique", async () => {
      const { fenetre } = await ouvrir(invoice({ amountPaid: 300, montantRegle: 300, resteDu: 200 }));
      expect(within(fenetre).getByLabelText("Montant encaissé")).toHaveValue(200);
      expect(fenetre).toHaveTextContent("Reste dû");
      expect(fenetre).toHaveTextContent("200");
    });

    it("un montant inférieur au reste dû devient un paiement partiel : avertissement et bouton dédiés", async () => {
      mockedApi.post.mockResolvedValue({ data: {} });
      const { user, fenetre } = await ouvrir(invoice({ resteDu: 500 }));

      fireEvent.change(within(fenetre).getByLabelText("Montant encaissé"), { target: { value: "300" } });

      expect(fenetre).toHaveTextContent("Paiement partiel");
      await user.click(within(fenetre).getByRole("button", { name: "Enregistrer le paiement partiel" }));
      await waitFor(() =>
        expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/mark-paid", expect.objectContaining({ amount: 300 }))
      );
    });

    it("refuse un montant nul ou supérieur au reste dû, sans appeler le serveur", async () => {
      const { user, fenetre } = await ouvrir(invoice({ resteDu: 500 }));

      for (const valeur of ["0", "750"]) {
        fireEvent.change(within(fenetre).getByLabelText("Montant encaissé"), { target: { value: valeur } });
        await user.click(within(fenetre).getByRole("button", { name: /Marquer réglée|partiel/ }));
        expect(await within(fenetre).findByRole("alert")).toHaveTextContent("reste dû");
      }
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("affiche dans la liste ce qui est déjà réglé et ce qui reste", async () => {
      getFactures.mockResolvedValue(paginated([invoice({ amountPaid: 300, montantRegle: 300, resteDu: 200 })]));
      renderPage();
      await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
      expect(screen.getAllByText(/Réglé : .*300.* · Reste : .*200/).length).toBeGreaterThan(0);
    });

    it("n'affiche rien de tel pour une facture sans acompte", async () => {
      getFactures.mockResolvedValue(paginated([invoice({ montantRegle: 0, resteDu: 500 })]));
      renderPage();
      await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
      expect(screen.queryByText(/Reste :/)).not.toBeInTheDocument();
    });
  });
});

describe("InvoicesPage — mises en demeure à émettre", () => {
  const bail = {
    contractId: "c1",
    propertyTitle: "Studio Centre-ville",
    tenantName: "Awa Diallo",
    currency: "EUR",
    unpaidCount: 2,
    alreadyClaimedCount: 1,
    totalDue: 900,
    oldestDueDate: "2026-08-20T00:00:00.000Z",
    daysLate: 40,
  };

  beforeEach(() => {
    getFactures.mockReset();
    mockedApi.post.mockReset();
    aMettreEnDemeure = [bail];
    mockedApi.get.mockReset();
    mockedApi.get.mockImplementation(((url: string, config?: unknown) =>
      url === "/contracts/formal-notices-due" ? Promise.resolve({ data: aMettreEnDemeure }) : getFactures(url, config)) as never);
    getFactures.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith("/documents/") ? { data: "<html><body>Courrier</body></html>" } : paginated([invoice({ status: "LATE" })]))
    );
  });

  it("n'affiche rien quand aucun bail n'est à mettre en demeure", async () => {
    aMettreEnDemeure = [];
    renderPage();
    await screen.findAllByText("Studio Centre-ville");
    expect(screen.queryByRole("heading", { name: /Mises en demeure à émettre/ })).not.toBeInTheDocument();
  });

  it("liste le bail avec ses impayés, et émet la mise en demeure avec le délai et l'envoi choisis", async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { id: "med-1", contractId: "c1", reference: "MED-2026-ABC123", totalDue: 900, currency: "EUR", deadlineDays: 15, emailSentAt: "2026-10-12", guarantorsNotified: 0, createdAt: "2026-10-12", emailEnvoye: true },
    });
    const user = userEvent.setup();
    renderPage();

    const encart = await screen.findByRole("heading", { name: "Mises en demeure à émettre (1)" });
    const section = encart.closest("section")!;
    expect(section).toHaveTextContent(/2 loyer\(s\) impayé\(s\) · 900\s€ · plus ancien : 40 j de retard · 1 déjà réclamé\(s\)/);

    await user.click(within(section).getByRole("button", { name: "Préparer la mise en demeure" }));
    const dialogue = screen.getByRole("dialog", { name: "Mise en demeure de payer" });
    const delai = within(dialogue).getByLabelText("Délai de paiement (jours)");
    await user.clear(delai);
    await user.type(delai, "15");
    await user.click(within(dialogue).getByLabelText("Adresser une copie aux garants"));
    await user.click(within(dialogue).getByRole("button", { name: "Émettre la mise en demeure" }));

    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/formal-notices", { deadlineDays: 15, sendEmail: true, notifyGuarantors: true });
    expect(await within(dialogue).findByText(/Mise en demeure MED-2026-ABC123 émise\. Elle a été envoyée par email\./)).toBeInTheDocument();

    await user.click(within(dialogue).getByRole("button", { name: "Ouvrir le courrier" }));
    await waitFor(() => expect(getFactures).toHaveBeenCalledWith("/documents/formal-notice/med-1", expect.anything()));
  });

  it("sans envoi par email, la copie aux garants ne peut pas être demandée", async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { id: "med-2", contractId: "c1", reference: "MED-2026-XYZ789", totalDue: 900, currency: "EUR", deadlineDays: 8, emailSentAt: null, guarantorsNotified: 0, createdAt: "2026-10-12", emailEnvoye: false },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Préparer la mise en demeure" }));
    const dialogue = screen.getByRole("dialog");
    // Copie aux garants cochée, PUIS envoi par email décoché : la copie ne part pas seule.
    await user.click(within(dialogue).getByLabelText("Adresser une copie aux garants"));
    await user.click(within(dialogue).getByLabelText(/L'envoyer aussi par email/));
    expect(within(dialogue).getByLabelText("Adresser une copie aux garants")).toBeDisabled();
    await user.click(within(dialogue).getByRole("button", { name: "Émettre la mise en demeure" }));

    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/formal-notices", { deadlineDays: 8, sendEmail: false, notifyGuarantors: false });
    expect(await within(dialogue).findByText(/Aucun email n'a été envoyé\./)).toBeInTheDocument();
  });

  it("affiche le refus du serveur dans la fenêtre", async () => {
    mockedApi.post.mockRejectedValueOnce(
      new AxiosError("Conflict", "409", undefined, undefined, {
        status: 409,
        data: { error: "Ce bail n'a aucun loyer échu impayé : il n'y a rien à réclamer." },
      } as never)
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Préparer la mise en demeure" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Émettre la mise en demeure" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("rien à réclamer");
  });
});
