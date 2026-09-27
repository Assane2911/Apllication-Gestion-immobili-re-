import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./auth";

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const mockedApi = vi.mocked(api, { deep: true });

function TestConsumer() {
  const { user, loading, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user-email">{user?.email ?? "aucun"}</span>
      <span data-testid="tenant-name">{user?.tenantName ?? "aucun"}</span>
      <span data-testid="devise">{user?.currency ?? "aucune"}</span>
      <button
        type="button"
        data-testid="login-btn"
        onClick={() => login("alice@test.local", "Password123!").catch(() => {})}
      >
        login
      </button>
      <button type="button" data-testid="logout-btn" onClick={logout}>
        logout
      </button>
      <button type="button" data-testid="refresh-btn" onClick={() => void refreshUser()}>
        refresh
      </button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("démarre sans utilisateur et sans appel réseau quand localStorage est vide", async () => {
    renderAuth();

    expect(screen.getByTestId("user-email").textContent).toBe("aucun");
    // Laisse le useEffect initial (refreshUser) se dérouler avant de vérifier :
    // sans indice de session locale (voir AuthContext.tsx — `user` sur le web,
    // `token` en natif), il doit ressortir immédiatement, sans jamais appeler
    // l'API.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it("login (web) : stocke l'utilisateur et met à jour le contexte, sans stocker le jeton en localStorage", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "jwt-abc", user: { id: "u1", email: "alice@test.local", role: "MANAGER" } },
    });
    renderAuth();

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => expect(screen.getByTestId("user-email").textContent).toBe("alice@test.local"));
    // Le cookie httpOnly posé par le serveur (voir backend/src/utils/authCookie.ts)
    // porte désormais la session sur le web : stocker aussi le jeton en clair ici
    // recréerait le risque de vol par XSS que cette migration retire.
    expect(localStorage.getItem("token")).toBeNull();
    expect(JSON.parse(localStorage.getItem("user")!).email).toBe("alice@test.local");
    expect(localStorage.getItem("hasSession")).toBe("1");
  });

  it("login : en cas d'échec, n'enregistre rien et repasse loading à false", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(new Error("Identifiants invalides"));
    renderAuth();

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user-email").textContent).toBe("aucun");
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("logout : efface le token et l'utilisateur du localStorage et du contexte", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "jwt-abc", user: { id: "u1", email: "alice@test.local", role: "MANAGER" } },
    });
    renderAuth();
    await user.click(screen.getByTestId("login-btn"));
    await waitFor(() => expect(screen.getByTestId("user-email").textContent).toBe("alice@test.local"));

    await user.click(screen.getByTestId("logout-btn"));

    expect(screen.getByTestId("user-email").textContent).toBe("aucun");
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(localStorage.getItem("hasSession")).toBeNull();
  });

  it("refreshUser : reconstruit tenantId/tenantName à partir de /auth/me quand une session locale est connue", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "t1", email: "locataire@test.local", role: "TENANT" }));
    localStorage.setItem("hasSession", "1");
    mockedApi.get.mockResolvedValueOnce({
      data: {
        id: "t1",
        email: "locataire@test.local",
        role: "TENANT",
        tenant: { id: "tenant-1", firstName: "Jean", lastName: "Dupont" },
        subscription: null,
      },
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("user-email").textContent).toBe("locataire@test.local"));
    expect(screen.getByTestId("tenant-name").textContent).toBe("Jean Dupont");
    expect(JSON.parse(localStorage.getItem("user")!).tenantId).toBe("tenant-1");
  });

  it("refreshUser : ne casse rien si la session a expiré côté serveur (échec de /auth/me)", async () => {
    // Le nettoyage d'une session expirée (401) est le rôle de l'intercepteur
    // de réponse (api/client.ts), pas de refreshUser lui-même : un échec ici
    // ne doit ni planter ni écraser un profil déjà affiché — utile aussi pour
    // une simple panne réseau transitoire, où le compte reste par ailleurs
    // valide.
    localStorage.setItem("user", JSON.stringify({ id: "u1", email: "ancien@test.local", role: "MANAGER" }));
    localStorage.setItem("hasSession", "1");
    mockedApi.get.mockRejectedValueOnce(new Error("401"));

    renderAuth();

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("user-email").textContent).toBe("ancien@test.local");
  });
});

describe("AuthProvider — la devise du profil survit au rafraîchissement", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    localStorage.clear();
  });

  /**
   * `refreshUser` reconstruisait l'objet utilisateur champ par champ et
   * OUBLIAIT `currency`, alors que /auth/me le renvoie. `AuthUser.currency`
   * étant optionnel, TypeScript ne disait rien.
   *
   * Conséquence : au premier rafraîchissement, la devise disparaissait de
   * l'objet ET du stockage local réécrit dans la foulée. La synchronisation
   * profil -> affichage de CurrencyContext (`if (user?.currency && ...)`)
   * devenait définitivement morte, et plus rien ne pouvait rétablir le choix
   * depuis le serveur : sur un autre appareil ou après un vidage de cache, le
   * gestionnaire retombait sur l'euro sans recours.
   */
  it("conserve la devise renvoyée par le serveur", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "u1", email: "alice@test.local", role: "MANAGER" }));
    localStorage.setItem("hasSession", "1");
    mockedApi.get.mockResolvedValue({
      data: {
        id: "u1",
        email: "alice@test.local",
        role: "MANAGER",
        currency: "GNF",
        hasPassword: true,
        subscription: null,
      },
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("user-email").textContent).toBe("alice@test.local"));
    expect(screen.getByTestId("devise").textContent).toBe("GNF");
    expect(JSON.parse(localStorage.getItem("user")!).currency).toBe("GNF");
  });
});
