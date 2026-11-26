import { describe, expect, it } from "vitest";
import { filtrerAudit, filtrerSuggestions, type EntreeAudit } from "./syntheseAdmin";

const NOW = new Date(2026, 10, 15, 10, 0, 0);
describe("journal d'audit", () => {
  const entree = (o: Partial<EntreeAudit>): EntreeAudit => ({ id: "e", adminEmail: "root@immo.com", action: "manager.suspend", targetLabel: "Agence du Port", details: "Impayé", createdAt: "2026-11-15T07:00:00.000Z", ...o });
  const libelle = (a: string) => (a === "manager.suspend" ? "Compte suspendu" : a);

  it("cherche dans l'admin, l'action traduite, la cible et le détail", () => {
    const liste = [entree({ id: "a" }), entree({ id: "b", action: "listing.hide", targetLabel: "Villa", details: null, adminEmail: "autre@immo.com" })];
    expect(filtrerAudit(liste, "suspendu", "all", libelle, NOW).map((e) => e.id)).toEqual(["a"]);
    expect(filtrerAudit(liste, "port impaye", "all", libelle, NOW).map((e) => e.id)).toEqual(["a"]);
    expect(filtrerAudit(liste, "AUTRE@", "all", libelle, NOW).map((e) => e.id)).toEqual(["b"]);
  });

  it("filtre par période", () => {
    const liste = [entree({ id: "a" }), entree({ id: "b", createdAt: "2026-11-01T07:00:00.000Z" })];
    expect(filtrerAudit(liste, "", "today", libelle, NOW).map((e) => e.id)).toEqual(["a"]);
    expect(filtrerAudit(liste, "", "month", libelle, NOW)).toHaveLength(2);
  });
});

describe("suggestions", () => {
  it("cherche dans l'auteur, la page, le message et la note interne", () => {
    const liste = [
      { id: "1", authorLabel: "awa@x.sn", page: "/factures", message: "Filtrer par bien", adminNote: null },
      { id: "2", authorLabel: "moussa@x.sn", page: "/biens", message: "Export", adminNote: "déjà prévu" },
    ];
    expect(filtrerSuggestions(liste, "factures").map((s) => s.id)).toEqual(["1"]);
    expect(filtrerSuggestions(liste, "DEJA prevu").map((s) => s.id)).toEqual(["2"]);
    expect(filtrerSuggestions(liste, "")).toHaveLength(2);
  });
});
