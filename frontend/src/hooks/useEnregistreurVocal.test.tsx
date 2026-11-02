import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installerFauxMicro, type FauxMicro } from "../test/fauxMicro";
import { DUREE_MAX_MESSAGE_VOCAL_SEC } from "../utils/messageVocal";
import { useEnregistreurVocal } from "./useEnregistreurVocal";

let micro: FauxMicro;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2026, 10, 2, 10, 0, 0));
});
afterEach(() => {
  micro?.restaurer();
  vi.useRealTimers();
});

describe("useEnregistreurVocal", () => {
  it("enregistre, compte les secondes, puis garde l'enregistrement à réécouter", async () => {
    micro = installerFauxMicro();
    const { result } = renderHook(() => useEnregistreurVocal());
    expect(result.current.etat).toBe("repos");

    await act(async () => {
      await result.current.demarrer();
    });
    expect(result.current.etat).toBe("enregistrement");
    expect(micro.enregistreurs[0].mimeType).toBe("audio/webm;codecs=opus");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.secondes).toBe(5);

    act(() => result.current.terminer());
    expect(result.current.etat).toBe("ecoute");
    expect(result.current.enregistrement).toMatchObject({ duree: 5, type: "audio/webm", url: "blob:apercu-vocal" });
    expect(result.current.enregistrement?.blob.size).toBe(4);
    expect(micro.pistes[0].stop).toHaveBeenCalled();
  });

  it("annule : micro relâché, rien n'est gardé", async () => {
    micro = installerFauxMicro();
    const { result } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => result.current.annuler());
    expect(result.current.etat).toBe("repos");
    expect(result.current.enregistrement).toBeNull();
    expect(micro.pistes[0].stop).toHaveBeenCalled();
  });

  it("écarte un enregistrement de moins d'une seconde", async () => {
    micro = installerFauxMicro();
    const { result } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    act(() => result.current.terminer());
    expect(result.current.etat).toBe("repos");
    expect(result.current.erreur).toBe("tooShort");
    expect(result.current.enregistrement).toBeNull();
  });

  it("s'arrête seul à la durée maximale", async () => {
    micro = installerFauxMicro();
    const { result } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    act(() => {
      vi.advanceTimersByTime((DUREE_MAX_MESSAGE_VOCAL_SEC + 1) * 1000);
    });
    expect(result.current.etat).toBe("ecoute");
    expect(result.current.enregistrement?.duree).toBe(DUREE_MAX_MESSAGE_VOCAL_SEC);
  });

  it("explique un micro refusé et reste au repos", async () => {
    micro = installerFauxMicro({ refuser: { name: "NotAllowedError" } });
    const { result } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    expect(result.current.etat).toBe("repos");
    expect(result.current.erreur).toBe("denied");
  });

  it("signale un navigateur sans enregistrement", async () => {
    const { result } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    expect(result.current.erreur).toBe("unsupported");
  });

  it("relâche le micro quand le composant disparaît en plein enregistrement", async () => {
    micro = installerFauxMicro();
    const { result, unmount } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    unmount();
    await waitFor(() => expect(micro.pistes[0].stop).toHaveBeenCalled());
  });

  it("repart de zéro après réinitialisation, avec une nouvelle adresse d'aperçu", async () => {
    micro = installerFauxMicro();
    const { result } = renderHook(() => useEnregistreurVocal());
    await act(async () => {
      await result.current.demarrer();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.terminer());
    expect(result.current.etat).toBe("ecoute");
    act(() => result.current.reinitialiser());
    expect(result.current.etat).toBe("repos");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:apercu-vocal");
    await act(async () => {
      await result.current.demarrer();
    });
    expect(result.current.etat).toBe("enregistrement");
  });
});
