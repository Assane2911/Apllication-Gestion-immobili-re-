import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { ajouterSiAbsent, fusionnerFil } from "./fusionFil";

const msg = (id: string, extra: Partial<Message> = {}): Message => ({ id, senderId: "u", senderRole: "MANAGER", content: id, isRead: false, createdAt: "2026-06-15T10:00:00.000Z", ...extra });

describe("fusionnerFil", () => {
  it("ajoute les messages nouveaux en fin de fil, dans l'ordre reçu", () => {
    const resultat = fusionnerFil([msg("1")], [msg("2"), msg("3")]);
    expect(resultat.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("ne duplique jamais un message déjà affiché", () => {
    const existants = [msg("1"), msg("2")];
    expect(fusionnerFil(existants, [msg("2"), msg("3")]).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("rend la MÊME liste quand rien ne change (pas de redessin, pas de défilement)", () => {
    const existants = [msg("1", { isRead: true })];
    expect(fusionnerFil(existants, [])).toBe(existants);
    expect(fusionnerFil(existants, [], [])).toBe(existants);
    expect(fusionnerFil(existants, [msg("1", { isRead: true })])).toBe(existants);
    expect(fusionnerFil(existants, [], ["1"])).toBe(existants); // déjà lu
    expect(fusionnerFil(existants, [], ["inconnu"])).toBe(existants);
  });

  it("marque lus les messages que l'autre partie a lus, sans toucher aux autres", () => {
    const existants = [msg("1"), msg("2")];
    const resultat = fusionnerFil(existants, [], ["2"]);
    expect(resultat).not.toBe(existants);
    expect(resultat.map((m) => m.isRead)).toEqual([false, true]);
    expect(resultat[0]).toBe(existants[0]);
  });

  it("n'efface jamais un état « lu » : un message déjà lu reste lu", () => {
    expect(fusionnerFil([msg("1", { isRead: true })], [msg("1", { isRead: false })])[0].isRead).toBe(true);
  });

  it("renouvelle le lien d'un vocal quand l'actualisation en apporte un neuf, sinon garde l'actuel", () => {
    const existants = [msg("v", { audioUrl: "https://a/ancien" }), msg("w", { audioUrl: "https://a/garde" })];
    const resultat = fusionnerFil(existants, [msg("v", { audioUrl: "https://a/neuf" }), msg("w", { audioUrl: null })]);
    expect(resultat[0].audioUrl).toBe("https://a/neuf");
    expect(resultat[1].audioUrl).toBe("https://a/garde");
  });

  it("applique en une fois nouveautés, lectures et liens", () => {
    const resultat = fusionnerFil([msg("1")], [msg("2")], ["1"]);
    expect(resultat.map((m) => [m.id, m.isRead])).toEqual([["1", true], ["2", false]]);
  });
});

describe("ajouterSiAbsent", () => {
  it("ajoute un message envoyé, sauf si une actualisation l'a déjà rapporté", () => {
    const existants = [msg("1")];
    expect(ajouterSiAbsent(existants, msg("2")).map((m) => m.id)).toEqual(["1", "2"]);
    expect(ajouterSiAbsent(existants, msg("1"))).toBe(existants);
  });
});
