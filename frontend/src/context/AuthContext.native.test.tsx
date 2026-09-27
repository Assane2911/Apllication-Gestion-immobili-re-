import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./auth";

// L'app mobile Capacitor n'a pas de cookie cross-site fiable (voir
// backend/src/utils/authCookie.ts) : elle continue de gérer le jeton
// elle-même, exactement comme avant cette migration vers le cookie httpOnly.
// Ce fichier isolé mock Capacitor.isNativePlatform() à `true` pour ce
// comportement précis, sans affecter les tests du chemin web par défaut
// (AuthContext.test.tsx).
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const mockedApi = vi.mocked(api, { deep: true });

function TestConsumer() {
  const { user, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="user-email">{user?.email ?? "aucun"}</span>
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

describe("AuthProvider — app native Capacitor", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    localStorage.clear();
  });

  it("démarre sans appel réseau quand localStorage est vide (pas de jeton à vérifier)", async () => {
    renderAuth();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it("login : stocke le jeton en localStorage, comme avant la migration vers le cookie httpOnly", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({
      data: { token: "jwt-abc", user: { id: "u1", email: "alice@test.local", role: "MANAGER" } },
    });
    renderAuth();

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() => expect(screen.getByTestId("user-email").textContent).toBe("alice@test.local"));
    expect(localStorage.getItem("token")).toBe("jwt-abc");
  });

  it("logout : efface le jeton du localStorage", async () => {
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
  });
});
