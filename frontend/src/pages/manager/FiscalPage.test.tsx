import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { AnnualFiscalSynthesis } from "../../types";
import FiscalPage from "./FiscalPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

// Le vrai graphique ne dessine rien sous jsdom (aucune taille de mise en page) : une doublure expose ce que la page lui transmet.
vi.mock("../../components/graphiques/graphiquesALaDemande", () => ({
  GraphiqueRevenusDepenses: ({ data, currency }: { data: Array<{ month: string; revenue: number; expense: number }>; currency: string }) => (
    <div data-testid={`graphique-${currency}`} data-donnees={JSON.stringify(data)} />
  ),
}));

const mockedApi = vi.mocked(api, { deep: true });

function synthesis(overrides: Partial<AnnualFiscalSynthesis> = {}): AnnualFiscalSynthesis {
  return {
    year: 2026,
    availableYears: [2026, 2025],
    totalRevenueByCurrency: { EUR: 6000 },
    totalExpensesByCurrency: { EUR: 900 },
    netResultByCurrency: { EUR: 5100 },
    revenueByMonth: { "2026-03": { EUR: 3000 }, "2026-04": { EUR: 3000 } },
    expensesByMonth: { "2026-03": { EUR: 900 } },
    expensesByCategory: { MAINTENANCE: { EUR: 900 } },
    bilanParBien: [
      { propertyId: "prop-1", propertyTitle: "Villa Ngor", currency: "EUR", revenue: 6000, expense: 900, net: 5100 },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <FiscalPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("FiscalPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche la synthèse annuelle et le bilan foncier par bien", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Revenus encaissés")).toBeInTheDocument());
    // "6 000 €" et "5 100 €" apparaissent à la fois dans les cartes de stats
    // et dans la ligne du bilan par bien (même montant, deux endroits).
    expect(screen.getAllByText("6 000 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Charges de l'exercice")).toBeInTheDocument();
    expect(screen.getByText("-900 €")).toBeInTheDocument();
    // "Résultat net" est aussi l'en-tête de colonne du tableau du bilan par bien.
    expect(screen.getAllByText("Résultat net").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 100 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Villa Ngor")).toBeInTheDocument();
  });

  it("le tableau du bilan par bien, défilant sur mobile, est une région atteignable au clavier", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();

    const region = await screen.findByRole("region", { name: "Bilan foncier par bien" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("la ligne du choix d'exercice passe à la ligne au lieu de déborder de l'écran", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();

    const selecteur = await screen.findByLabelText(/Exercice|Année/i);
    expect(selecteur.parentElement?.className).toContain("flex-wrap");
  });

  it("affiche un message dédié quand aucune dépense n'est enregistrée sur l'exercice", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis({ expensesByCategory: {} }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune dépense enregistrée sur cet exercice.")).toBeInTheDocument());
  });

  it("affiche un message dédié quand le bilan par bien est vide", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis({ bilanParBien: [] }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune écriture pour cet exercice.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
  });

  it("recharge la synthèse pour l'année sélectionnée dans le menu déroulant", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: synthesis({ year: 2025, totalRevenueByCurrency: { EUR: 1200 } }) });
    await userEvent.setup().selectOptions(screen.getByLabelText("Exercice"), "2025");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/fiscal/synthese", { params: { year: 2025 } })
    );
    await waitFor(() => expect(screen.getByText("1 200 €")).toBeInTheDocument());
  });

  it("télécharge le Grand Livre au format CSV pour l'année affichée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Télécharger le Grand Livre/ })).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["Grand Livre 2026"]) });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-grand-livre");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    await userEvent.setup().click(screen.getByRole("button", { name: /Télécharger le Grand Livre/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/fiscal/grand-livre", {
        params: { year: 2026 },
        responseType: "blob",
      })
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  });

  it("télécharge l'export FEC en reprenant le nom de fichier réglementaire fourni par le serveur", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Export FEC/ })).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({
      data: new Blob(["JournalCode\t..."]),
      headers: { "content-disposition": 'attachment; filename="849203194FEC20261231.txt"' },
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-fec");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    await userEvent.setup().click(screen.getByRole("button", { name: /Export FEC/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/fiscal/fec", {
        params: { year: 2026 },
        responseType: "blob",
      })
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  });

  it("télécharge l'export SYSCOHADA pour l'année affichée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Export SYSCOHADA/ })).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["JOURNAL\n..."]) });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-syscohada");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    await userEvent.setup().click(screen.getByRole("button", { name: /Export SYSCOHADA/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/fiscal/syscohada", {
        params: { year: 2026 },
        responseType: "blob",
      })
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  });

  describe("synthèse, comparaison, tableau mensuel et exports", () => {
    it("range les trois exports comptables dans leur section, avec ce que contient chacun", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
      renderPage();

      const section = await screen.findByRole("region", { name: "Exports comptables" });
      expect(within(section).getByRole("button", { name: /Grand Livre/ })).toBeInTheDocument();
      expect(within(section).getByRole("button", { name: /Export FEC/ })).toBeInTheDocument();
      expect(within(section).getByRole("button", { name: /Export SYSCOHADA/ })).toBeInTheDocument();
      expect(within(section).getByText(/format demandé par l'administration fiscale française/)).toBeInTheDocument();
    });

    it("donne la marge nette de l'exercice quand il n'y a qu'une devise", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: synthesis({ totalRevenueByCurrency: { EUR: 10000 }, totalExpensesByCurrency: { EUR: 2500 }, netResultByCurrency: { EUR: 7500 } }),
      });
      renderPage();
      const synthese = await screen.findByLabelText("Chiffres clés");
      expect(within(synthese).getByText("75 %")).toBeInTheDocument();
    });

    it("compare les revenus à l'exercice précédent, à la demande", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockImplementation(async (_url: string, config?: { params?: { year?: number } }) => {
        const annee = config?.params?.year;
        return { data: synthesis({ year: annee, availableYears: [2025, 2026], totalRevenueByCurrency: { EUR: annee === 2025 ? 8000 : 10000 } }) };
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 5, 15));
      try {
        renderPage();
        await user.click(await screen.findByRole("button", { name: "Comparer avec 2025" }));
        expect(await screen.findByText("+25 % vs 2025")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("bascule les douze mois en tableau accessible, avec le résultat de chaque mois", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce({
        data: synthesis({ revenueByMonth: { "2026-03": { EUR: 2000 } }, expensesByMonth: { "2026-03": { EUR: 500 } } }),
      });
      renderPage();

      const bascule = await screen.findByRole("group", { name: "Affichage de l'analyse" });
      await user.click(within(bascule).getByRole("button", { name: "Tableau" }));
      const tableau = screen.getByRole("table", { name: "Tableau des douze mois en EUR" });
      expect(within(tableau).getAllByRole("row")).toHaveLength(13); // en-tête + douze mois
      const mars = within(tableau).getAllByRole("row").find((r) => /1\s500\s€/.test(r.textContent ?? ""));
      expect(mars).toHaveTextContent("2 000 €");
    });
  });
});

describe("FiscalPage : graphique des douze mois, un par devise", () => {
  const donnees = (el: HTMLElement) => JSON.parse(el.getAttribute("data-donnees") ?? "[]") as Array<{ month: string; revenue: number; expense: number }>;

  async function afficher(overrides: Partial<AnnualFiscalSynthesis>) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15));
    mockedApi.get.mockReset();
    mockedApi.get.mockResolvedValue({ data: synthesis(overrides) });
    renderPage();
    await screen.findByRole("group", { name: "Affichage de l'analyse" });
  }

  it("deux devises : deux graphiques séparés, chacun avec SES montants (les euros ne sont pas écrasés par les francs CFA)", async () => {
    try {
      await afficher({
        totalRevenueByCurrency: { EUR: 3000, XOF: 450000 },
        revenueByMonth: { "2026-03": { EUR: 3000 }, "2026-04": { XOF: 450000 } },
        expensesByMonth: { "2026-03": { EUR: 900, XOF: 70000 } },
      });

      const euros = screen.getByTestId("graphique-EUR");
      const cfa = screen.getByTestId("graphique-XOF");
      expect(donnees(euros)).toHaveLength(12);
      expect(donnees(euros)[2]).toEqual({ month: expect.any(String), revenue: 3000, expense: 900 });
      expect(donnees(euros)[3]).toMatchObject({ revenue: 0, expense: 0 });
      expect(donnees(cfa)[2]).toMatchObject({ revenue: 0, expense: 70000 });
      expect(donnees(cfa)[3]).toMatchObject({ revenue: 450000, expense: 0 });
      // Aucune valeur d'une devise ne se retrouve dans le graphique de l'autre.
      expect(donnees(euros).some((m) => m.revenue === 450000 || m.expense === 70000)).toBe(false);
      expect(donnees(cfa).some((m) => m.revenue === 3000 || m.expense === 900)).toBe(false);
      // Chaque graphique est annoncé comme tel, avec sa devise.
      expect(screen.getByRole("group", { name: "Revenus et dépenses en EUR" })).toContainElement(euros);
      expect(screen.getByRole("group", { name: "Revenus et dépenses en XOF" })).toContainElement(cfa);
    } finally {
      vi.useRealTimers();
    }
  });

  it("une seule devise : un seul graphique, sans cadre ni intitulé de devise", async () => {
    try {
      await afficher({});

      expect(screen.getAllByTestId(/^graphique-/)).toHaveLength(1);
      expect(screen.getByTestId("graphique-EUR")).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /Revenus et dépenses en/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aucun mois renseigné : pas de graphique, le message le dit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15));
    try {
      mockedApi.get.mockReset();
      mockedApi.get.mockResolvedValue({ data: synthesis({ revenueByMonth: {}, expensesByMonth: {} }) });
      renderPage();

      expect(await screen.findByText("Aucune donnée pour cet exercice.")).toBeInTheDocument();
      expect(screen.queryByTestId(/^graphique-/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

