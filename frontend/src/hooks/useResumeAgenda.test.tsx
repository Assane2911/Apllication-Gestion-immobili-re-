import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { INTERVALLE_RESUME_AGENDA_MS, useResumeAgenda } from "./useResumeAgenda";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const get = vi.mocked(api.get);

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  get.mockResolvedValue({ data: { overdue: 3, overdueOther: 1, soon: 2 } });
});
afterEach(() => vi.useRealTimers());

const attendre = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useResumeAgenda", () => {
  it("compte au chargement, puis toutes les cinq minutes", async () => {
    const { result } = renderHook(() => useResumeAgenda());
    await attendre(0);
    expect(get).toHaveBeenCalledWith("/agenda/summary");
    expect(result.current).toEqual({ overdue: 3, overdueOther: 1, soon: 2 });

    get.mockResolvedValue({ data: { overdue: 0, overdueOther: 0, soon: 2 } });
    await attendre(INTERVALLE_RESUME_AGENDA_MS);
    expect(result.current.overdue).toBe(0);
  });

  it("garde le dernier chiffre connu quand le décompte échoue, et ignore une réponse inexploitable", async () => {
    const { result } = renderHook(() => useResumeAgenda());
    await attendre(0);

    get.mockRejectedValue(new Error("réseau"));
    await attendre(INTERVALLE_RESUME_AGENDA_MS);
    expect(result.current.overdue).toBe(3);

    get.mockResolvedValue({ data: { notifications: [] } });
    await attendre(INTERVALLE_RESUME_AGENDA_MS);
    expect(result.current.overdue).toBe(3);
  });

  it("ne sollicite rien tant qu'il est inactif", async () => {
    renderHook(() => useResumeAgenda(false));
    await attendre(INTERVALLE_RESUME_AGENDA_MS * 2);
    expect(get).not.toHaveBeenCalled();
  });
});
