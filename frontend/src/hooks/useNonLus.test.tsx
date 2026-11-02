import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { signalerFilLu } from "../utils/nonLus";
import { INTERVALLE_NON_LUS_MS, useNonLus } from "./useNonLus";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const get = vi.mocked(api.get);

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  get.mockResolvedValue({ data: { count: 3 } });
});
afterEach(() => vi.useRealTimers());

const attendre = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useNonLus", () => {
  it("compte au chargement, puis toutes les trente secondes", async () => {
    const { result } = renderHook(() => useNonLus("/messages/unread-count"));
    await attendre(0);
    expect(get).toHaveBeenCalledWith("/messages/unread-count");
    expect(result.current.count).toBe(3);
    get.mockResolvedValue({ data: { count: 5 } });
    await attendre(INTERVALLE_NON_LUS_MS);
    expect(result.current.count).toBe(5);
  });

  it("garde la répartition locataires / propriétaires du gestionnaire", async () => {
    get.mockResolvedValue({ data: { count: 3, tenants: 1, owners: 2 } });
    const { result } = renderHook(() => useNonLus("/messages/unread-count"));
    await attendre(0);
    expect(result.current).toEqual({ count: 3, tenants: 1, owners: 2 });
  });

  it("recompte tout de suite quand un fil vient d'être lu", async () => {
    const { result } = renderHook(() => useNonLus("/messages/unread-count"));
    await attendre(0);
    get.mockResolvedValue({ data: { count: 0 } });
    await act(async () => { signalerFilLu(); });
    expect(result.current.count).toBe(0);
  });

  it("garde le dernier chiffre connu quand le décompte échoue, et ignore une réponse inexploitable", async () => {
    const { result } = renderHook(() => useNonLus("/messages/unread-count"));
    await attendre(0);
    get.mockRejectedValue(new Error("réseau"));
    await attendre(INTERVALLE_NON_LUS_MS);
    expect(result.current.count).toBe(3);
    get.mockResolvedValue({ data: { count: "n'importe quoi" } });
    await attendre(INTERVALLE_NON_LUS_MS);
    expect(result.current.count).toBe(3);
    get.mockResolvedValue(undefined as never);
    await attendre(INTERVALLE_NON_LUS_MS);
    expect(result.current.count).toBe(3);
  });

  it("ne redonne pas un nouvel objet quand le chiffre ne change pas (le menu ne se redessine pas)", async () => {
    const { result } = renderHook(() => useNonLus("/messages/unread-count"));
    await attendre(0);
    const avant = result.current;
    await attendre(INTERVALLE_NON_LUS_MS);
    expect(result.current).toBe(avant);
  });

  it("ne demande rien sans adresse, et cesse d'écouter au démontage", async () => {
    renderHook(() => useNonLus(null));
    const { unmount } = renderHook(() => useNonLus("/messages/unread-count"));
    await attendre(0);
    get.mockClear();
    unmount();
    await attendre(INTERVALLE_NON_LUS_MS * 2);
    await act(async () => { signalerFilLu(); });
    expect(get).not.toHaveBeenCalled();
  });
});
