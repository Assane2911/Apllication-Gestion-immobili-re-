import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthContext } from "../../context/auth";
import type { AuthContextValue } from "../../context/auth";
import type { AuthUser } from "../../types";
import AdminSettingsPage from "./AdminSettingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function noop(): never {
  throw new Error("not implemented in this test");
}

function authValue(user: AuthUser): AuthContextValue {
  return {
    user,
    loading: false,
    login: noop,
    register: noop,
    loginWithGoogle: noop,
    verifyTwoFactor: noop,
    verifyEmail: noop,
    logout: async () => {},
    refreshUser: async () => user,
  };
}

/** La page ne lit plus que l'état de la maintenance : la réponse est donnée par adresse. */
function maintenanceAbsente() {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/admin/maintenance") return { data: { maintenance: null } };
    throw new Error(`appel inattendu : ${url}`);
  });
}

function renderPage(twoFactorEnabled = false) {
  const admin: AuthUser = { id: "a1", email: "admin@test.local", role: "ADMIN", twoFactorEnabled };
  return render(
    <AuthContext.Provider value={authValue(admin)}>
      <AdminSettingsPage />
    </AuthContext.Provider>
  );
}

describe("AdminSettingsPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
    mockedApi.post.mockReset();
  });

  it("ne propose plus de coordonnées bancaires : plus aucun moyen de paiement n'en a besoin", async () => {
    maintenanceAbsente();
    renderPage(false);

    expect(await screen.findByRole("button", { name: "Activer la double authentification" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/IBAN/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/BIC/i)).not.toBeInTheDocument();
    expect(mockedApi.get).not.toHaveBeenCalledWith("/admin/settings");
  });

  // Le compte administrateur est le plus puissant de la plateforme : il doit pouvoir activer sa propre
  // double authentification, comme un gestionnaire (la page n'offrait aucun moyen de le faire).
  it("propose d'activer la double authentification et lance l'enrôlement", async () => {
    const user = userEvent.setup();
    maintenanceAbsente();
    mockedApi.post.mockResolvedValueOnce({ data: { secret: "ABCDEFGH", qrCodeDataUrl: "data:image/png;base64,AAAA" } });
    renderPage(false);

    await user.click(await screen.findByRole("button", { name: "Activer la double authentification" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/auth/2fa/setup"));
  });

  it("indique que la double authentification est activée et propose de la désactiver", async () => {
    maintenanceAbsente();
    renderPage(true);

    expect(await screen.findByText("Double authentification activée")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Désactiver" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activer la double authentification" })).not.toBeInTheDocument();
  });
});
