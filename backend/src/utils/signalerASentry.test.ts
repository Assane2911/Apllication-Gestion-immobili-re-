import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/node";
import { signalerASentry } from "./signalerASentry";

afterEach(() => vi.restoreAllMocks());

describe("signalerASentry", () => {
  it("envoie le message avec son contexte, puis attend l'envoi (2 s au plus) avant de rendre la main", async () => {
    const ordre: string[] = [];
    const envoi = vi.spyOn(Sentry, "captureMessage").mockImplementation(() => {
      ordre.push("capture");
      return "id";
    });
    let fini = false;
    const attente = vi.spyOn(Sentry, "flush").mockImplementation(async () => {
      ordre.push("flush");
      await new Promise((r) => setTimeout(r, 20));
      fini = true;
      return true;
    });

    await signalerASentry("paiement à examiner", { level: "error", tags: { source: "test" }, extra: { montant: 9 } });

    expect(envoi).toHaveBeenCalledWith("paiement à examiner", { level: "error", tags: { source: "test" }, extra: { montant: 9 } });
    expect(attente).toHaveBeenCalledWith(2000);
    expect(ordre).toEqual(["capture", "flush"]);
    expect(fini).toBe(true); // la promesse ne se résout qu'une fois l'envoi terminé
  });

  it("un Sentry qui lève à l'envoi ne fait jamais échouer l'appelant, et rien n'est attendu", async () => {
    vi.spyOn(Sentry, "captureMessage").mockImplementation(() => {
      throw new Error("Sentry coupé");
    });
    const attente = vi.spyOn(Sentry, "flush").mockResolvedValue(true);

    await expect(signalerASentry("x", { level: "warning" })).resolves.toBeUndefined();
    expect(attente).not.toHaveBeenCalled();
  });

  it("une attente qui échoue est absorbée elle aussi", async () => {
    vi.spyOn(Sentry, "captureMessage").mockReturnValue("id");
    vi.spyOn(Sentry, "flush").mockRejectedValue(new Error("réseau"));

    await expect(signalerASentry("x", { level: "warning" })).resolves.toBeUndefined();
  });
});
