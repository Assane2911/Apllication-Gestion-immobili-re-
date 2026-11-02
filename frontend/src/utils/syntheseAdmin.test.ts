import { describe, expect, it } from "vitest";
import { csvVirements, filtrerAudit, filtrerSuggestions, filtrerVirements, joursAttente, type EntreeAudit, type VirementAttente } from "./syntheseAdmin";

const NOW = new Date(2026, 10, 15, 10, 0, 0);
const virement = (o: Partial<VirementAttente> = {}): VirementAttente => ({
  id: "v", managerEmail: "awa@agence.sn", plan: "PRO", amount: 49, currency: "EUR", billingCycle: "MONTHLY", paymentRef: "VIR-2026-001", startDate: "2026-11-01T00:00:00.000Z", endDate: "2026-12-01T00:00:00.000Z", createdAt: "2026-11-14T08:00:00.000Z", ...o,
});

describe("virements en attente", () => {
  it("compte les jours d'attente, jamais négatifs", () => {
    expect(joursAttente({ createdAt: "2026-11-10T08:00:00.000Z" }, NOW)).toBe(5);
    expect(joursAttente({ createdAt: "2026-11-20T08:00:00.000Z" }, NOW)).toBe(0);
  });

  it("cherche par e-mail ou référence et isole ceux qui attendent depuis trois jours ou plus", () => {
    const liste = [virement({ id: "a" }), virement({ id: "b", managerEmail: "moussa@x.sn", paymentRef: "ABC-9", createdAt: "2026-11-05T08:00:00.000Z" })];
    expect(filtrerVirements(liste, "", "all", NOW)).toHaveLength(2);
    expect(filtrerVirements(liste, "MOUSSA", "all", NOW).map((v) => v.id)).toEqual(["b"]);
    expect(filtrerVirements(liste, "vir-2026", "all", NOW).map((v) => v.id)).toEqual(["a"]);
    expect(filtrerVirements(liste, "", "late", NOW).map((v) => v.id)).toEqual(["b"]);
  });

  it("exporte en CSV, montant à virgule, formule neutralisée", () => {
    const csv = csvVirements([virement({ paymentRef: "=HYPERLINK" })], { manager: "Gestionnaire", plan: "Formule", cycle: "Cycle", amount: "Montant", currency: "Devise", reference: "Référence", since: "Depuis", waiting: "Jours" }, () => "14/11/2026", NOW);
    const lignes = csv.replace("﻿", "").split("\n");
    expect(lignes[0]).toBe('"Gestionnaire";"Formule";"Cycle";"Montant";"Devise";"Référence";"Depuis";"Jours"');
    expect(lignes[1]).toBe('"awa@agence.sn";"PRO";"MONTHLY";"49,00";"EUR";"\'=HYPERLINK";"14/11/2026";"1"');
  });
});

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
