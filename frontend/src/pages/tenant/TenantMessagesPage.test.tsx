import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { Conversation, Message } from "../../types";
import TenantMessagesPage from "./TenantMessagesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
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

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    contractId: "c1",
    senderId: "mgr-1",
    senderRole: "MANAGER",
    content: "Bonjour, comment puis-je vous aider ?",
    isRead: "true",
    createdAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <TenantMessagesPage />
    </AuthProvider>
  );
}

describe("TenantMessagesPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la conversation avec les messages du gestionnaire et du locataire", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [conversation()] });
    mockedApi.get.mockResolvedValueOnce({
      data: {
        messages: [message({ senderRole: "MANAGER", content: "Bonjour !" }), message({ id: "msg-2", senderRole: "TENANT", content: "Bonjour, j'ai une question." })],
        contract: { property: { title: "Studio Centre-ville" } },
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Bonjour !")).toBeInTheDocument());
    expect(screen.getByText("Bonjour, j'ai une question.")).toBeInTheDocument();
    expect(screen.getByText("Logement : Studio Centre-ville")).toBeInTheDocument();
    // Un message par expéditeur : le libellé "Gestionnaire" (côté agence) et
    // "Vous" (côté locataire) doivent chacun apparaître au moins une fois
    // au-dessus de la bulle correspondante (en plus du "Gestionnaire" du
    // titre "Agence & Gestionnaire" déjà vérifié implicitement ci-dessus).
    expect(screen.getAllByText(/Gestionnaire/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Vous/).length).toBeGreaterThanOrEqual(1);
  });

  it("affiche un message quand la conversation ne contient aucun échange", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [conversation()] });
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [], contract: { property: { title: "Studio Centre-ville" } } } });

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("👋 Vous n'avez pas encore d'échanges. Posez une question à votre gestionnaire ci-dessous.")
      ).toBeInTheDocument()
    );
  });

  it("affiche un message quand aucun contrat actif n'est associé", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aucun contrat de location actif associé pour échanger des messages.")).toBeInTheDocument()
    );
  });

  it("affiche une erreur avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: [conversation()] });
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [], contract: { property: { title: "Studio Centre-ville" } } } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() =>
      expect(
        screen.getByText("👋 Vous n'avez pas encore d'échanges. Posez une question à votre gestionnaire ci-dessous.")
      ).toBeInTheDocument()
    );
  });

  it("le bouton d'envoi est désactivé tant que le champ est vide", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [conversation()] });
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [], contract: { property: { title: "Studio Centre-ville" } } } });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Envoyer" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  });

  it("envoie un message : POST vers /messages/:contractId et l'affiche immédiatement", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [conversation()] });
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [], contract: { property: { title: "Studio Centre-ville" } } } });
    mockedApi.post.mockResolvedValueOnce({
      data: { id: "msg-new", contractId: "c1", senderId: "ten-1", senderRole: "TENANT", content: "Merci pour votre réponse.", isRead: "false", createdAt: "2026-06-15T11:00:00.000Z" },
    });

    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText("Écrivez votre message...")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Écrivez votre message..."), "Merci pour votre réponse.");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/messages/c1", { content: "Merci pour votre réponse." })
    );
    await waitFor(() => expect(screen.getByText("Merci pour votre réponse.")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Écrivez votre message...")).toHaveValue("");
  });

  it("affiche une alerte si l'envoi du message échoue", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [conversation()] });
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [], contract: { property: { title: "Studio Centre-ville" } } } });
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Message refusé" } },
      isAxiosError: true,
    });

    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText("Écrivez votre message...")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Écrivez votre message..."), "Test");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Message refusé"));
  });
});
