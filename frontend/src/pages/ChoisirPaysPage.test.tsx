import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import type { AuthUser } from "../types";
import ChoisirPaysPage from "./ChoisirPaysPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function noop(): never {
  throw new Error("not implemented in this test");
}

function rendre(user: AuthUser, refreshUser = vi.fn(async () => ({ ...user, country: "SN" }) as AuthUser | null)) {
  const auth: AuthContextValue = {
    user,
    loading: false,
    login: noop,
    register: noop,
    loginWithGoogle: noop,
    verifyTwoFactor: noop,
    verifyEmail: noop,
    logout: async () => {},
    refreshUser,
  };
  render(
    <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/pays"]}>
          <Routes>
            <Route path="/pays" element={<ChoisirPaysPage />} />
            <Route path="/dashboard" element={<p>Espace gestionnaire</p>} />
          </Routes>
        </MemoryRouter>
    </AuthContext.Provider>
  );
  return { refreshUser };
}

const sansPays: AuthUser = { id: "m1", email: "m@test.local", role: "MANAGER", country: null };

/**
 * Le pays de l'agence fixe les règles de location qui lui sont appliquées et la devise de son compte. Un compte créé
 * par Google, ou d'avant ce champ, le choisit ici, une seule fois.
 */
describe("ChoisirPaysPage", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
  });

  it("explique le choix, propose la France et les huit pays de l'UEMOA, et prévient qu'il est définitif", () => {
    rendre(sansPays);

    expect(screen.getByRole("heading", { name: "Choisissez le pays de votre agence" })).toBeInTheDocument();
    const select = screen.getByLabelText("Pays de l'agence") as HTMLSelectElement;
    expect(Array.from(select.options).slice(1).map((o) => o.value).sort()).toEqual(["BF", "BJ", "CI", "FR", "GW", "ML", "NE", "SN", "TG"]);
    expect(screen.getByText(/ne pourra plus être modifié/)).toBeInTheDocument();
  });

  it("refuse de valider sans pays, sans appeler l'API", async () => {
    const user = userEvent.setup();
    rendre(sansPays);

    await user.click(screen.getByRole("button", { name: "Valider le pays" }));

    expect(await screen.findByText("Choisissez le pays de votre agence.")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("enregistre le pays choisi, recharge le profil, puis ouvre l'espace gestionnaire", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, country: "SN", currency: "XOF" } });
    const { refreshUser } = rendre(sansPays);

    await user.selectOptions(screen.getByLabelText("Pays de l'agence"), "SN");
    await user.click(screen.getByRole("button", { name: "Valider le pays" }));

    expect(await screen.findByText("Espace gestionnaire")).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/country", { country: "SN" });
    expect(refreshUser).toHaveBeenCalled();
  });

  it("affiche l'erreur du serveur, traduite, et reste sur la page", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403, data: { error: "Seul le propriétaire…", code: "OWNER_ONLY_COUNTRY" } },
    });
    rendre(sansPays);

    await user.selectOptions(screen.getByLabelText("Pays de l'agence"), "FR");
    await user.click(screen.getByRole("button", { name: "Valider le pays" }));

    expect(await screen.findByText(/Seul le propriétaire de l'agence, ou un collaborateur « tous droits »/)).toBeInTheDocument();
    expect(screen.queryByText("Espace gestionnaire")).not.toBeInTheDocument();
  });

  it("renvoie directement à l'espace gestionnaire un compte qui a déjà son pays", async () => {
    rendre({ ...sansPays, country: "FR" });

    await waitFor(() => expect(screen.getByText("Espace gestionnaire")).toBeInTheDocument());
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("permet de se déconnecter", () => {
    rendre(sansPays);

    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
  });
});
