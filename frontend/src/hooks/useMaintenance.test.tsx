import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { definirEtat, reinitialiserEtat } from "../utils/maintenance";
import { INTERVALLE_MAINTENANCE_EN_COURS_MS, INTERVALLE_MAINTENANCE_MS, useMaintenance } from "./useMaintenance";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const get = vi.mocked(api.get);

const H = 3_600_000;
const fenetre = (debutMs: number, finMs: number) => ({ debut: new Date(Date.now() + debutMs).toISOString(), fin: new Date(Date.now() + finMs).toISOString(), message: null });

beforeEach(() => {
  vi.useFakeTimers();
  reinitialiserEtat();
  get.mockReset();
  get.mockResolvedValue({ data: { maintenance: null } });
});
afterEach(() => {
  vi.useRealTimers();
  reinitialiserEtat();
});
const attendre = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useMaintenance", () => {
  it("interroge l'état au chargement, puis chaque minute tant qu'il n'y a pas de maintenance", async () => {
    renderHook(() => useMaintenance());
    await attendre(0);
    expect(get).toHaveBeenCalledWith("/maintenance");
    expect(get).toHaveBeenCalledTimes(1);
    await attendre(INTERVALLE_MAINTENANCE_MS);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("annonce une maintenance à venir, sans la déclarer en cours", async () => {
    get.mockResolvedValue({ data: { maintenance: fenetre(2 * H, 3 * H) } });
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    expect(result.current.etat).not.toBeNull();
    expect(result.current.aAnnoncer).toBe(true);
    expect(result.current.enCours).toBe(false);
  });

  it("déclare la maintenance en cours dès que son début est passé, sans attendre le serveur", async () => {
    get.mockResolvedValue({ data: { maintenance: fenetre(60_000, H) } });
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    expect(result.current.enCours).toBe(false);
    await attendre(60_000); // le pas de l'horloge (30 s) la fait basculer
    expect(result.current.enCours).toBe(true);
    expect(result.current.aAnnoncer).toBe(false);
  });

  it("interroge plus souvent quand la maintenance est en cours : on veut le retour vite", async () => {
    get.mockResolvedValue({ data: { maintenance: fenetre(-H, H) } });
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    expect(result.current.enCours).toBe(true);
    get.mockClear();
    await attendre(INTERVALLE_MAINTENANCE_EN_COURS_MS * 2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("efface l'état quand le serveur dit que la maintenance n'existe plus (terminée par l'administrateur)", async () => {
    get.mockResolvedValue({ data: { maintenance: fenetre(-H, H) } });
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    expect(result.current.enCours).toBe(true);
    get.mockResolvedValue({ data: { maintenance: null } });
    await attendre(INTERVALLE_MAINTENANCE_EN_COURS_MS);
    expect(result.current.etat).toBeNull();
    expect(result.current.enCours).toBe(false);
  });

  it("garde l'état connu quand l'interrogation échoue : un réseau capricieux ne lève ni ne baisse l'écran", async () => {
    get.mockResolvedValue({ data: { maintenance: fenetre(-H, H) } });
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    get.mockRejectedValue(new Error("réseau"));
    await attendre(INTERVALLE_MAINTENANCE_EN_COURS_MS * 2);
    expect(result.current.enCours).toBe(true);
    // Et une réponse mal formée n'est pas une maintenance.
    get.mockResolvedValue({ data: { maintenance: { debut: "x" } } });
    await attendre(INTERVALLE_MAINTENANCE_EN_COURS_MS);
    expect(result.current.etat).toBeNull();
  });

  it("apprend la maintenance d'une réponse 503 reçue ailleurs (intercepteur) sans attendre l'interrogation", async () => {
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    expect(result.current.enCours).toBe(false);
    await act(async () => { definirEtat(fenetre(-1000, H)); });
    expect(result.current.enCours).toBe(true);
  });

  it("ne demande rien pendant que l'onglet est caché, puis revérifie à son retour", async () => {
    renderHook(() => useMaintenance());
    await attendre(0);
    get.mockClear();
    const visibilite = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await attendre(INTERVALLE_MAINTENANCE_MS * 2);
    expect(get).not.toHaveBeenCalled();
    visibilite.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("`verifier` interroge à la demande et indique la vérification en cours", async () => {
    const { result } = renderHook(() => useMaintenance());
    await attendre(0);
    let finir: (v: unknown) => void = () => {};
    get.mockReturnValueOnce(new Promise((r) => { finir = r; }) as never);
    act(() => { void result.current.verifier(); });
    expect(result.current.verification).toBe(true);
    await act(async () => { finir({ data: { maintenance: null } }); });
    expect(result.current.verification).toBe(false);
  });

  it("libère ses minuteurs au démontage", async () => {
    const { unmount } = renderHook(() => useMaintenance());
    await attendre(0);
    unmount();
    get.mockClear();
    await attendre(INTERVALLE_MAINTENANCE_MS * 3);
    expect(get).not.toHaveBeenCalled();
  });
});
