import { act, fireEvent, render, screen } from "@testing-library/react";
import { Capacitor } from "@capacitor/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthContext, type AuthContextValue } from "../context/auth";
import type { AuthUser } from "../types";
import { CLE_DERNIERE_ACTIVITE } from "../utils/inactivite";
import InactiviteSession from "./InactiviteSession";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) } }));

const mockedApi = vi.mocked(api, { deep: true });
const MINUTE = 60_000;

function Lieu() {
  const l = useLocation();
  return <p data-testid="lieu">{l.pathname + l.search}</p>;
}

function monter(role: AuthUser["role"] | null = "MANAGER") {
  const logout = vi.fn().mockResolvedValue(undefined);
  const valeur = { user: role ? ({ id: "u1", email: "a@b.c", role } as AuthUser) : null, logout } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={valeur}>
      <MemoryRouter initialEntries={["/biens"]}>
        <InactiviteSession />
        <Routes>
          <Route path="*" element={<Lieu />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
  return { logout };
}

const avancer = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
  localStorage.clear();
  mockedApi.post.mockReset();
  mockedApi.post.mockResolvedValue({ data: { renewed: true } } as never);
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
});
afterEach(() => vi.useRealTimers());

describe("InactiviteSession", () => {
  it("ne fait rien sans utilisateur connecté", async () => {
    const { logout } = monter(null);
    await avancer(60 * MINUTE);
    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ne fait rien dans l'app mobile (session longue)", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { logout } = monter("MANAGER");
    await avancer(60 * MINUTE);
    expect(logout).not.toHaveBeenCalled();
  });

  it("gestionnaire : avertit à 29 min d'inactivité, déconnecte à 30 min et revient à la connexion", async () => {
    const { logout } = monter("MANAGER");

    await avancer(28 * MINUTE);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await avancer(1 * MINUTE + 5_000);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    await avancer(1 * MINUTE);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("lieu")).toHaveTextContent("/login?inactif=1");
  });

  it("administrateur : avertit à 14 min, déconnecte à 15 min", async () => {
    const { logout } = monter("ADMIN");

    await avancer(14 * MINUTE + 5_000);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await avancer(1 * MINUTE);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("locataire et propriétaire : 30 min comme le gestionnaire", async () => {
    for (const role of ["TENANT", "OWNER"] as const) {
      localStorage.clear();
      vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
      const { logout } = monter(role);
      await avancer(29 * MINUTE);
      expect(logout).not.toHaveBeenCalled();
      await avancer(2 * MINUTE);
      expect(logout).toHaveBeenCalledTimes(1);
      document.body.innerHTML = "";
    }
  });

  it("un geste repousse l'échéance", async () => {
    const { logout } = monter("MANAGER");
    await avancer(20 * MINUTE);
    fireEvent.keyDown(window, { key: "a" });

    await avancer(20 * MINUTE); // 40 min depuis le début, 20 depuis le geste
    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("l'activité dans un autre onglet compte aussi", async () => {
    const { logout } = monter("MANAGER");
    await avancer(25 * MINUTE);
    localStorage.setItem(CLE_DERNIERE_ACTIVITE, String(Date.now()));

    await avancer(20 * MINUTE);
    expect(logout).not.toHaveBeenCalled();
  });

  it("prolonge la session côté serveur sur un geste, au plus une fois par minute", async () => {
    monter("MANAGER");
    await avancer(2 * MINUTE);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.mouseDown(window);
    await avancer(10_000);
    fireEvent.keyDown(window, { key: "b" });

    const appels = mockedApi.post.mock.calls.filter(([url]) => url === "/auth/session/refresh");
    expect(appels).toHaveLength(1);

    await avancer(2 * MINUTE);
    fireEvent.keyDown(window, { key: "c" });
    expect(mockedApi.post.mock.calls.filter(([url]) => url === "/auth/session/refresh")).toHaveLength(2);
  });

  it("« Rester connecté » ferme l'avertissement et prolonge la session", async () => {
    const { logout } = monter("MANAGER");
    await avancer(29 * MINUTE + 5_000);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rester connecté" }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/session/refresh");
    await avancer(20 * MINUTE);
    expect(logout).not.toHaveBeenCalled();
  });

  it("pendant l'avertissement, un simple mouvement ne prolonge pas la session", async () => {
    const { logout } = monter("MANAGER");
    await avancer(29 * MINUTE + 5_000);
    fireEvent.mouseDown(window);
    fireEvent.keyDown(window, { key: "x" });

    await avancer(1 * MINUTE);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("« Me déconnecter » déconnecte tout de suite", async () => {
    const { logout } = monter("MANAGER");
    await avancer(29 * MINUTE + 5_000);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Me déconnecter" }));
    });

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
