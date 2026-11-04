import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { whatsappUsage } from "../db/schema";
import { moisUtc } from "../services/whatsappUsage.service";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const original = { ...env.whatsapp };
afterEach(() => Object.assign(env.whatsapp, original));

const lire = async (managerId: string, jeton: string) => request(app).get(`/api/admin/managers/${managerId}/whatsapp-usage`).set(authHeader(jeton));

describe("Consommation WhatsApp d'une agence (GET /api/admin/managers/:id/whatsapp-usage)", () => {
  it("renvoie les six derniers mois, par type, avec le coût estimé", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const courant = moisUtc();
    await testDb.insert(whatsappUsage).values([
      { managerId: manager.id, month: courant, type: "avis_echeance", sent: 30, failed: 1 },
      { managerId: manager.id, month: courant, type: "relance_impaye", sent: 10, failed: 0 },
    ]);

    const res = await lire(manager.id, tokenFor(admin));

    expect(res.status).toBe(200);
    expect(res.body.mois).toHaveLength(6);
    expect(res.body.mois[0]).toMatchObject({ mois: courant, envoyes: 40, echecs: 1, parType: { avis_echeance: 30, echeance_proche: 0, relance_impaye: 10 } });
    expect(res.body.mois[0].coutEstimeUsd).toBeCloseTo(40 * env.whatsapp.coutMessageUtilityUsd, 6);
    expect(res.body.tarifUsd).toBe(env.whatsapp.coutMessageUtilityUsd);
    expect(res.body.mois.slice(1).every((m: { envoyes: number }) => m.envoyes === 0)).toBe(true);
  });

  it("dit si la formule de l'agence donne droit à WhatsApp et si le service est branché", async () => {
    const admin = await createAdmin();
    const starter = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    const pro = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    env.whatsapp.accessToken = "";
    env.whatsapp.phoneNumberId = "";

    expect((await lire(starter.id, tokenFor(admin))).body).toMatchObject({ inclus: false, configure: false });
    expect((await lire(pro.id, tokenFor(admin))).body).toMatchObject({ inclus: true, configure: false });

    env.whatsapp.accessToken = "un_token";
    env.whatsapp.phoneNumberId = "123";
    expect((await lire(pro.id, tokenFor(admin))).body.configure).toBe(true);
  });

  it("ne mélange pas les agences", async () => {
    const admin = await createAdmin();
    const a = await createManager();
    const b = await createManager();
    await testDb.insert(whatsappUsage).values({ managerId: b.id, month: moisUtc(), type: "avis_echeance", sent: 99, failed: 0 });
    expect((await lire(a.id, tokenFor(admin))).body.mois[0].envoyes).toBe(0);
  });

  it("réservé à l'administrateur : ni l'agence elle-même ni un autre gestionnaire ne voient ce coût", async () => {
    const manager = await createManager();
    const autre = await createManager();
    expect((await lire(manager.id, tokenFor(manager))).status).toBe(403);
    expect((await lire(manager.id, tokenFor(autre))).status).toBe(403);
    expect((await request(app).get(`/api/admin/managers/${manager.id}/whatsapp-usage`)).status).toBe(401);
  });

  it("répond 404 pour une agence inconnue ou pour un compte qui n'est pas un gestionnaire titulaire", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const collaborateur = await createManager({ teamOwnerId: manager.id });
    expect((await lire("inconnu", tokenFor(admin))).status).toBe(404);
    expect((await lire(collaborateur.id, tokenFor(admin))).status).toBe(404);
    expect((await lire(admin.id, tokenFor(admin))).status).toBe(404);
  });
});

describe("Vue d'ensemble WhatsApp de la plateforme (GET /api/admin/whatsapp-usage)", () => {
  const vue = (jeton: string, mois?: string) => request(app).get("/api/admin/whatsapp-usage").query(mois ? { mois } : {}).set(authHeader(jeton));

  it("renvoie le total des agences par mois et le détail du mois courant, avec le tarif", async () => {
    const admin = await createAdmin();
    const a = await createManager({ email: "a@test.local" });
    const b = await createManager({ email: "b@test.local" });
    const courant = moisUtc();
    await testDb.insert(whatsappUsage).values([
      { managerId: a.id, month: courant, type: "avis_echeance", sent: 30, failed: 0 },
      { managerId: b.id, month: courant, type: "relance_impaye", sent: 12, failed: 2 },
    ]);

    const res = await vue(tokenFor(admin));

    expect(res.status).toBe(200);
    expect(res.body.moisChoisi).toBe(courant);
    expect(res.body.mois).toHaveLength(6);
    expect(res.body.mois[0]).toMatchObject({ mois: courant, envoyes: 42, echecs: 2 });
    expect(res.body.agences.map((x: { nom: string; envoyes: number }) => [x.nom, x.envoyes])).toEqual([["a@test.local", 30], ["b@test.local", 12]]);
    expect(res.body.tarifUsd).toBe(env.whatsapp.coutMessageUtilityUsd);
    expect(typeof res.body.configure).toBe("boolean");
  });

  it("accepte l'un des six derniers mois, et refuse un mois mal formé, trop ancien ou à venir", async () => {
    const admin = await createAdmin();
    const jeton = tokenFor(admin);
    const precedent = (await vue(jeton)).body.mois[1].mois as string;
    expect((await vue(jeton, precedent)).body.moisChoisi).toBe(precedent);

    for (const mauvais of ["2020-01", "novembre", "2026-13", "2999-01", "2026-1"]) {
      const res = await vue(jeton, mauvais);
      expect(res.status, mauvais).toBe(400);
      expect(res.body.code).toBe("WHATSAPP_MONTH_INVALID");
    }
  });

  it("réservé à l'administrateur : le coût de la plateforme n'est pas celui d'une agence", async () => {
    const manager = await createManager();
    expect((await vue(tokenFor(manager))).status).toBe(403);
    expect((await request(app).get("/api/admin/whatsapp-usage")).status).toBe(401);
  });
});
