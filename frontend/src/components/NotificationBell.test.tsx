import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { NotificationItem } from "../types";
import NotificationBell from "./NotificationBell";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
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
});
