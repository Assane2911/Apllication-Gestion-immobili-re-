import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERVALLE_VERIFICATION_MS } from "../hooks/useNouvelleVersion";
import * as versionPubliee from "../utils/versionPubliee";
import BandeauNouvelleVersion from "./BandeauNouvelleVersion";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function afficher(publiee: string) {
  vi.spyOn(versionPubliee, "lireVersionPubliee").mockResolvedValue(publiee);
  render(<BandeauNouvelleVersion courante="v1" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALLE_VERIFICATION_MS); });
}

describe("BandeauNouvelleVersion", () => {
  it("n'affiche rien tant que la version n'a pas changé", async () => {
    await afficher("v1");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("annonce la nouvelle version, sans jamais recharger tout seul", async () => {
    const recharger = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: recharger });
    await afficher("v2");
    const bandeau = screen.getByRole("status");
    expect(bandeau).toHaveTextContent("Une nouvelle version de l'application est disponible.");
    expect(bandeau).toHaveTextContent("les saisies non enregistrées seront perdues");
    expect(recharger).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("« Actualiser » recharge la page", async () => {
    const recharger = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: recharger });
    await afficher("v2");
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Actualiser" }));
    expect(recharger).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("« Plus tard » masque le bandeau", async () => {
    await afficher("v2");
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Plus tard" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
