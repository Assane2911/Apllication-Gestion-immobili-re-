import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { NotificationItem } from "../types";
import NotificationBell from "./NotificationBell";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    type: "message",
    severity: "info",
    title: "Nouveau message",
    description: "Awa Diallo vous a écrit",
    link: "/messages",
    createdAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

function renderBell(props: { endpoint?: string; i18nPrefix?: string } = {}) {
  return render(
    <MemoryRouter>
      <NotificationBell {...props} />
    </MemoryRouter>
  );
}

describe("NotificationBell", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.post.mockResolvedValue({ data: { success: true } });
  });

  it("affiche le nombre de notifications non lues", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { notifications: [notification(), notification({ id: "n2" })] },
    });
    renderBell();

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  /**
   * Régression : clearInterval arrête les prochains sondages (toutes les
   * 30s), mais pas celui déjà EN VOL au moment du démontage. Sans
   * AbortController, une réponse arrivant après le démontage (navigation au
   * moment précis où le sondage partait) appelait quand même setItems sur un
   * composant qui n'existe plus.
   */
  it("annule la requête en cours si le composant est démonté avant la réponse", async () => {
    let rejectPending!: (err: unknown) => void;
    const pending = new Promise((_resolve, reject) => {
      rejectPending = reject;
    });
    mockedApi.get.mockImplementationOnce((_url: string, config?: { signal?: AbortSignal }) => {
      config?.signal?.addEventListener("abort", () => rejectPending({ __CANCEL__: true }));
      return pending;
    });

    const { unmount } = renderBell();
    unmount();

    await expect(pending).rejects.toEqual({ __CANCEL__: true });
  });

  /**
   * Généralisée pour servir d'autres portails (voir TenantLayout.tsx) :
   * `endpoint`/`i18nPrefix` doivent réellement être pris en compte, et pas
   * seulement acceptés sans effet, sans quoi un portail locataire afficherait
   * silencieusement les notifications — et les textes — d'un autre portail.
   */
  it("interroge l'endpoint fourni et utilise le préfixe i18n fourni, plutôt que ceux du gestionnaire", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { notifications: [notification()] } });
    renderBell({ endpoint: "/notifications/mine", i18nPrefix: "tenant.notificationBell" });

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/notifications/mine", expect.anything()));

    const bouton = screen.getByLabelText("Notifications");
    fireEvent.mouseEnter(bouton.parentElement!);
    expect(
      screen.getByText("Vos alertes : messages du gestionnaire, loyers à régler, bail arrivant à échéance.")
    ).toBeInTheDocument();
  });

  describe("état « vu »", () => {
    const bouton = () => screen.getByLabelText("Notifications");

    it("ne compte dans le badge que les notifications non vues", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: {
          notifications: [
            notification({ id: "a", key: "a|1", seen: true }),
            notification({ id: "b", key: "b|1", seen: false }),
            notification({ id: "c", key: "c|1", seen: true }),
          ],
        },
      });
      renderBell();

      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    });

    it("n'affiche aucun badge quand tout a été vu, mais garde les éléments dans la liste", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: { notifications: [notification({ id: "a", key: "a|1", seen: true, title: "Loyer en retard" })] },
      });
      renderBell();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());

      expect(screen.queryByText("1")).not.toBeInTheDocument();
      fireEvent.click(bouton());
      expect(screen.getByText("Loyer en retard")).toBeInTheDocument();
      // Rien de nouveau : aucun enregistrement inutile.
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("marque les notifications vues à l'ouverture : badge éteint, clés envoyées, nouveautés surlignées", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: {
          notifications: [
            notification({ id: "a", key: "a|1", seen: false, title: "Nouveau message" }),
            notification({ id: "b", key: "b|1", seen: true, title: "Loyer en retard" }),
          ],
        },
      });
      renderBell();
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

      fireEvent.click(bouton());

      expect(mockedApi.post).toHaveBeenCalledWith("/notifications/seen", { keys: ["a|1", "b|1"] });
      expect(screen.queryByText("1")).not.toBeInTheDocument();
      const nouveau = screen.getByText("Nouveau message").closest("li")!;
      const ancien = screen.getByText("Loyer en retard").closest("li")!;
      expect(nouveau.className).toContain("bg-brand-50");
      expect(ancien.className).not.toContain("bg-brand-50");

      // Une fois le panneau refermé, plus de surlignage.
      fireEvent.click(bouton());
      fireEvent.click(bouton());
      expect(screen.getByText("Nouveau message").closest("li")!.className).not.toContain("bg-brand-50");
    });

    it("enregistre sur l'endpoint du portail utilisé (locataire)", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { notifications: [notification({ key: "n1|1", seen: false })] } });
      renderBell({ endpoint: "/notifications/mine", i18nPrefix: "tenant.notificationBell" });
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

      fireEvent.click(bouton());

      expect(mockedApi.post).toHaveBeenCalledWith("/notifications/mine/seen", { keys: ["n1|1"] });
    });

    it("sans clé ni état dans la réponse (ancien backend), tout est nouveau et l'identifiant sert de clé", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { notifications: [notification({ id: "n9" })] } });
      renderBell();
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

      fireEvent.click(bouton());

      expect(mockedApi.post).toHaveBeenCalledWith("/notifications/seen", { keys: ["n9"] });
    });

    it("rallume le badge si l'enregistrement échoue (l'état réel est relu)", async () => {
      mockedApi.get
        .mockResolvedValueOnce({ data: { notifications: [notification({ key: "n1|1", seen: false })] } })
        .mockResolvedValueOnce({ data: { notifications: [notification({ key: "n1|1", seen: false })] } });
      mockedApi.post.mockRejectedValueOnce(new Error("réseau"));
      renderBell();
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

      fireEvent.click(bouton());

      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("1", { selector: "span.rounded-full" })).toBeInTheDocument());
    });

    it("un sondage parti avant l'ouverture et arrivant après ne rallume pas le badge", async () => {
      vi.useFakeTimers();
      try {
        const nonVue = { data: { notifications: [notification({ key: "n1|1", seen: false })] } };
        mockedApi.get.mockResolvedValue(nonVue);
        renderBell();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10);
        });
        expect(screen.getByText("1")).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText("Notifications"));
        expect(screen.queryByText("1")).not.toBeInTheDocument();

        // Le sondage suivant renvoie encore « non vue » (réponse calculée avant l'enregistrement).
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(mockedApi.get.mock.calls.length).toBeGreaterThan(1);
        expect(screen.queryByText("1")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
