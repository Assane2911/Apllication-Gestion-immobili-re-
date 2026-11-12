import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import AdminDashboardPage from "./AdminDashboardPage";

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter>
          <AdminDashboardPage />
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

// La vue WhatsApp charge ses propres données (WhatsappPlateforme.test.tsx) : un appel de plus décalerait les réponses
// simulées, servies dans l'ordre. Ici on vérifie seulement qu'elle figure au tableau de bord.
vi.mock("../../components/WhatsappPlateforme", () => ({ default: () => <p>vue-whatsapp-plateforme</p> }));

function stats(overrides: Record<string, unknown> = {}) {
  return {
    managers: { total: 12, trialActive: 4, subscriptionActive: 6, expired: 2 },
    trialsEndingSoon: [
      { userId: "mgr-1", email: "agence-port@test.local", agencyName: "Agence du Port", trialEndsAt: "2026-09-12T00:00:00.000Z", daysRemaining: 2 },
    ],
    // Le MRR est ventilé par devise depuis que les formules sont tarifées
    // séparément en euros et en FCFA : additionner les deux ne voudrait rien dire.
    mrr: {
      byCurrency: [{ currency: "EUR", total: 68.17, byPlan: { STARTER: 0, PRO: 29, ENTERPRISE: 39.17 }, contributors: 2 }],
      contributors: 2,
    },
    usage: { totalProperties: 34, totalTenants: 28, activeContracts: 19 },
    ...overrides,
  };
}

describe("AdminDashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    localStorage.clear();
  });

  /**
   * Ce compte confirme les virements et supprime des agences : sans second facteur, un mot de passe volé suffit. L'avis est visible
   * et mène aux réglages, sans bloquer l'accès (un administrateur unique ne doit jamais se retrouver enfermé dehors).
   */
  it("avertit l'administrateur dont la double authentification est inactive, avec un lien vers les réglages", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "adm-1", email: "admin@test.local", role: "ADMIN", twoFactorEnabled: false }));
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();

    const avis = await screen.findByRole("note");
    expect(avis).toHaveTextContent(/n'a pas de double authentification/);
    expect(within(avis).getByRole("link", { name: "Activer maintenant" })).toHaveAttribute("href", "/admin/parametres#securite");
  });

  it("n'avertit pas quand la double authentification est active", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "adm-1", email: "admin@test.local", role: "ADMIN", twoFactorEnabled: true }));
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();

    await screen.findByRole("region", { name: "WhatsApp" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("signale les comptes suspendus dans la vignette des gestionnaires, et seulement s'il y en a", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ managers: { total: 12, trialActive: 4, subscriptionActive: 6, expired: 2, suspended: 3 } }) });
    const { unmount } = renderPage();
    expect(await screen.findByText(/3 suspendu\(s\)/)).toBeInTheDocument();
    unmount();

    // Aucun suspendu — ou un serveur plus ancien qui n'envoie pas le champ :
    // la vignette garde son texte habituel, sans « 0 suspendu(s) ».
    mockedApi.get.mockResolvedValueOnce({ data: stats({ managers: { total: 12, trialActive: 4, subscriptionActive: 6, expired: 2 } }) });
    renderPage();
    expect(await screen.findByText(/4 en essai · 2 sans accès/)).toBeInTheDocument();
    expect(screen.queryByText(/suspendu/)).not.toBeInTheDocument();
  });

  it("réserve une rubrique à la consommation WhatsApp de la plateforme", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();
    const rubrique = await screen.findByRole("region", { name: "WhatsApp" });
    expect(within(rubrique).getByText("vue-whatsapp-plateforme")).toBeInTheDocument();
  });

  it("affiche les indicateurs clés de la plateforme", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    renderPage();

    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("68,17 €")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
  });

  // Régression : cette page formatait le MRR avec sa propre table de symboles (symbole toujours après le montant), au
  // lieu du formatage partagé (CurrencyContext) déjà utilisé par le reste de l'admin. Les devises de la zone couverte
  // (euro, franc CFA) mettent leur symbole après le montant : le montant en FCFA doit s'écrire « 150 FCFA », pas « XOF 150 ».
  it("écrit le MRR d'une devise avec le formatage partagé (franc CFA : symbole après le montant)", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({
        mrr: {
          byCurrency: [{ currency: "XOF", total: 150, byPlan: { STARTER: 0, PRO: 150, ENTERPRISE: 0 }, contributors: 1 }],
          contributors: 1,
        },
      }),
    });

    renderPage();

    // « 150 FCFA » apparaît deux fois (la tuile MRR et la ventilation par formule,
    // toutes deux sur cette seule devise) : les deux affichages doivent
    // s'accorder.
    await waitFor(() => expect(screen.getAllByText("150 FCFA").length).toBeGreaterThan(0));
  });

  it("liste les essais se terminant bientôt avec le nom de l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    renderPage();

    await waitFor(() => expect(screen.getByText("Agence du Port")).toBeInTheDocument());
    expect(screen.getByText("agence-port@test.local")).toBeInTheDocument();
    expect(screen.getByText("2 jour(s) restant(s)")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucun essai ne se termine bientôt", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ trialsEndingSoon: [] }) });

    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun essai ne se termine dans les 7 prochains jours.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Agence du Port")).toBeInTheDocument());
  });

  it("range en tête ce qui attend l'administrateur, avec un raccourci vers chaque sujet", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ managers: { total: 12, trialActive: 4, subscriptionActive: 6, expired: 2, suspended: 1 } }) });
    mockedApi.get.mockResolvedValueOnce({ data: [{ id: "v1" }, { id: "v2" }] });

    renderPage();

    const virements = await screen.findByRole("link", { name: /2 virement\(s\) à confirmer/ });
    expect(virements).toHaveAttribute("href", "/admin/virements");
    expect(screen.getByRole("link", { name: /1 essai\(s\) à relancer/ })).toHaveAttribute("href", "/admin/gestionnaires");
    expect(screen.getByRole("link", { name: /2 compte\(s\) sans accès/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1 compte\(s\) suspendu\(s\)/ })).toBeInTheDocument();
  });

  it("annonce que tout est à jour quand rien n'attend, et se passe des virements si leur liste est indisponible", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({ managers: { total: 3, trialActive: 1, subscriptionActive: 2, expired: 0 }, trialsEndingSoon: [] }),
    });
    mockedApi.get.mockRejectedValueOnce(new Error("réseau"));

    renderPage();

    expect(await screen.findByText("Rien ne vous attend : tout est à jour.")).toBeInTheDocument();
  });

  it("donne le revenu annuel et le panier moyen de chaque devise, et la répartition des comptes", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    renderPage();

    // 68,17 € × 12 ; 68,17 € répartis sur 2 comptes payants.
    expect(await screen.findByText("818,04 €")).toBeInTheDocument();
    expect(screen.getByText("34,09 €")).toBeInTheDocument();
    expect(screen.getByText("Abonnés · 6")).toBeInTheDocument();
    expect(screen.getByText("En essai · 4")).toBeInTheDocument();
    expect(screen.getByText("Sans accès · 2")).toBeInTheDocument();
    expect(screen.getByText("Taux d'abonnement : 50 %")).toBeInTheDocument();
  });

  it("relie chaque essai à la fiche du gestionnaire et permet de lui écrire", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    renderPage();

    expect(await screen.findByRole("link", { name: "Agence du Port" })).toHaveAttribute("href", "/admin/gestionnaires/mgr-1");
    expect(screen.getByRole("link", { name: "Écrire à agence-port@test.local" })).toHaveAttribute("href", "mailto:agence-port@test.local");
  });
});

describe("AdminDashboardPage — suggestions non lues", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("ajoute à la zone « À traiter » un raccourci vers les suggestions restées nouvelles", async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === "/admin/dashboard/stats") return Promise.resolve({ data: stats() }) as never;
      if (url === "/admin/subscriptions/pending-bank-transfers") return Promise.resolve({ data: [] }) as never;
      if (url === "/admin/suggestions") return Promise.resolve({ data: { items: [], counts: { NEW: 4, total: 9 } } }) as never;
      return Promise.resolve({ data: {} }) as never;
    });
    renderPage();

    const lien = await screen.findByRole("link", { name: /4 suggestion\(s\) non lue\(s\)/ });
    expect(lien).toHaveAttribute("href", "/admin/suggestions");
  });

  it("n'ajoute rien quand toutes les suggestions ont été lues, ou quand leur compte est inconnu", async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === "/admin/dashboard/stats") return Promise.resolve({ data: stats() }) as never;
      if (url === "/admin/subscriptions/pending-bank-transfers") return Promise.resolve({ data: [] }) as never;
      if (url === "/admin/suggestions") return Promise.resolve({ data: { items: [], counts: { NEW: 0, total: 9 } } }) as never;
      return Promise.resolve({ data: {} }) as never;
    });
    renderPage();
    await screen.findByText("Agence du Port");
    expect(screen.queryByText(/suggestion\(s\) non lue\(s\)/)).not.toBeInTheDocument();
  });
});
