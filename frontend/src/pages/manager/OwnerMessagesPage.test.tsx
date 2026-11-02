import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { ConversationProprietaire, Message, PaginatedResponse } from "../../types";
import OwnerMessagesPage from "./OwnerMessagesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function message(overrides: Partial<Message> = {}): Message {
  return { id: "m1", senderId: "u1", senderRole: "OWNER", content: "Où en est mon virement ?", isRead: false, createdAt: "2026-06-15T10:00:00.000Z", ...overrides };
}

function fil(id: string, prenom: string, nom: string, overrides: Partial<ConversationProprietaire> = {}): ConversationProprietaire {
  return {
    id,
    owner: { id, firstName: prenom, lastName: nom, displayName: `${prenom} ${nom}`, hasPortalAccess: true },
    unreadCount: 0,
    lastMessage: null,
    ...overrides,
  };
}

function liste(items: ConversationProprietaire[]): { data: PaginatedResponse<ConversationProprietaire> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/messages/proprietaires"]}>
      <AuthProvider>
        <OwnerMessagesPage />
      </AuthProvider>
    </MemoryRouter>
  );

describe("OwnerMessagesPage (espace gestionnaire)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("liste les propriétaires, ouvre le premier fil et signale les messages non lus", async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/owner-messages/conversations")
        return liste([fil("o1", "Fatou", "Diop", { unreadCount: 1, lastMessage: message() }), fil("o2", "Moussa", "Sy", { lastMessage: message({ id: "m2", senderRole: "MANAGER", content: "Bien reçu" }) })]);
      if (url === "/owner-messages/o1") return { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [message()] } };
      throw new Error(`inattendu : ${url}`);
    });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Messagerie propriétaires" })).toBeInTheDocument();
    // Le fil ouvert d'office montre ses messages ; la pastille « non lu » du fil ouvert disparaît (il vient d'être lu).
    expect((await screen.findAllByText("Où en est mon virement ?")).length).toBeGreaterThan(0);
    expect(screen.getByText("Moussa Sy")).toBeInTheDocument();
    expect(screen.getByText("Bien reçu")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("img", { name: "Nouveau message" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Compte-rendu de gestion" })).toHaveAttribute("href", "/proprietaires/o1/crg");
  });

  it("change de fil au clic et charge les messages du propriétaire choisi", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/owner-messages/conversations") return liste([fil("o1", "Fatou", "Diop"), fil("o2", "Moussa", "Sy")]);
      if (url === "/owner-messages/o1") return { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [message({ content: "Message de Fatou" })] } };
      if (url === "/owner-messages/o2") return { data: { owner: fil("o2", "Moussa", "Sy").owner, messages: [message({ id: "m5", content: "Message de Moussa" })] } };
      throw new Error(`inattendu : ${url}`);
    });
    renderPage();

    expect(await screen.findByText("Message de Fatou")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Moussa Sy/ }));
    expect(await screen.findByText("Message de Moussa")).toBeInTheDocument();
    expect(screen.queryByText("Message de Fatou")).not.toBeInTheDocument();
  });

  it("envoie un message texte dans le fil choisi, puis recharge la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/owner-messages/conversations") return liste([fil("o1", "Fatou", "Diop")]);
      if (url === "/owner-messages/o1") return { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [] } };
      throw new Error(`inattendu : ${url}`);
    });
    mockedApi.post.mockResolvedValueOnce({ data: message({ id: "m7", senderRole: "MANAGER", content: "Virement fait", isRead: false }) });
    renderPage();

    await user.type(await screen.findByLabelText("Écrivez votre message..."), "Virement fait");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/owner-messages/o1", { content: "Virement fait" }));
    expect(await screen.findByText("Virement fait")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.get.mock.calls.filter((c) => c[0] === "/owner-messages/conversations").length).toBe(2));
  });

  it("filtre par nom et sur les discussions non lues", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/owner-messages/conversations") return liste([fil("o1", "Fatou", "Diop"), fil("o2", "Moussa", "Sy", { unreadCount: 2, lastMessage: message() })]);
      return { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [] } };
    });
    renderPage();
    await screen.findByText("Moussa Sy");

    await user.click(screen.getByRole("button", { name: "Non lues" }));
    expect(screen.queryByRole("button", { name: /Fatou Diop/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Moussa Sy/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Toutes" }));
    await user.type(screen.getByRole("searchbox", { name: "Nom du propriétaire…" }), "fat");
    expect(screen.queryByRole("button", { name: /Moussa Sy/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fatou Diop/ })).toBeInTheDocument();
  });

  it("sans aucun propriétaire invité, explique comment ouvrir une discussion", async () => {
    mockedApi.get.mockResolvedValueOnce(liste([]));
    renderPage();
    expect(await screen.findByText(/Aucun propriétaire n'a encore accès à son espace/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir les propriétaires" })).toHaveAttribute("href", "/proprietaires");
  });

  it("propose les deux messageries en onglets, celle des propriétaires étant active", async () => {
    mockedApi.get.mockResolvedValueOnce(liste([]));
    renderPage();
    const onglets = await screen.findByRole("navigation", { name: "Type de discussion" });
    expect(within(onglets).getByRole("link", { name: "Locataires" })).toHaveAttribute("href", "/messages");
    expect(within(onglets).getByRole("link", { name: "Propriétaires" })).toHaveAttribute("aria-current", "page");
  });

  it("affiche l'erreur du serveur, par exemple un propriétaire sans accès au portail", async () => {
    mockedApi.get.mockRejectedValueOnce(Object.assign(new Error("boom"), { isAxiosError: true, response: { data: { error: "Erreur serveur de test" } } }));
    renderPage();
    expect(await screen.findByText("Erreur serveur de test")).toBeInTheDocument();
  });
});

describe("OwnerMessagesPage (gestionnaire) — mise à jour en direct", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("affiche le message d'un propriétaire dans le fil ouvert, et met la liste à jour avec lui", async () => {
    let appels = 0;
    mockedApi.get.mockImplementation(async (url: string, config?: { params?: { apresId?: string } }) => {
      if (url === "/owner-messages/conversations") {
        appels++;
        return liste([fil("o1", "Fatou", "Diop", appels > 1 ? { lastMessage: message({ id: "m2", content: "Où est mon virement ?" }) } : {})]);
      }
      if (url === "/owner-messages/o1" && config?.params?.apresId) return { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [message({ id: "m2", content: "Où est mon virement ?" })], luesIds: [] } };
      if (url === "/owner-messages/o1") return { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [message({ id: "m1", senderRole: "MANAGER", content: "Bonjour" })] } };
      throw new Error(`inattendu : ${url}`);
    });
    renderPage();
    expect(await screen.findByText("Bonjour")).toBeInTheDocument();
    expect(screen.queryByText("Où est mon virement ?")).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    // Dans le fil, et dans l'aperçu de la liste (rafraîchie parce qu'il y a du nouveau).
    await waitFor(() => expect(screen.getAllByText("Où est mon virement ?").length).toBe(2));
    expect(mockedApi.get).toHaveBeenCalledWith("/owner-messages/o1", { params: { apresId: "m1" } });
  });

  it("recharge aussi la liste des fils toutes les trente secondes (un message arrivé dans un autre fil)", async () => {
    mockedApi.get.mockImplementation(async (url: string) =>
      url === "/owner-messages/conversations" ? liste([fil("o1", "Fatou", "Diop")]) : { data: { owner: fil("o1", "Fatou", "Diop").owner, messages: [] } }
    );
    renderPage();
    await screen.findByRole("button", { name: /Fatou Diop/ });
    const avant = mockedApi.get.mock.calls.filter((c) => c[0] === "/owner-messages/conversations").length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mockedApi.get.mock.calls.filter((c) => c[0] === "/owner-messages/conversations").length).toBeGreaterThan(avant);
  });
});
