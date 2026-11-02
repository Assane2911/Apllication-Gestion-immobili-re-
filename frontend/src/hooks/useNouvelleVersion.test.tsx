import { Capacitor } from "@capacitor/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as versionPubliee from "../utils/versionPubliee";
import { INTERVALLE_VERIFICATION_MS, useNouvelleVersion } from "./useNouvelleVersion";

let lire: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  lire = vi.spyOn(versionPubliee, "lireVersionPubliee").mockResolvedValue("v1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const attendre = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useNouvelleVersion", () => {
  it("ne signale rien tant que la version publiée est celle de l'onglet", async () => {
    const { result } = renderHook(() => useNouvelleVersion("v1"));
    await attendre(INTERVALLE_VERIFICATION_MS * 3);
    expect(lire).toHaveBeenCalledTimes(3);
    expect(result.current.disponible).toBe(false);
  });

  it("signale la nouvelle version à la vérification suivante, puis cesse de vérifier", async () => {
    const { result } = renderHook(() => useNouvelleVersion("v1"));
    lire.mockResolvedValue("v2");
    await attendre(INTERVALLE_VERIFICATION_MS);
    expect(result.current.disponible).toBe(true);
    lire.mockClear();
    await attendre(INTERVALLE_VERIFICATION_MS * 3);
    expect(lire).not.toHaveBeenCalled();
  });

  it("ne vérifie pas pendant que l'onglet est caché, mais revérifie à son retour", async () => {
    const { result } = renderHook(() => useNouvelleVersion("v1"));
    lire.mockResolvedValue("v2");
    const etat = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await attendre(INTERVALLE_VERIFICATION_MS);
    expect(lire).not.toHaveBeenCalled();

    etat.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(lire).toHaveBeenCalledTimes(1);
    expect(result.current.disponible).toBe(true);
  });

  it("au retour sur l'onglet, ne revérifie pas si la dernière vérification est toute récente", async () => {
    renderHook(() => useNouvelleVersion("v1"));
    await attendre(10_000);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(lire).not.toHaveBeenCalled();
  });

  it("« plus tard » masque le bandeau", async () => {
    const { result } = renderHook(() => useNouvelleVersion("v1"));
    lire.mockResolvedValue("v2");
    await attendre(INTERVALLE_VERIFICATION_MS);
    expect(result.current.disponible).toBe(true);
    act(() => result.current.reporter());
    expect(result.current.disponible).toBe(false);
  });

  it("reste inerte en développement et dans l'application mobile", async () => {
    renderHook(() => useNouvelleVersion("dev"));
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const mobile = renderHook(() => useNouvelleVersion("v1"));
    lire.mockResolvedValue("v2");
    await attendre(INTERVALLE_VERIFICATION_MS * 2);
    expect(lire).not.toHaveBeenCalled();
    expect(mobile.result.current.disponible).toBe(false);
  });

  it("libère le minuteur au démontage", async () => {
    const { unmount } = renderHook(() => useNouvelleVersion("v1"));
    unmount();
    await attendre(INTERVALLE_VERIFICATION_MS * 2);
    expect(lire).not.toHaveBeenCalled();
  });
});
