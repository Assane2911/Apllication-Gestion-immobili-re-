import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { DashboardStats } from "../../types";
import DashboardPage from "./DashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalProperties: 8,
    propertiesByStatus: { AVAILABLE: 3, OCCUPIED: 4, MAINTENANCE: 0 },
    totalTenants: 6,
    activeContracts: 5,
    occupancyRate: 50,
    monthlyRevenueByCurrency: { EUR: 2000 },
    monthlyExpectedByCurrency: { EUR: 2500 },
    openIssues: 2,
    lateInvoices: 1,
    revenueByMonth: { "2026-08": { EUR: 2000 } },
    expensesByMonth: { "2026-08": { EUR: 300 } },
    ...overrides,
  };
}

function renderPage() {
  // Dans un routeur, comme en production : le guide de démarrage contient des liens.
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CurrencyProvider>
          <DashboardPage />
        </CurrencyProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche les indicateurs clés une fois les statistiques chargées", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Biens immobiliers")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    // Les revenus du mois figurent aussi dans la synthèse du mois : on lit celui de la carte d'indicateur.
    expect(within(screen.getByRole("link", { name: /Revenus encaissés/ })).getByText("2 000 €")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucun bien n'est enregistré", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({ propertiesByStatus: { AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0 }, totalProperties: 0 }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien enregistré pour l'instant.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour recharger les chiffres", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
    expect(screen.getByText("Erreur de chargement du tableau de bord")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Biens immobiliers")).toBeInTheDocument());
  });

  it("trace un graphique par devise, pour que 600 € ne disparaisse pas à côté de 450 000 FCFA", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({
        monthlyRevenueByCurrency: { EUR: 600, XOF: 450000 },
        revenueByMonth: { "2026-08": { EUR: 600, XOF: 450000 } },
        expensesByMonth: { "2026-08": { EUR: 100, XOF: 80000 } },
      }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Biens immobiliers")).toBeInTheDocument());
    expect(screen.getByRole("group", { name: "Revenus et dépenses en EUR" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Revenus et dépenses en XOF" })).toBeInTheDocument();
  });

  it("garde un seul graphique, sans découpage par devise, pour un gestionnaire mono-devise", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Biens immobiliers")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: /Revenus et dépenses en/ })).not.toBeInTheDocument();
  });

  describe("zone « À traiter »", () => {
    it("liste les urgences d'abord, avec le lien de chaque action", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: stats({ lateInvoices: 3, openIssues: 2, propertiesByStatus: { AVAILABLE: 2, OCCUPIED: 4, MAINTENANCE: 1 } }),
      });
      renderPage();

      const zone = await screen.findByRole("region", { name: "À traiter" });
      const lignes = within(zone).getAllByRole("listitem");
      expect(lignes[0]).toHaveTextContent("3 facture(s) en retard");
      expect(within(lignes[0]).getByRole("link", { name: "Relancer" })).toHaveAttribute("href", "/invoices");
      expect(lignes[1]).toHaveTextContent("2 incident(s) ouvert(s)");
      expect(within(zone).getByText("2 bien(s) à louer")).toBeInTheDocument();
      expect(within(zone).getByRole("link", { name: "Publier une annonce" })).toHaveAttribute("href", "/annonces");
      expect(within(zone).getByText("1 bien(s) en travaux")).toBeInTheDocument();
    });

    it("annonce que tout est à jour quand il n'y a rien à faire", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: stats({ lateInvoices: 0, openIssues: 0, monthlyRevenueByCurrency: { EUR: 2500 }, propertiesByStatus: { AVAILABLE: 0, OCCUPIED: 8, MAINTENANCE: 0 } }),
      });
      renderPage();

      expect(await screen.findByText("Rien à traiter : tout est à jour.")).toBeInTheDocument();
    });

    it("indique le reste à encaisser ce mois-ci", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: stats({ lateInvoices: 0, openIssues: 0, propertiesByStatus: { AVAILABLE: 0, OCCUPIED: 8, MAINTENANCE: 0 } }) });
      renderPage();

      const zone = await screen.findByRole("region", { name: "À traiter" });
      expect(within(zone).getByText("Reste à encaisser ce mois-ci : 500 €")).toBeInTheDocument();
    });
  });

  it("résume le mois en cours : encaissé, attendu, dépenses et résultat net", async () => {
    const maintenant = new Date();
    const mois = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}`;
    mockedApi.get.mockResolvedValueOnce({ data: stats({ expensesByMonth: { [mois]: { EUR: 300 } } }) });
    renderPage();

    const section = await screen.findByRole("region", { name: "Ce mois-ci" });
    const valeur = (libelle: string) => within(section).getByText(libelle).nextElementSibling;
    expect(valeur("Encaissé")).toHaveTextContent("2 000 €");
    expect(valeur("Attendu")).toHaveTextContent("2 500 €");
    expect(valeur("Reste à encaisser")).toHaveTextContent("500 €");
    expect(valeur("Dépenses du mois")).toHaveTextContent("300 €");
    expect(valeur("Résultat net")).toHaveTextContent("1 700 €");
    expect(within(section).getByRole("progressbar", { name: "Part du loyer encaissée en EUR" })).toHaveAttribute("aria-valuenow", "80");
  });

  it("bascule l'analyse en tableau accessible, avec le résultat de chaque mois", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ revenueByMonth: { "2026-08": { EUR: 2000 } }, expensesByMonth: { "2026-08": { EUR: 300 } } }) });
    renderPage();
    const user = userEvent.setup();

    const section = await screen.findByRole("region", { name: "Analyse" });
    const bascule = within(section).getByRole("group", { name: "Affichage de l'analyse" });
    expect(within(bascule).getByRole("button", { name: "Graphique" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(bascule).getByRole("button", { name: "Tableau" }));
    expect(within(bascule).getByRole("button", { name: "Tableau" })).toHaveAttribute("aria-pressed", "true");
    const tableau = within(section).getByRole("table", { name: "Tableau des six mois en EUR" });
    const ligne = within(tableau).getAllByRole("row").find((r) => /1\s700\s€/.test(r.textContent ?? ""));
    expect(ligne).toHaveTextContent("2 000 €");
    expect(ligne).toHaveTextContent("300 €");
  });

  it("exporte les six mois en CSV", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ revenueByMonth: { "2026-08": { EUR: 2000 } }, expensesByMonth: { "2026-08": { EUR: 300 } } }) });
    let blob: Blob | undefined;
    const creer = vi.fn((b: Blob) => {
      blob = b;
      return "blob:test";
    });
    Object.defineProperty(URL, "createObjectURL", { value: creer, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Exporter en CSV" }));
    expect(creer).toHaveBeenCalledOnce();
    const texte = await new Promise<string>((resolve) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(String(lecteur.result));
      lecteur.readAsText(blob!);
    });
    expect(texte).toContain('"2026-08";"EUR";2000,00;300,00;1700,00');
  });

  it("recharge les chiffres sans vider la page quand on actualise", async () => {
    // Le guide de démarrage lit aussi /agency : on répond par adresse plutôt que par ordre d'appel.
    let appels = 0;
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url !== "/dashboard/stats") return { data: {} };
      appels += 1;
      return { data: stats({ totalProperties: appels === 1 ? 8 : 9 }) };
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Biens immobiliers");
    await user.click(screen.getByRole("button", { name: "Actualiser" }));
    // Les indicateurs restent à l'écran pendant le rechargement, puis prennent la nouvelle valeur.
    expect(screen.getByText("Biens immobiliers")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("9")).toBeInTheDocument());
    expect(appels).toBe(2);
  });
});
