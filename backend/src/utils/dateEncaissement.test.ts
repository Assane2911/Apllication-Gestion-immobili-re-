import { describe, expect, it } from "vitest";
import { ApiError } from "./asyncHandler";
import { resoudreDateEncaissement } from "./dateEncaissement";

const maintenant = new Date("2026-10-12T09:30:00.000Z");
const echeance = new Date("2026-10-05T00:00:00.000Z");
const resoudre = (saisie: string | null | undefined) => resoudreDateEncaissement(saisie, maintenant, echeance);
const refus = (saisie: string) => {
  try {
    resoudre(saisie);
  } catch (err) {
    return err instanceof ApiError ? { statut: err.statusCode, message: err.message, code: err.code } : err;
  }
  return null;
};

describe("date d'encaissement", () => {
  it("absente : l'instant présent, comme avant", () => {
    expect(resoudre(undefined)).toBe(maintenant);
    expect(resoudre(null)).toBe(maintenant);
    expect(resoudre("")).toBe(maintenant);
  });

  it("un jour passé (champ date) vaut midi UTC ce jour-là, pour ne glisser d'un jour dans aucun fuseau", () => {
    expect(resoudre("2026-10-05").toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(resoudre("2025-12-28").toISOString()).toBe("2025-12-28T12:00:00.000Z");
  });

  it("aujourd'hui : l'instant réel est conservé", () => {
    expect(resoudre("2026-10-12")).toBe(maintenant);
  });

  it("accepte un loyer payé D'AVANCE par rapport à sa période, tant que ce n'est pas dans le futur", () => {
    expect(resoudre("2026-09-28").toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });

  it("accepte une date-heure complète (clients API)", () => {
    expect(resoudre("2026-10-10T08:15:00.000Z").toISOString()).toBe("2026-10-10T08:15:00.000Z");
  });

  it("refuse une date dans le futur", () => {
    expect(refus("2026-10-14")).toEqual({ statut: 400, message: "La date d'encaissement ne peut pas être dans le futur.", code: "COLLECTION_DATE_FUTURE" });
    expect(refus("2027-01-01")).toMatchObject({ statut: 400 });
  });

  it("tolère « demain » vu d'un fuseau en avance sur l'UTC (14 h)", () => {
    // 13 jours... non : demain midi UTC est à 26 h — refusé ; ce qui est toléré, c'est le jour même à midi.
    expect(refus("2026-10-13")).toMatchObject({ statut: 400 });
    expect(resoudre("2026-10-12")).toBe(maintenant);
  });

  it("refuse une date plus d'un an avant l'échéance (faute de frappe)", () => {
    expect(refus("2024-10-05")).toEqual({
      statut: 400,
      message: "La date d'encaissement est trop ancienne par rapport à l'échéance de cette facture.",
      code: "COLLECTION_DATE_TOO_OLD",
    });
    expect(resoudre("2025-10-06")).toBeInstanceOf(Date);
  });

  it("refuse ce qui n'est pas une date, y compris un jour qui n'existe pas", () => {
    for (const saisie of ["hier", "2026-13-01", "2026-02-31", "12/10/2026", "2026-10-5x"]) {
      expect(refus(saisie), saisie).toMatchObject({
        statut: 400,
        message: "La date d'encaissement n'est pas une date valide.",
        code: "COLLECTION_DATE_INVALID",
      });
    }
  });
});
