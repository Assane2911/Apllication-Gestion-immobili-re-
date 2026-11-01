import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { OwnerDashboard } from "../../types";
import OwnerDashboardPage from "./OwnerDashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function dashboard(overrides: Partial<OwnerDashboard> = {}): OwnerDashboard {
  return {
    ownerName: "Fatou Diop",
    managementFeeRate: 8,
    properties: [
      {
        propertyId: "prop-1",
        title: "Villa Ngor",
        address: "Route de Ngor",
        currency: "EUR",
        collected: 1000,
        pending: 200,
      },
    ],
    collectedThisMonthByCurrency: { EUR: 1000 },
    pendingThisMonthByCurrency: { EUR: 200 },
    revenueByMonth: { "2026-08": { EUR: 900 } },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter>
          <OwnerDashboardPage />
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("OwnerDashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche le résumé financier du propriétaire connecté (perçu, en attente, commission)", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith("/owners/mine/dashboard");
    expect(screen.getByText("Route de Ngor")).toBeInTheDocument();
    expect(screen.getByText("8%")).toBeInTheDocument();
    expect(screen.getAllByText(/1[\s ]000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/200/).length).toBeGreaterThan(0);
  });

  it("affiche un message dédié quand aucun bien n'est associé", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: dashboard({ properties: [], collectedThisMonthByCurrency: {}, pendingThisMonthByCurrency: {} }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien ne vous est encore associé.")).toBeInTheDocument());
  });

  it("affiche un message dédié quand aucun historique n'est disponible", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: dashboard({ revenueByMonth: {} }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun loyer perçu sur les 6 derniers mois.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
  });

  it("écrit les mois de l'historique en toutes lettres, jamais sous la forme brute 2026-08", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: dashboard({ revenueByMonth: { "2026-08": { EUR: 900 } } }) });
    renderPage();

    await waitFor(() => expect(screen.getByText(/août 26/i)).toBeInTheDocument());
    expect(screen.queryByText("2026-08")).not.toBeInTheDocument();
  });

  describe("lecture enrichie", () => {
    beforeEach(() => {
      // Novembre 2026 : la fenêtre des six mois va de juin à novembre.
      vi.setSystemTime(new Date(2026, 10, 15));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("donne le taux d'encaissement du mois et la commission estimée sur ce qui est perçu", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
      renderPage();

      // 1 000 perçus sur 1 200 attendus : 83 %. Commission de 8 % sur 1 000 : 80.
      const barre = await screen.findByRole("progressbar", { name: "Taux d'encaissement en EUR" });
      expect(barre).toHaveAttribute("aria-valuenow", "83");
      expect(screen.getByText("83 % encaissé")).toBeInTheDocument();
      expect(screen.getByText("Commission estimée · 80 €")).toBeInTheDocument();
    });

    it("ne mélange jamais deux devises : un taux et une commission par devise", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: dashboard({
          collectedThisMonthByCurrency: { EUR: 1000, XOF: 300000 },
          pendingThisMonthByCurrency: { EUR: 0, XOF: 100000 },
        }),
      });
      renderPage();

      expect(await screen.findByRole("progressbar", { name: "Taux d'encaissement en EUR" })).toHaveAttribute("aria-valuenow", "100");
      expect(screen.getByRole("progressbar", { name: "Taux d'encaissement en XOF" })).toHaveAttribute("aria-valuenow", "75");
    });

    it("trace les six derniers mois, vides compris, avec moyenne, variation et meilleur mois", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: dashboard({ revenueByMonth: { "2026-09": { EUR: 600 }, "2026-10": { EUR: 1200 }, "2026-11": { EUR: 1500 } } }),
      });
      renderPage();

      const historique = within(await screen.findByRole("region", { name: "Historique (6 derniers mois)" }));
      // Six lignes, y compris les trois mois sans loyer perçu.
      expect(historique.getAllByRole("listitem")).toHaveLength(6);
      expect(historique.getByText(/juin 26/i)).toBeInTheDocument();
      // (600 + 1200 + 1500) / 6 mois = 550 ; novembre contre octobre : +25 %.
      expect(historique.getByText(/Moyenne mensuelle · 550 €/)).toBeInTheDocument();
      expect(historique.getByText(/vs mois précédent \+25 %/)).toBeInTheDocument();
      expect(historique.getAllByText("Meilleur mois")).toHaveLength(1);
    });

    it("donne le poids de chaque bien dans les loyers perçus de sa devise", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: dashboard({
          properties: [
            { propertyId: "p1", title: "Villa Ngor", address: "Route de Ngor", currency: "EUR", collected: 750, pending: 0 },
            { propertyId: "p2", title: "Studio Plateau", address: "Plateau", currency: "EUR", collected: 250, pending: 100 },
            { propertyId: "p3", title: "Maison Abidjan", address: "Cocody", currency: "XOF", collected: 80000, pending: 0 },
          ],
        }),
      });
      renderPage();

      expect(await screen.findByText("75 %")).toBeInTheDocument();
      expect(screen.getByText("25 %")).toBeInTheDocument();
      // Le seul bien en francs CFA pèse 100 % de SA devise, pas une fraction du total toutes monnaies confondues.
      expect(screen.getByText("100 %")).toBeInTheDocument();
    });

    it("renvoie vers le compte-rendu de gestion", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
      renderPage();

      expect(await screen.findByRole("link", { name: /Voir mon compte-rendu de gestion/ })).toHaveAttribute("href", "/proprietaire/crg");
    });

    it("donne le net estimé après commission, hors charges", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
      renderPage();

      // 1 000 perçus moins 8 % de commission : 920.
      expect(await screen.findByText("Net estimé (hors charges) · 920 €")).toBeInTheDocument();
    });

    it("totalise les six mois et projette l'année à partir de la moyenne", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: dashboard({ revenueByMonth: { "2026-09": { EUR: 600 }, "2026-10": { EUR: 1200 }, "2026-11": { EUR: 1500 } } }),
      });
      renderPage();

      // Cumul 3 300 ; moyenne 550 sur six mois ; projection sur douze mois : 6 600.
      const historique = within(await screen.findByRole("region", { name: "Historique (6 derniers mois)" }));
      expect(historique.getByText(/Cumul sur 6 mois · 3[\s ]300 €/)).toBeInTheDocument();
      expect(historique.getByText(/Projection sur 12 mois · 6[\s ]600 €/)).toBeInTheDocument();
    });

    it("signale un bien soldé et un bien dont rien n'a encore été perçu", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: dashboard({
          properties: [
            { propertyId: "p1", title: "Villa Ngor", address: "Route de Ngor", currency: "EUR", collected: 800, pending: 0 },
            { propertyId: "p2", title: "Studio Plateau", address: "Plateau", currency: "EUR", collected: 0, pending: 300 },
            { propertyId: "p3", title: "Maison Almadies", address: "Almadies", currency: "EUR", collected: 500, pending: 100 },
          ],
        }),
      });
      renderPage();

      expect(await screen.findAllByText("Soldé")).toHaveLength(1);
      expect(screen.getAllByText("Rien perçu")).toHaveLength(1);
    });

    it("trie les biens au clic sur une colonne, dans les deux sens, puis rend l'ordre d'origine", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce({
        data: dashboard({
          properties: [
            { propertyId: "p1", title: "Bravo", address: "A", currency: "EUR", collected: 200, pending: 0 },
            { propertyId: "p2", title: "Alpha", address: "B", currency: "EUR", collected: 900, pending: 0 },
            { propertyId: "p3", title: "Charlie", address: "C", currency: "EUR", collected: 500, pending: 0 },
          ],
        }),
      });
      renderPage();
      await screen.findByText("Bravo");
      const ordre = () =>
        within(screen.getByRole("region", { name: "Mes biens" }))
          .getAllByRole("row")
          .slice(1)
          .map((ligne) => within(ligne).getByText(/^(Alpha|Bravo|Charlie)$/).textContent);
      expect(ordre()).toEqual(["Bravo", "Alpha", "Charlie"]);

      const colonne = screen.getByRole("button", { name: "Perçu" });
      await user.click(colonne);
      expect(ordre()).toEqual(["Alpha", "Charlie", "Bravo"]);
      expect(screen.getByRole("columnheader", { name: "Perçu" })).toHaveAttribute("aria-sort", "descending");

      await user.click(colonne);
      expect(ordre()).toEqual(["Bravo", "Charlie", "Alpha"]);

      await user.click(colonne);
      expect(ordre()).toEqual(["Bravo", "Alpha", "Charlie"]);
      expect(screen.getByRole("columnheader", { name: "Perçu" })).toHaveAttribute("aria-sort", "none");
    });

    it("exporte le tableau de bord en CSV", async () => {
      const user = userEvent.setup();
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
      renderPage();

      await user.click(await screen.findByRole("button", { name: "Exporter en CSV" }));

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
      expect(blob.type).toContain("text/csv");
      expect(clic).toHaveBeenCalled();
      clic.mockRestore();
    });
  });
});
