import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { ConversationProprietaire, Message, PaginatedResponse } from "../../types";
import OwnerMessagesPage from "./OwnerMessagesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * La messagerie du gestionnaire avec les propriétaires : les réponses rapides (un message de reversement ou de compte-rendu envoyé
 * tel quel à un propriétaire doit être exact), la reprise après une erreur de chargement, l'effacement de la recherche et le
 * retour à la liste des fils sur téléphone.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 500,
    statusText: "Server Error",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const message = (o: Partial<Message> = {}): Message => ({ id: "m1", senderId: "u1", senderRole: "OWNER", content: "Où en est mon reversement ?", isRead: false, createdAt: "2026-06-15T10:00:00.000Z", ...o });
const fil = (id: string, prenom: string, nom: string): ConversationProprietaire => ({
  id,
  owner: { id, firstName: prenom, lastName: nom, displayName: `${prenom} ${nom}`, hasPortalAccess: true },
  unreadCount: 0,
  lastMessage: null,
});
const liste = (items: ConversationProprietaire[]): { data: PaginatedResponse<ConversationProprietaire> } => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } });

function servir(fils = [fil("o1", "Fatou", "Diop"), fil("o2", "Moussa", "Sy")]) {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/owner-messages/conversations") return liste(fils);
    const id = url.split("/").pop() as string;
    const f = fils.find((x) => x.id === id) ?? fils[0];
    return { data: { owner: f.owner, messages: [] } };
  });
}
const afficher = () =>
  render(
    <MemoryRouter initialEntries={["/messages/proprietaires"]}>
      <AuthProvider>
        <OwnerMessagesPage />
      </AuthProvider>
    </MemoryRouter>
  );
const zoneSaisie = () => screen.findByLabelText("Écrivez votre message...") as Promise<HTMLTextAreaElement>;

const TEXTE_VIREMENT = "Bonjour, le reversement de vos loyers du mois a été effectué.";
const TEXTE_MERCI = "Bonjour, merci pour votre message.";

describe("OwnerMessagesPage : réponses rapides, reprise et navigation", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  describe("réponses rapides", () => {
    it("un clic place le texte tout prêt dans la zone de saisie, sans rien envoyer", async () => {
      const user = userEvent.setup();
      servir();
      afficher();
      const zone = await zoneSaisie();

      await user.click(screen.getByRole("button", { name: "Reversement effectué" }));

      expect(zone).toHaveValue(TEXTE_VIREMENT);
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("un second clic ajoute le texte à la suite, séparé par une espace, sans doubler les espaces de fin", async () => {
      const user = userEvent.setup();
      servir();
      afficher();
      const zone = await zoneSaisie();
      await user.type(zone, "Bonjour Fatou.   ");

      await user.click(screen.getByRole("button", { name: "Merci" }));

      expect(zone).toHaveValue(`Bonjour Fatou. ${TEXTE_MERCI}`);
    });

    it("une zone qui ne contient que des espaces reçoit le texte sans espace en tête", async () => {
      const user = userEvent.setup();
      servir();
      afficher();
      const zone = await zoneSaisie();
      await user.type(zone, "   ");

      await user.click(screen.getByRole("button", { name: "Merci" }));

      expect(zone).toHaveValue(TEXTE_MERCI);
    });

    it("chaque réponse rapide pose son propre texte", async () => {
      const user = userEvent.setup();
      servir();
      afficher();
      const zone = await zoneSaisie();

      await user.click(screen.getByRole("button", { name: "CRG disponible" }));
      expect(zone).toHaveValue("Bonjour, votre compte-rendu de gestion du mois est disponible dans votre espace propriétaire.");

      await user.clear(zone);
      await user.click(screen.getByRole("button", { name: "Document à fournir" }));
      expect(zone).toHaveValue("Bonjour, pourriez-vous nous transmettre le document demandé dès que possible ? Merci d'avance.");
    });

    it("le texte posé par une réponse rapide part tel quel avec « Envoyer »", async () => {
      const user = userEvent.setup();
      servir();
      mockedApi.post.mockResolvedValue({ data: message({ id: "m9", senderRole: "MANAGER", content: TEXTE_VIREMENT }) });
      afficher();
      await zoneSaisie();

      await user.click(screen.getByRole("button", { name: "Reversement effectué" }));
      await user.click(screen.getByRole("button", { name: "Envoyer" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/owner-messages/o1", { content: TEXTE_VIREMENT }));
    });
  });

  it("liste en échec : le message du serveur s'affiche et « Réessayer » recharge les fils", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockRejectedValueOnce(erreurServeur("Messagerie indisponible."));
    afficher();
    expect(await screen.findByText("Messagerie indisponible.")).toBeInTheDocument();

    servir();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Moussa Sy")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Messagerie indisponible.")).not.toBeInTheDocument());
  });

  it("« Effacer la recherche » vide la saisie et ramène tous les propriétaires", async () => {
    const user = userEvent.setup();
    servir();
    afficher();
    await screen.findByText("Moussa Sy");
    await user.type(screen.getByRole("searchbox", { name: "Nom du propriétaire…" }), "fat");
    expect(screen.queryByRole("button", { name: /Moussa Sy/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Effacer la recherche" }));

    expect(screen.getByRole("searchbox", { name: "Nom du propriétaire…" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /Moussa Sy/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Effacer la recherche" })).not.toBeInTheDocument();
  });

  it("le bouton « Retour » (téléphone) quitte le fil ouvert et ramène à la liste des propriétaires", async () => {
    const user = userEvent.setup();
    servir();
    afficher();
    await zoneSaisie();

    await user.click(screen.getByRole("button", { name: "Retour" }));

    await waitFor(() => expect(screen.queryByLabelText("Écrivez votre message...")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Moussa Sy/ })).toBeInTheDocument();
  });
});
