import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { INTERVALLE_FIL_MS, INTERVALLE_LISTE_MS, RENOUVELLEMENT_LIENS_MS, useActualisationFil, useRafraichissementPeriodique } from "./useActualisationFil";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const get = vi.mocked(api.get);

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  get.mockResolvedValue({ data: { messages: [] } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const attendre = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const options = (extra: Partial<Parameters<typeof useActualisationFil>[0]> = {}) => ({ adresse: "/messages/c1", dernierId: "m1", surReponse: vi.fn(), ...extra });

describe("useActualisationFil", () => {
  it("demande toutes les dix secondes les messages qui suivent le dernier affiché", async () => {
    const surReponse = vi.fn();
    renderHook(() => useActualisationFil(options({ surReponse })));
    await attendre(INTERVALLE_FIL_MS);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/messages/c1", { params: { apresId: "m1" } });
    expect(surReponse).toHaveBeenCalledWith({ messages: [], luesIds: undefined });
    await attendre(INTERVALLE_FIL_MS);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("transmet les paramètres du fil (locataire choisi) et le dernier message à jour sans relancer le minuteur", async () => {
    let dernierId = "m1";
    const { rerender } = renderHook(() => useActualisationFil(options({ params: { tenantId: "t2" }, dernierId })));
    await attendre(INTERVALLE_FIL_MS - 1000);
    dernierId = "m7";
    rerender();
    await attendre(1000);
    expect(get).toHaveBeenCalledTimes(1); // le minuteur n'a pas été remis à zéro par le changement
    expect(get).toHaveBeenCalledWith("/messages/c1", { params: { tenantId: "t2", apresId: "m7" } });
  });

  it("rapporte les nouveautés, et prévient le gestionnaire pour rafraîchir sa liste", async () => {
    const surReponse = vi.fn();
    const surNouveau = vi.fn();
    get.mockResolvedValue({ data: { messages: [{ id: "m2" }], luesIds: ["m1"] } });
    renderHook(() => useActualisationFil(options({ surReponse, surNouveau })));
    await attendre(INTERVALLE_FIL_MS);
    expect(surReponse).toHaveBeenCalledWith({ messages: [{ id: "m2" }], luesIds: ["m1"] });
    expect(surNouveau).toHaveBeenCalledTimes(1);
  });

  it("ne demande rien sans fil ouvert, ou tant que le fil n'est pas entièrement chargé", async () => {
    renderHook(() => useActualisationFil(options({ adresse: null })));
    renderHook(() => useActualisationFil(options({ actif: false })));
    await attendre(INTERVALLE_FIL_MS * 3);
    expect(get).not.toHaveBeenCalled();
  });

  it("ne demande rien pendant que l'onglet est caché, puis actualise dès son retour", async () => {
    renderHook(() => useActualisationFil(options()));
    const etat = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await attendre(INTERVALLE_FIL_MS * 2);
    expect(get).not.toHaveBeenCalled();
    etat.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("n'a jamais deux requêtes en cours, et réessaie après un échec passager", async () => {
    let finir: (v: unknown) => void = () => {};
    get.mockReturnValueOnce(new Promise((r) => { finir = r; }) as never);
    renderHook(() => useActualisationFil(options()));
    await attendre(INTERVALLE_FIL_MS * 3);
    expect(get).toHaveBeenCalledTimes(1);
    get.mockRejectedValueOnce(new Error("réseau"));
    await act(async () => { finir({ data: { messages: [] } }); });
    await attendre(INTERVALLE_FIL_MS); // échec ignoré
    const surReponse = vi.fn();
    await attendre(INTERVALLE_FIL_MS);
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(surReponse).not.toHaveBeenCalled();
  });

  it("écarte la réponse d'un fil quitté entre-temps", async () => {
    let finir: (v: unknown) => void = () => {};
    get.mockReturnValueOnce(new Promise((r) => { finir = r; }) as never);
    const surReponse = vi.fn();
    const { rerender } = renderHook(({ adresse }) => useActualisationFil(options({ adresse, surReponse })), { initialProps: { adresse: "/messages/c1" } });
    await attendre(INTERVALLE_FIL_MS);
    rerender({ adresse: "/messages/c2" });
    await act(async () => { finir({ data: { messages: [{ id: "x" }] } }); });
    expect(surReponse).not.toHaveBeenCalled();
  });

  it("renouvelle les liens signés par une lecture complète du fil avant leur expiration", async () => {
    renderHook(() => useActualisationFil(options()));
    await attendre(RENOUVELLEMENT_LIENS_MS - INTERVALLE_FIL_MS);
    expect(get.mock.calls.every((c) => (c[1] as { params: { apresId?: string } }).params.apresId === "m1")).toBe(true);
    await attendre(INTERVALLE_FIL_MS); // l'échéance : lecture complète du fil, donc des liens neufs
    expect(get.mock.calls[get.mock.calls.length - 1][1]).toEqual({ params: {} });
    await attendre(INTERVALLE_FIL_MS);
    expect(get.mock.calls[get.mock.calls.length - 1][1]).toEqual({ params: { apresId: "m1" } });
  });

  it("libère le minuteur au démontage", async () => {
    const { unmount } = renderHook(() => useActualisationFil(options()));
    unmount();
    await attendre(INTERVALLE_FIL_MS * 3);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useRafraichissementPeriodique", () => {
  it("rappelle toutes les trente secondes tant qu'actif et visible", async () => {
    const rappel = vi.fn();
    const { rerender } = renderHook(({ actif }) => useRafraichissementPeriodique(rappel, actif), { initialProps: { actif: true } });
    await attendre(INTERVALLE_LISTE_MS * 2);
    expect(rappel).toHaveBeenCalledTimes(2);
    rerender({ actif: false });
    await attendre(INTERVALLE_LISTE_MS * 2);
    expect(rappel).toHaveBeenCalledTimes(2);
  });
});
