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
    // sans token en localStorage, il doit ressortir immédiatement, sans jamais
    // appeler l'API.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it("login : stocke le token et l'utilisateur, et met à jour le contexte", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "jwt-abc", user: { id: "u1", email: "alice@test.local", role: "MANAGER" } },
    });
    renderAuth();

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => expect(screen.getByTestId("user-email").textContent).toBe("alice@test.local"));
    expect(localStorage.getItem("token")).toBe("jwt-abc");
    expect(JSON.parse(localStorage.getItem("user")!).email).toBe("alice@test.local");
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
  });

  it("refreshUser : reconstruit tenantId/tenantName à partir de /auth/me quand un token existe", async () => {
    localStorage.setItem("token", "jwt-existant");
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

  it("refreshUser : ne casse rien si le token est invalide (échec de /auth/me)", async () => {
    localStorage.setItem("token", "jwt-invalide");
    mockedApi.get.mockRejectedValueOnce(new Error("401"));

    renderAuth();

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("user-email").textContent).toBe("aucun");
  });
});
