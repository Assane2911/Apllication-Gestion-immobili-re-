import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { Message } from "../../types";
import { installerFauxMicro } from "../../test/fauxMicro";
import OwnerMessagesPage from "./OwnerMessagesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function message(overrides: Partial<Message> = {}): Message {
  return { id: "m1", senderId: "u1", senderRole: "MANAGER", content: "Votre CRG est prêt.", isRead: true, createdAt: "2026-06-15T10:00:00.000Z", ...overrides };
}

const renderPage = () =>
  render(
    <AuthProvider>
      <OwnerMessagesPage />
    </AuthProvider>
  );

describe("OwnerMessagesPage (espace propriétaire)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("charge son propre fil (sans identifiant) et l'affiche avec l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [message(), message({ id: "m2", senderRole: "OWNER", content: "Merci !" })] } });
    renderPage();

    expect(await screen.findByText("Votre CRG est prêt.")).toBeInTheDocument();
    expect(screen.getByText("Merci !")).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(mockedApi.get.mock.calls[0][0]).toBe("/owner-messages/mine");
    expect(screen.getByRole("heading", { name: "Messagerie" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Votre agence" })).toBeInTheDocument();
  });

  it("invite à écrire quand le fil est vide", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [] } });
    renderPage();
    expect(await screen.findByText("Aucun message pour le moment. Écrivez à votre agence ci-dessous.")).toBeInTheDocument();
  });

  it("envoie un message texte et l'ajoute au fil", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [] } });
    mockedApi.post.mockResolvedValueOnce({ data: message({ id: "m9", senderRole: "OWNER", content: "Quand aura lieu mon virement ?" }) });
    renderPage();

    await user.type(await screen.findByLabelText("Écrivez votre message..."), "Quand aura lieu mon virement ?");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/owner-messages/mine", { content: "Quand aura lieu mon virement ?" }));
    expect(await screen.findByText("Quand aura lieu mon virement ?")).toBeInTheDocument();
  });

  it("une réponse rapide insère le texte sans l'envoyer", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: { messages: [] } });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Date du virement" }));
    expect(screen.getByLabelText("Écrivez votre message...")).toHaveValue("Bonjour, pouvez-vous me confirmer la date de mon prochain virement ?");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("envoie un vocal en multipart vers la route audio du propriétaire, avec sa durée", async () => {
    const user = userEvent.setup();
    const micro = installerFauxMicro();
    try {
      mockedApi.get.mockResolvedValueOnce({ data: { messages: [] } });
      mockedApi.post.mockResolvedValueOnce({
        data: message({ id: "v1", senderRole: "OWNER", content: "", audioUrl: "https://stockage.test/v1.webm", audioDurationSec: 1, audioMime: "audio/webm" }),
      });
      renderPage();

      await user.click(await screen.findByRole("button", { name: "Enregistrer un message vocal" }));
      await screen.findByText("Enregistrement");
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1100));
      });
      await user.click(screen.getByRole("button", { name: "Terminer" }));
      await user.click(await screen.findByRole("button", { name: "Envoyer le vocal" }));

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      const [url, corps] = mockedApi.post.mock.calls[0] as [string, FormData];
      expect(url).toBe("/owner-messages/mine/audio");
      expect(corps).toBeInstanceOf(FormData);
      expect(Number(corps.get("durationSec"))).toBeGreaterThanOrEqual(1);
      expect((corps.get("audio") as File).name).toBe("vocal.webm");
      expect(await screen.findByText("0:00 / 0:01")).toBeInTheDocument();
    } finally {
      micro.restaurer();
    }
  });

  it("affiche l'erreur du serveur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce(Object.assign(new Error("boom"), { isAxiosError: true, response: { data: { error: "Aucune fiche propriétaire n'est rattachée à ce compte." } } }));
    renderPage();
    expect(await screen.findByText("Aucune fiche propriétaire n'est rattachée à ce compte.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
