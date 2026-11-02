import { describe, expect, it } from "vitest";
import type { Invoice, IssueReport } from "../types";
import { anneesDesLoyers, ancienneteSignalement, filtrerLoyers, filtrerSignalements, situationLoyers, situationSignalements } from "./syntheseLocataire";

const NOW = new Date(2026, 10, 15, 10, 0, 0); // 15 novembre 2026, heure locale

function facture(o: Partial<Invoice> = {}): Invoice {
  return { id: "f", contractId: "c", periodMonth: 11, periodYear: 2026, amount: 500, currency: "EUR", dueDate: "2026-11-05T00:00:00.000Z", status: "PENDING", ...o } as Invoice;
}
function signalement(o: Partial<IssueReport> = {}): IssueReport {
  return { id: "i", contractId: "c", tenantId: "t", title: "x", description: "y", status: "OPEN", createdAt: "2026-11-10T08:00:00.000Z", ...o } as IssueReport;
}

describe("situationLoyers", () => {
  it("totalise le reste dû, les retards et désigne l'échéance la plus ancienne", () => {
    const s = situationLoyers(
      [
        facture({ id: "a", status: "LATE", dueDate: "2026-10-05T00:00:00.000Z", periodMonth: 10, resteDu: 300 }),
        facture({ id: "b", dueDate: "2026-11-05T00:00:00.000Z" }),
        facture({ id: "c", dueDate: "2026-12-05T00:00:00.000Z", periodMonth: 12 }),
        facture({ id: "d", status: "PAID", periodMonth: 9, paidAt: "2026-09-04T00:00:00.000Z" }),
        facture({ id: "e", status: "CANCELLED" }),
      ],
      NOW
    );
    expect(s.aRegler).toBe(3);
    expect(s.resteDu).toEqual([{ devise: "EUR", montant: 1300 }]);
    expect(s.enRetard).toBe(2);
    expect(s.retardMax).toBe(41);
    expect(s.prochaine).toEqual({ id: "a", dueDate: "2026-10-05T00:00:00.000Z", jours: -41 });
    expect(s.regleCetteAnnee).toEqual([{ devise: "EUR", montant: 500 }]);
  });

  it("ne mélange pas les devises et ne compte que l'année en cours", () => {
    const s = situationLoyers(
      [
        facture({ id: "a", currency: "EUR", status: "PAID", paidAt: "2026-02-03T00:00:00.000Z" }),
        facture({ id: "b", currency: "XOF", amount: 150000, status: "PAID", paidAt: "2026-03-03T00:00:00.000Z" }),
        facture({ id: "c", currency: "EUR", status: "PAID", paidAt: "2025-03-03T00:00:00.000Z", periodYear: 2025 }),
      ],
      NOW
    );
    expect(s.regleCetteAnnee).toEqual([{ devise: "EUR", montant: 500 }, { devise: "XOF", montant: 150000 }]);
    expect(s.aRegler).toBe(0);
    expect(s.prochaine).toBeNull();
    expect(s.resteDu).toEqual([]);
  });
});

describe("filtrerLoyers / anneesDesLoyers", () => {
  const liste = [
    facture({ id: "a", periodYear: 2026 }),
    facture({ id: "b", periodYear: 2026, status: "PAID" }),
    facture({ id: "c", periodYear: 2025, status: "PAID" }),
    facture({ id: "d", periodYear: 2025, status: "CANCELLED" }),
  ];
  it("filtre par état et par année", () => {
    expect(filtrerLoyers(liste, "all", "all")).toHaveLength(4);
    expect(filtrerLoyers(liste, "due", "all").map((f) => f.id)).toEqual(["a"]);
    expect(filtrerLoyers(liste, "paid", "all").map((f) => f.id)).toEqual(["b", "c"]);
    expect(filtrerLoyers(liste, "paid", 2025).map((f) => f.id)).toEqual(["c"]);
    expect(filtrerLoyers(liste, "all", 2025).map((f) => f.id)).toEqual(["c", "d"]);
  });
  it("liste les années, la plus récente d'abord", () => {
    expect(anneesDesLoyers(liste)).toEqual([2026, 2025]);
  });
});

describe("signalements", () => {
  const liste = [
    signalement({ id: "a", status: "OPEN", createdAt: "2026-11-01T08:00:00.000Z" }),
    signalement({ id: "b", status: "IN_PROGRESS", scheduledAt: "2026-11-20T09:00:00.000Z" }),
    signalement({ id: "c", status: "IN_PROGRESS", scheduledAt: "2026-11-02T09:00:00.000Z" }),
    signalement({ id: "d", status: "RESOLVED" }),
    signalement({ id: "e", status: "REJECTED" }),
  ];
  it("résume ce qui est en cours, traité, planifié et l'ancienneté maximale", () => {
    expect(situationSignalements(liste, NOW)).toEqual({ enCours: 3, traites: 2, planifies: 1, plusAncien: 14 });
    expect(situationSignalements([], NOW)).toEqual({ enCours: 0, traites: 0, planifies: 0, plusAncien: 0 });
  });
  it("filtre en cours / traités", () => {
    expect(filtrerSignalements(liste, "active").map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(filtrerSignalements(liste, "done").map((i) => i.id)).toEqual(["d", "e"]);
    expect(filtrerSignalements(liste, "all")).toHaveLength(5);
  });
  it("donne l'ancienneté en jours", () => {
    expect(ancienneteSignalement({ createdAt: "2026-11-10T08:00:00.000Z" }, NOW)).toBe(5);
  });
});
