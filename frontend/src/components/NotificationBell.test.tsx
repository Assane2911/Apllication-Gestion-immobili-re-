import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // Une demande reçue via la vitrine est une notification de type « lead » : sans icône associée, l'élément ne se
  // rendait pas et faisait tomber la cloche entière dès la première demande.
  it("affiche une demande reçue via la vitrine, avec un lien vers le CRM des demandes", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        notifications: [
          notification({ id: "lead-1", type: "lead", title: "Demande de visite — Awa Diop", description: "Villa Ngor", link: "/leads" }),
        ],
      },
    });
    renderBell();

    await waitFor(() => expect(screen.getByLabelText("Notifications")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Notifications"));

    expect(await screen.findByText("Demande de visite — Awa Diop")).toBeInTheDocument();
    expect(screen.getByText("Villa Ngor")).toBeInTheDocument();
    expect(screen.getByText("Demande de visite — Awa Diop").closest("a")).toHaveAttribute("href", "/leads");
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

  describe("« Tout marquer comme lu »", () => {
    const bouton = () => screen.getByLabelText("Notifications");
    const deux = () => ({
      data: {
        notifications: [
          notification({ id: "a", key: "a|1", seen: false, read: false, title: "Loyer en retard A" }),
          notification({ id: "b", key: "b|1", seen: true, read: false, title: "Loyer en retard B" }),
        ],
      },
    });

    it("écarte les éléments du panneau, enregistre les clés et propose de les réafficher", async () => {
      mockedApi.get.mockResolvedValueOnce(deux());
      renderBell();
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
      fireEvent.click(bouton());
      expect(screen.getByText("2 élément(s) nécessitant votre attention")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Tout marquer comme lu"));

      expect(mockedApi.post).toHaveBeenCalledWith("/notifications/read", { keys: ["a|1", "b|1"] });
      expect(screen.queryByText("Loyer en retard A")).not.toBeInTheDocument();
      expect(screen.getByText("Tout est à jour")).toBeInTheDocument();
      expect(screen.queryByText("Tout marquer comme lu")).not.toBeInTheDocument();
      expect(screen.getByText("Afficher les 2 élément(s) lu(s)")).toBeInTheDocument();
    });

    it("permet de réafficher les éléments lus (atténués), puis de les masquer de nouveau", async () => {
      mockedApi.get.mockResolvedValueOnce(deux());
      renderBell();
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
      fireEvent.click(bouton());
      fireEvent.click(screen.getByText("Tout marquer comme lu"));

      fireEvent.click(screen.getByText("Afficher les 2 élément(s) lu(s)"));
      expect(screen.getByText("Loyer en retard A").closest("li")!.className).toContain("opacity-60");
      expect(screen.getByText("Loyer en retard B")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Masquer les éléments lus"));
      expect(screen.queryByText("Loyer en retard A")).not.toBeInTheDocument();
    });

    it("ne propose pas le bouton quand tout est déjà lu, et cache les lus par défaut", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: { notifications: [notification({ id: "a", key: "a|1", seen: true, read: true, title: "Déjà lu" })] },
      });
      renderBell();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());

      fireEvent.click(bouton());

      expect(screen.queryByText("Tout marquer comme lu")).not.toBeInTheDocument();
      expect(screen.queryByText("Déjà lu")).not.toBeInTheDocument();
      expect(screen.getByText("Tout est à jour")).toBeInTheDocument();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("n'écarte que les non lus et laisse le panneau à jour d'une notification arrivée ensuite", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: {
          notifications: [
            notification({ id: "old", key: "old|1", seen: true, read: true, title: "Ancien" }),
            notification({ id: "new", key: "new|1", seen: false, read: false, title: "Récent" }),
          ],
        },
      });
      renderBell();
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
      fireEvent.click(bouton());

      fireEvent.click(screen.getByText("Tout marquer comme lu"));

      // Seule la clé non lue est envoyée.
      expect(mockedApi.post).toHaveBeenCalledWith("/notifications/read", { keys: ["new|1"] });
    });

    it("enregistre sur l'endpoint du portail utilisé (locataire)", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { notifications: [notification({ key: "n1|1", seen: true, read: false })] } });
      renderBell({ endpoint: "/notifications/mine", i18nPrefix: "tenant.notificationBell" });
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
      fireEvent.click(bouton());

      fireEvent.click(screen.getByText("Tout marquer comme lu"));

      expect(mockedApi.post).toHaveBeenCalledWith("/notifications/mine/read", { keys: ["n1|1"] });
    });

    it("remet les éléments dans le panneau si l'enregistrement échoue (l'état réel est relu)", async () => {
      const seule = () => ({ data: { notifications: [notification({ id: "a", key: "a|1", seen: true, read: false, title: "À traiter" })] } });
      mockedApi.get.mockResolvedValueOnce(seule()).mockResolvedValueOnce(seule());
      mockedApi.post.mockRejectedValueOnce(new Error("réseau"));
      renderBell();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));
      fireEvent.click(bouton());

      fireEvent.click(screen.getByText("Tout marquer comme lu"));

      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText("À traiter")).toBeInTheDocument());
    });

    it("un sondage arrivant après n'y remet pas ce qui vient d'être écarté", async () => {
      vi.useFakeTimers();
      try {
        const nonLue = { data: { notifications: [notification({ id: "a", key: "a|1", seen: true, read: false, title: "À traiter" })] } };
        mockedApi.get.mockResolvedValue(nonLue);
        renderBell();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10);
        });
        fireEvent.click(screen.getByLabelText("Notifications"));
        fireEvent.click(screen.getByText("Tout marquer comme lu"));
        expect(screen.queryByText("À traiter")).not.toBeInTheDocument();

        // Le serveur répond encore « non lue » (réponse calculée avant l'enregistrement).
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(mockedApi.get.mock.calls.length).toBeGreaterThan(1);
        expect(screen.queryByText("À traiter")).not.toBeInTheDocument();
        expect(screen.getByText("Tout est à jour")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("remet l'affichage des éléments lus à zéro à la fermeture du panneau", async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: { notifications: [notification({ id: "a", key: "a|1", seen: true, read: true, title: "Déjà lu" })] },
      });
      renderBell();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
      fireEvent.click(bouton());
      fireEvent.click(screen.getByText("Afficher les 1 élément(s) lu(s)"));
      expect(screen.getByText("Déjà lu")).toBeInTheDocument();

      fireEvent.click(bouton());
      fireEvent.click(bouton());

      expect(screen.queryByText("Déjà lu")).not.toBeInTheDocument();
    });
  });
});

/**
 * Sondage de la cloche (toutes les 30 s) et visibilité de l'onglet.
 *
 * Un onglet laissé ouvert en arrière-plan sondait le serveur toute la journée — près de 1 000 appels par jour, chacun
 * avec authentification, contrôle d'abonnement et sept requêtes SQL — pour une cloche que personne ne regarde. Le
 * sondage s'arrête donc quand l'onglet est caché, et repart (avec un rafraîchissement immédiat) quand il redevient
 * visible : la cloche est à jour dès que la personne revient.
 */
describe("NotificationBell — sondage et visibilité de l'onglet", () => {
  function onglet(etat: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => etat });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  const avancer = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const appels = () => mockedApi.get.mock.calls.length;

  beforeEach(() => {
    vi.useFakeTimers();
    mockedApi.get.mockReset();
    mockedApi.get.mockResolvedValue({ data: { notifications: [] } });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it("onglet visible : une lecture à l'ouverture, puis une toutes les 30 secondes", async () => {
    renderBell();
    await avancer(10);
    expect(appels()).toBe(1);
    await avancer(30_000);
    expect(appels()).toBe(2);
    await avancer(30_000);
    expect(appels()).toBe(3);
  });

  it("onglet caché : plus aucun sondage, même au bout de plusieurs minutes", async () => {
    renderBell();
    await avancer(10);
    onglet("hidden");
    const avant = appels();
    await avancer(10 * 60_000);
    expect(appels()).toBe(avant);
  });

  it("retour sur l'onglet : rafraîchissement immédiat, puis le rythme de 30 secondes reprend", async () => {
    renderBell();
    await avancer(10);
    onglet("hidden");
    await avancer(5 * 60_000);
    const avant = appels();

    onglet("visible");
    await avancer(10);
    expect(appels()).toBe(avant + 1);

    await avancer(30_000);
    expect(appels()).toBe(avant + 2);
  });

  it("ouverte dans un onglet caché : une seule lecture, puis rien jusqu'au retour", async () => {
    onglet("hidden");
    renderBell();
    await avancer(10);
    expect(appels()).toBe(1);
    await avancer(5 * 60_000);
    expect(appels()).toBe(1);

    onglet("visible");
    await avancer(10);
    expect(appels()).toBe(2);
  });

  it("plusieurs retours consécutifs ne multiplient pas les sondages (un seul minuteur)", async () => {
    renderBell();
    await avancer(10);
    onglet("hidden");
    onglet("visible");
    onglet("visible");
    await avancer(10);
    const avant = appels();
    await avancer(30_000);
    expect(appels()).toBe(avant + 1);
    await avancer(30_000);
    expect(appels()).toBe(avant + 2);
  });

  it("démontée, la cloche ne réagit plus aux changements de visibilité", async () => {
    const { unmount } = renderBell();
    await avancer(10);
    unmount();
    const avant = appels();
    onglet("hidden");
    onglet("visible");
    await avancer(60_000);
    expect(appels()).toBe(avant);
  });

  it("le portail locataire (autre endpoint) suit la même règle", async () => {
    renderBell({ endpoint: "/notifications/mine", i18nPrefix: "components.notificationBell" });
    await avancer(10);
    onglet("hidden");
    await avancer(5 * 60_000);
    expect(appels()).toBe(1);
    expect(mockedApi.get).toHaveBeenCalledWith("/notifications/mine", expect.anything());
  });
});
