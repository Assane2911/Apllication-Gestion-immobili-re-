import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import AdminListingsPage from "./AdminListingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function annonce(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "Villa Ngor",
    type: "RENT",
    location: "Ngor, Dakar",
    country: "SN",
    price: 250000,
    currency: "XOF",
    pricePeriod: "MONTH",
    imageUrl: null,
    status: "PUBLISHED",
    featured: false,
    hiddenByAdminAt: null,
    moderationReason: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    managerId: "m1",
    managerEmail: "agence@test.local",
    agencyName: null,
    ...overrides,
  };
}

function page(items: Array<Record<string, unknown>>, reste: Record<string, unknown> = {}) {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, counts: { hidden: 0 }, ...reste } };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <AdminListingsPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("AdminListingsPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche chaque annonce avec son gestionnaire et ses badges", async () => {
    mockedApi.get.mockResolvedValueOnce(
      page([
        annonce({ featured: true, agencyName: "Baobab Immo" }),
        annonce({ id: "a2", title: "Terrain Saly", hiddenByAdminAt: "2026-10-01T10:00:00.000Z", moderationReason: "Prix trompeur" }),
      ])
    );

    renderPage();

    expect(await screen.findByText("Villa Ngor")).toBeInTheDocument();
    expect(screen.getByText(/Baobab Immo \(agence@test\.local\)/)).toBeInTheDocument();
    expect(screen.getByText("À la une")).toBeInTheDocument();
    expect(screen.getByText("Masquée par l'administration")).toBeInTheDocument();
    expect(screen.getByText(/Motif : Prix trompeur/)).toBeInTheDocument();
  });

  it("n'annonce « aucune annonce » qu'après la réponse du serveur", async () => {
    let resoudre: (v: unknown) => void = () => {};
    mockedApi.get.mockReturnValueOnce(new Promise((r) => (resoudre = r)) as never);

    renderPage();

    expect(screen.getByText(/chargement des annonces/i)).toBeInTheDocument();
    expect(screen.queryByText(/aucune annonce/i)).not.toBeInTheDocument();
    resoudre(page([]));
    expect(await screen.findByText(/aucune annonce pour le moment/i)).toBeInTheDocument();
  });

  it("filtre sur les annonces masquées et affiche leur nombre", async () => {
    mockedApi.get.mockResolvedValueOnce(page([annonce()], { counts: { hidden: 3 } }));
    renderPage();
    await screen.findByText("Villa Ngor");
    expect(screen.getByRole("button", { name: /Masquées \(3\)/ })).toBeInTheDocument();

    mockedApi.get.mockResolvedValueOnce(page([], { counts: { hidden: 3 } }));
    await userEvent.click(screen.getByRole("button", { name: /Masquées/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/listings", { params: { page: 1, visibility: "HIDDEN" } })
    );
  });

  it("exige un motif avant de masquer, puis l'envoie et recharge la liste", async () => {
    mockedApi.get.mockResolvedValue(page([annonce()]));
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();
    await screen.findByText("Villa Ngor");

    await userEvent.click(screen.getByRole("button", { name: "Masquer" }));
    const formulaire = screen.getByRole("textbox", { name: /Motif du masquage/ }).closest("form") as HTMLElement;
    const confirmer = within(formulaire).getByRole("button", { name: "Masquer l'annonce" });
    expect(confirmer).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox", { name: /Motif du masquage/ }), "  Photos sans rapport  ");
    expect(confirmer).toBeEnabled();
    await userEvent.click(confirmer);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/admin/listings/a1/hide", { reason: "Photos sans rapport" }));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("textbox", { name: /Motif du masquage/ })).not.toBeInTheDocument();
  });

  it("rétablit une annonce masquée sans demander de motif", async () => {
    mockedApi.get.mockResolvedValue(page([annonce({ hiddenByAdminAt: "2026-10-01T10:00:00.000Z", moderationReason: "Prix trompeur" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();
    await screen.findByText("Villa Ngor");

    // Une annonce déjà masquée ne propose pas de la masquer une seconde fois.
    expect(screen.queryByRole("button", { name: "Masquer" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rétablir" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/admin/listings/a1/restore", undefined));
  });

  it("bascule la mise en avant dans le bon sens", async () => {
    mockedApi.get.mockResolvedValue(page([annonce({ featured: true })]));
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    renderPage();
    await screen.findByText("Villa Ngor");

    await userEvent.click(screen.getByRole("button", { name: "Retirer de la une" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/admin/listings/a1/featured", { featured: false }));
  });

  it("affiche l'erreur serveur d'une action refusée, sans recharger", async () => {
    mockedApi.get.mockResolvedValue(page([annonce({ hiddenByAdminAt: "2026-10-01T10:00:00.000Z" })]));
    mockedApi.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Cette annonce n'est pas masquée" } } });
    renderPage();
    await screen.findByText("Villa Ngor");

    await userEvent.click(screen.getByRole("button", { name: "Rétablir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cette annonce n'est pas masquée");
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it("n'offre le lien public que pour une annonce réellement visible", async () => {
    mockedApi.get.mockResolvedValueOnce(
      page([
        annonce(),
        annonce({ id: "a2", title: "Masquée", hiddenByAdminAt: "2026-10-01T10:00:00.000Z" }),
        annonce({ id: "a3", title: "Brouillon", status: "DRAFT" }),
      ])
    );
    renderPage();
    await screen.findByText("Villa Ngor");

    const liens = screen.getAllByRole("link", { name: /fiche publique/i });
    expect(liens).toHaveLength(1);
    expect(liens[0]).toHaveAttribute("href", "/vitrine/annonces/a1");
  });
});
