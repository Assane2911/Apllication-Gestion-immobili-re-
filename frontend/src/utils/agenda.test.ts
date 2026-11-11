import { describe, expect, it } from "vitest";
import type { EvenementAgenda } from "../types";
import { comptesParType, grouperAgenda } from "./agenda";

const evt = (id: string, type: EvenementAgenda["type"], date: string, extra: Partial<EvenementAgenda> = {}): EvenementAgenda => ({
  id, type, date, enRetard: false, propertyId: "p", propertyTitle: "Villa Baobab", contractId: null, tenantName: null, amount: null, currency: null, label: null, ...extra,
});

const liste = [
  evt("a", "LEASE_END", "2026-07-31T00:00:00.000Z", { tenantName: "Awa Sow" }),
  evt("b", "RENT_DUE", "2026-06-20T00:00:00.000Z", { tenantName: "Moussa Ba" }),
  evt("c", "RENT_DUE", "2026-05-05T00:00:00.000Z", { enRetard: true, propertyTitle: "Studio Plateau" }),
  evt("d", "INSURANCE_EXPIRY", "2026-06-20T00:00:00.000Z", { label: "AXA" }),
  evt("e", "RENT_DUE", "2026-04-05T00:00:00.000Z", { enRetard: true }),
];

describe("grouperAgenda", () => {
  it("met le retard en tête, du plus ancien au plus récent, puis groupe par mois et par jour", () => {
    const g = grouperAgenda(liste, "all", "");
    expect(g.enRetard.map((e) => e.id)).toEqual(["e", "c"]);
    expect(g.parMois.map((m) => m.mois)).toEqual(["2026-06", "2026-07"]);
    expect(g.parMois[0].jours).toHaveLength(1);
    expect(g.parMois[0].jours[0].jour).toBe("2026-06-20");
    expect(g.parMois[0].jours[0].evenements.map((e) => e.id)).toEqual(["b", "d"]);
    expect(g.total).toBe(5);
  });

  it("filtre par type et par recherche (bien, locataire, libellé)", () => {
    expect(grouperAgenda(liste, "RENT_DUE", "").total).toBe(3);
    expect(grouperAgenda(liste, "all", "plateau").enRetard.map((e) => e.id)).toEqual(["c"]);
    expect(grouperAgenda(liste, "all", "awa").parMois[0].jours[0].evenements[0].id).toBe("a");
    expect(grouperAgenda(liste, "all", "axa").total).toBe(1);
    expect(grouperAgenda(liste, "all", "introuvable").total).toBe(0);
  });
});

describe("comptesParType", () => {
  it("compte chaque type sur ce que la recherche laisse", () => {
    expect(comptesParType(liste, "")).toEqual({ RENT_DUE: 3, LEASE_END: 1, EXIT: 0, RENT_REVISION: 0, INSURANCE_EXPIRY: 1 });
    expect(comptesParType(liste, "awa").LEASE_END).toBe(1);
  });
});
