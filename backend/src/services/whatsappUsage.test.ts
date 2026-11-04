import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { agencySettings, whatsappUsage } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { derniersMois, enregistrerEnvoiWhatsapp, lireUsagePlateformeWhatsapp, lireUsageWhatsapp, moisUtc } from "./whatsappUsage.service";

afterEach(() => vi.restoreAllMocks());

const lignes = (managerId: string) => testDb.select().from(whatsappUsage).where(eq(whatsappUsage.managerId, managerId));

describe("moisUtc", () => {
  it("donne le mois civil en UTC, à la frontière de minuit comprise", () => {
    expect(moisUtc(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(moisUtc(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(moisUtc(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01");
  });
});

describe("enregistrerEnvoiWhatsapp", () => {
  it("compte un envoi accepté, et les suivants s'additionnent sur la même ligne (agence, mois, type)", async () => {
    const manager = await createManager();
    const contexte = { managerId: manager.id, type: "avis_echeance" } as const;
    const maintenant = new Date("2026-10-12T09:00:00Z");

    await enregistrerEnvoiWhatsapp(contexte, { simulated: false }, maintenant);
    await enregistrerEnvoiWhatsapp(contexte, { simulated: false }, maintenant);
    await enregistrerEnvoiWhatsapp(contexte, { simulated: false }, maintenant);

    expect(await lignes(manager.id)).toMatchObject([{ month: "2026-10", type: "avis_echeance", sent: 3, failed: 0 }]);
  });

  it("garde une ligne par type et par mois", async () => {
    const manager = await createManager();
    await enregistrerEnvoiWhatsapp({ managerId: manager.id, type: "avis_echeance" }, { simulated: false }, new Date("2026-10-31T23:00:00Z"));
    await enregistrerEnvoiWhatsapp({ managerId: manager.id, type: "echeance_proche" }, { simulated: false }, new Date("2026-10-31T23:00:00Z"));
    await enregistrerEnvoiWhatsapp({ managerId: manager.id, type: "avis_echeance" }, { simulated: false }, new Date("2026-11-01T01:00:00Z"));

    const lues = (await lignes(manager.id)).map((l: typeof whatsappUsage.$inferSelect) => `${l.month} ${l.type} ${l.sent}`).sort();
    expect(lues).toEqual(["2026-10 avis_echeance 1", "2026-10 echeance_proche 1", "2026-11 avis_echeance 1"]);
  });

  it("compte un refus de l'API, une erreur réseau et un numéro invalide comme des échecs, pas comme des envois", async () => {
    const manager = await createManager();
    const contexte = { managerId: manager.id, type: "relance_impaye" } as const;
    const maintenant = new Date("2026-10-12T09:00:00Z");
    await enregistrerEnvoiWhatsapp(contexte, { simulated: false, error: true, raison: "erreur_api" }, maintenant);
    await enregistrerEnvoiWhatsapp(contexte, { simulated: false, error: true, raison: "erreur_reseau" }, maintenant);
    await enregistrerEnvoiWhatsapp(contexte, { simulated: true, error: true, raison: "numero_invalide" }, maintenant);

    expect(await lignes(manager.id)).toMatchObject([{ type: "relance_impaye", sent: 0, failed: 3 }]);
  });

  it("ne compte pas une simulation (service ou modèle non configuré) : rien n'est parti, rien n'est facturé", async () => {
    const manager = await createManager();
    await enregistrerEnvoiWhatsapp({ managerId: manager.id, type: "avis_echeance" }, { simulated: true, raison: "non_configure" });
    await enregistrerEnvoiWhatsapp({ managerId: manager.id, type: "avis_echeance" }, { simulated: true, raison: "modele_non_configure" });
    expect(await lignes(manager.id)).toEqual([]);
  });

  it("ne lève jamais : un compteur en panne (agence inconnue) ne doit pas faire échouer l'envoi", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(enregistrerEnvoiWhatsapp({ managerId: "agence-inconnue", type: "avis_echeance" }, { simulated: false })).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalled();
  });

  it("des envois simultanés ne se perdent pas : l'addition se fait dans la base", async () => {
    const manager = await createManager();
    const contexte = { managerId: manager.id, type: "avis_echeance" } as const;
    const maintenant = new Date("2026-10-12T09:00:00Z");
    await Promise.all(Array.from({ length: 10 }, () => enregistrerEnvoiWhatsapp(contexte, { simulated: false }, maintenant)));
    const [ligne] = await testDb
      .select()
      .from(whatsappUsage)
      .where(and(eq(whatsappUsage.managerId, manager.id), eq(whatsappUsage.month, "2026-10")));
    expect(ligne.sent).toBe(10);
  });
});

describe("lireUsageWhatsapp", () => {
  const maintenant = new Date("2026-11-04T10:00:00Z");

  it("renvoie les six derniers mois, du plus récent au plus ancien, y compris ceux sans envoi", async () => {
    const manager = await createManager();
    const usage = await lireUsageWhatsapp(manager.id, 6, maintenant);
    expect(usage.map((m) => m.mois)).toEqual(["2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(usage.every((m) => m.envoyes === 0 && m.echecs === 0 && m.coutEstimeUsd === 0)).toBe(true);
  });

  it("franchit le changement d'année", async () => {
    const manager = await createManager();
    const usage = await lireUsageWhatsapp(manager.id, 4, new Date("2027-02-10T00:00:00Z"));
    expect(usage.map((m) => m.mois)).toEqual(["2027-02", "2027-01", "2026-12", "2026-11"]);
  });

  it("additionne par type et par mois, compte les échecs à part et estime le coût sur les messages envoyés", async () => {
    const manager = await createManager();
    await testDb.insert(whatsappUsage).values([
      { managerId: manager.id, month: "2026-11", type: "avis_echeance", sent: 40, failed: 1 },
      { managerId: manager.id, month: "2026-11", type: "echeance_proche", sent: 40, failed: 0 },
      { managerId: manager.id, month: "2026-11", type: "relance_impaye", sent: 20, failed: 2 },
      { managerId: manager.id, month: "2026-10", type: "avis_echeance", sent: 10, failed: 0 },
    ]);

    const [courant, precedent] = await lireUsageWhatsapp(manager.id, 6, maintenant);

    expect(courant.parType).toEqual({ avis_echeance: 40, echeance_proche: 40, relance_impaye: 20 });
    expect(courant.envoyes).toBe(100);
    expect(courant.echecs).toBe(3);
    expect(courant.coutEstimeUsd).toBeCloseTo(100 * env.whatsapp.coutMessageUtilityUsd, 6);
    expect(precedent).toMatchObject({ mois: "2026-10", envoyes: 10, echecs: 0 });
  });

  it("ne mélange pas les agences et ignore ce qui est plus ancien que la fenêtre", async () => {
    const a = await createManager();
    const b = await createManager();
    await testDb.insert(whatsappUsage).values([
      { managerId: a.id, month: "2026-11", type: "avis_echeance", sent: 5, failed: 0 },
      { managerId: b.id, month: "2026-11", type: "avis_echeance", sent: 99, failed: 0 },
      { managerId: a.id, month: "2025-01", type: "avis_echeance", sent: 77, failed: 0 },
    ]);
    const usage = await lireUsageWhatsapp(a.id, 6, maintenant);
    expect(usage[0].envoyes).toBe(5);
    expect(usage.reduce((total, m) => total + m.envoyes, 0)).toBe(5);
  });

  it("le coût suit le tarif configuré", async () => {
    const tarif = env.whatsapp.coutMessageUtilityUsd;
    env.whatsapp.coutMessageUtilityUsd = 0.01;
    try {
      const manager = await createManager();
      await testDb.insert(whatsappUsage).values({ managerId: manager.id, month: "2026-11", type: "avis_echeance", sent: 50, failed: 0 });
      expect((await lireUsageWhatsapp(manager.id, 1, maintenant))[0].coutEstimeUsd).toBe(0.5);
    } finally {
      env.whatsapp.coutMessageUtilityUsd = tarif;
    }
  });
});

describe("derniersMois", () => {
  it("liste les mois du plus récent au plus ancien, en franchissant l'année", () => {
    expect(derniersMois(4, new Date("2027-02-10T00:00:00Z"))).toEqual(["2027-02", "2027-01", "2026-12", "2026-11"]);
  });
});

describe("lireUsagePlateformeWhatsapp", () => {
  const maintenant = new Date("2026-11-04T10:00:00Z");

  it("sans aucun envoi : six mois à zéro et aucune agence", async () => {
    const usage = await lireUsagePlateformeWhatsapp(undefined, 6, maintenant);
    expect(usage.moisChoisi).toBe("2026-11");
    expect(usage.agences).toEqual([]);
    expect(usage.mois.map((m) => m.mois)).toEqual(["2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(usage.mois.every((m) => m.envoyes === 0 && m.coutEstimeUsd === 0)).toBe(true);
  });

  it("additionne toutes les agences mois par mois, et détaille le mois choisi agence par agence, la plus gourmande d'abord", async () => {
    const a = await createManager({ email: "a@test.local" });
    const b = await createManager({ email: "b@test.local" });
    const c = await createManager({ email: "c@test.local" });
    await testDb.insert(agencySettings).values({ userId: a.id, agencyName: "Agence Teranga" });
    await testDb.insert(whatsappUsage).values([
      { managerId: a.id, month: "2026-11", type: "avis_echeance", sent: 30, failed: 1 },
      { managerId: a.id, month: "2026-11", type: "relance_impaye", sent: 10, failed: 0 },
      { managerId: b.id, month: "2026-11", type: "avis_echeance", sent: 100, failed: 4 },
      { managerId: c.id, month: "2026-10", type: "echeance_proche", sent: 7, failed: 0 },
      { managerId: a.id, month: "2025-01", type: "avis_echeance", sent: 999, failed: 0 },
    ]);

    const usage = await lireUsagePlateformeWhatsapp(undefined, 6, maintenant);

    expect(usage.mois[0]).toMatchObject({ mois: "2026-11", envoyes: 140, echecs: 5, parType: { avis_echeance: 130, echeance_proche: 0, relance_impaye: 10 } });
    expect(usage.mois[0].coutEstimeUsd).toBeCloseTo(140 * env.whatsapp.coutMessageUtilityUsd, 6);
    expect(usage.mois[1]).toMatchObject({ mois: "2026-10", envoyes: 7 });
    expect(usage.mois.reduce((total, m) => total + m.envoyes, 0)).toBe(147); // ce qui date de 2025 est hors fenêtre
    // Détail du mois courant : b (100) avant a (40), c n'a rien envoyé ce mois-ci ; le nom est celui de l'agence, à défaut l'e-mail.
    expect(usage.agences.map((x) => [x.nom, x.envoyes, x.echecs])).toEqual([
      ["b@test.local", 100, 4],
      ["Agence Teranga", 40, 1],
    ]);
    expect(usage.agences[1]).toMatchObject({ managerId: a.id, parType: { avis_echeance: 30, echeance_proche: 0, relance_impaye: 10 } });
  });

  it("détaille un autre mois quand on le demande, sans toucher aux totaux", async () => {
    const c = await createManager({ email: "c@test.local" });
    await testDb.insert(whatsappUsage).values([
      { managerId: c.id, month: "2026-10", type: "echeance_proche", sent: 7, failed: 0 },
      { managerId: c.id, month: "2026-11", type: "echeance_proche", sent: 3, failed: 0 },
    ]);
    const usage = await lireUsagePlateformeWhatsapp("2026-10", 6, maintenant);
    expect(usage.moisChoisi).toBe("2026-10");
    expect(usage.agences.map((x) => [x.nom, x.envoyes])).toEqual([["c@test.local", 7]]);
    expect(usage.mois[0].envoyes).toBe(3);
  });

  it("une agence qui n'a que des échecs apparaît (elle coûte du travail, pas de l'argent)", async () => {
    const a = await createManager({ email: "a@test.local" });
    await testDb.insert(whatsappUsage).values({ managerId: a.id, month: "2026-11", type: "avis_echeance", sent: 0, failed: 5 });
    const usage = await lireUsagePlateformeWhatsapp(undefined, 6, maintenant);
    expect(usage.agences).toMatchObject([{ envoyes: 0, echecs: 5, coutEstimeUsd: 0 }]);
  });
});
