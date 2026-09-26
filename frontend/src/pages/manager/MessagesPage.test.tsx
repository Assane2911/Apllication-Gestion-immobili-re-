import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { Conversation, Message, PaginatedResponse } from "../../types";
import MessagesPage from "./MessagesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    contractId: "c1",
    property: { title: "Studio Centre-ville" } as Conversation["property"],
    tenant: { firstName: "Awa", lastName: "Diallo" } as Conversation["tenant"],
    lastMessage: null,
    ...overrides,
  };
}

function conversationsPage(
  items: Conversation[],
  overrides: Partial<PaginatedResponse<Conversation>> = {}
): { data: PaginatedResponse<Conversation> } {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...overrides },
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    contractId: "c1",
    senderId: "ten-1",
    senderRole: "TENANT",
    content: "Bonjour, j'ai une question sur mon loyer.",
    isRead: true,
    createdAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <MessagesPage />
    </AuthProvider>
  );
}

describe("MessagesPage (gestionnaire)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche la liste des conversations et sélectionne la première automatiquement", async () => {
    mockedApi.get.mockResolvedValueOnce(conversationsPage([conversation()]));
    mockedApi.get.mockResolvedValueOnce({
      data: { messages: [message()], contract: { tenant: { firstName: "Awa", lastName: "Diallo" }, property: { title: "Studio Centre-ville" } } },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Bonjour, j'ai une question sur mon loyer.")).toBeInTheDocument());
    // "Awa Diallo" apparaît deux fois : dans la liste des conversations à
    // gauche et dans l'en-tête du fil sélectionné à droite (sélection
    // automatique de la première conversation).
    expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1 conversation(s)")).toBeInTheDocument();
  });

  /**
   * Régression : la liste des conversations du gestionnaire renvoyait
   * autrefois TOUTES les conversations d'un coup, sans pagination — une
   * agence avec beaucoup de locataires chargeait donc une liste sans fin à
   * chaque ouverture de la messagerie. Ce test vérifie que la pagination
   * (identique aux autres listes de l'appli) est bien câblée de bout en
   * bout : le contrôle de pagination s'affiche quand il y a plusieurs
   * pages, et cliquer sur "Suivant" redemande bien la page 2 au serveur.
   */
  it("pagine la liste des conversations : le bouton Suivant redemande la page 2", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(conversationsPage([conversation()], { total: 25, totalPages: 2 }));
    mockedApi.get.mockResolvedValueOnce({
      data: { messages: [message()], contract: { tenant: { firstName: "Awa", lastName: "Diallo" }, property: { title: "Studio Centre-ville" } } },
    });
    mockedApi.get.mockResolvedValueOnce(
      conversationsPage([conversation({ contractId: "c2" })], { page: 2, total: 25, totalPages: 2 })
    );
    mockedApi.get.mockResolvedValueOnce({
      data: { messages: [], contract: { tenant: { firstName: "Awa", lastName: "Diallo" }, property: { title: "Studio Centre-ville" } } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText("25 au total")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith(
        "/messages/conversations",
        expect.objectContaining({ params: { page: 2, pageSize: 20 } })
      )
    );
  });

  it("affiche un message dédié quand il n'y a aucune conversation", async () => {
    mockedApi.get.mockResolvedValueOnce(conversationsPage([]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun contrat ou locataire actif.")).toBeInTheDocument());
    expect(screen.getByText("Sélectionnez une discussion à gauche pour commencer à échanger.")).toBeInTheDocument();
  });

  it("envoie un message : POST vers /messages/:contractId et l'affiche immédiatement", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(conversationsPage([conversation()]));
    mockedApi.get.mockResolvedValueOnce({
      data: { messages: [], contract: { tenant: { firstName: "Awa", lastName: "Diallo" }, property: { title: "Studio Centre-ville" } } },
    });
    mockedApi.post.mockResolvedValueOnce({
      data: {
        id: "msg-new",
        contractId: "c1",
        senderId: "mgr-1",
        senderRole: "MANAGER",
        content: "Bonjour, votre quittance est prête.",
        isRead: false,
        createdAt: "2026-06-15T11:00:00.000Z",
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText("Écrivez votre message...")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Écrivez votre message..."), "Bonjour, votre quittance est prête.");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/messages/c1", { content: "Bonjour, votre quittance est prête." })
    );
    await waitFor(() => expect(screen.getByText("Bonjour, votre quittance est prête.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton réessayer en cas d'échec du chargement", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(conversationsPage([]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Aucun contrat ou locataire actif.")).toBeInTheDocument());
  });
});
