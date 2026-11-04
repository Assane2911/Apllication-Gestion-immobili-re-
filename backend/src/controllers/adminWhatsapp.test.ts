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
