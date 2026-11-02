import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { adminAuditLogs, platformSettings } from "../db/schema";
import { fenetreEnCours, invaliderCacheMaintenance, lireMaintenance } from "../services/maintenance.service";
import { authHeader, createAdmin, createManager, createProperty, tokenFor, tokenLocataire, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const HEURE = 3_600_000;
const iso = (decalageMs: number) => new Date(Date.now() + decalageMs).toISOString();

/** Pose une fenêtre directement en base (sans passer par l'API) et vide le cache de l'instance. */
async function poserFenetre(debutMs: number, finMs: number, message: string | null = null) {
  const valeurs = { maintenanceStart: new Date(Date.now() + debutMs), maintenanceEnd: new Date(Date.now() + finMs), maintenanceMessage: message };
  await testDb.insert(platformSettings).values({ id: "platform", ...valeurs }).onConflictDoUpdate({ target: platformSettings.id, set: valeurs });
  invaliderCacheMaintenance();
}

beforeEach(() => invaliderCacheMaintenance());
afterEach(() => {
  invaliderCacheMaintenance();
  vi.restoreAllMocks();
});

describe("État public de la maintenance (GET /api/maintenance)", () => {
  it("répond sans jeton : aucune maintenance, une maintenance à venir, une maintenance en cours", async () => {
    expect((await request(app).get("/api/maintenance")).body).toEqual({ maintenance: null });

    await poserFenetre(2 * HEURE, 3 * HEURE, "Mise à niveau de la base");
    const avenir = await request(app).get("/api/maintenance");
    expect(avenir.status).toBe(200);
    expect(avenir.body.maintenance).toMatchObject({ message: "Mise à niveau de la base", enCours: false });

    await poserFenetre(-HEURE, HEURE);
    const encours = await request(app).get("/api/maintenance");
    expect(encours.body.maintenance).toMatchObject({ enCours: true, message: null });
    expect(new Date(encours.body.maintenance.fin).getTime()).toBeGreaterThan(Date.now());
  });

  it("une fenêtre terminée n'existe plus : elle se périme d'elle-même", async () => {
    await poserFenetre(-3 * HEURE, -HEURE, "terminée");
    expect((await request(app).get("/api/maintenance")).body).toEqual({ maintenance: null });
  });

  it("n'expose que les dates, le message et l'indicateur : rien d'autre des réglages de la plateforme", async () => {
    await testDb.insert(platformSettings).values({ id: "platform", iban: "FR7630006000011234567890189", bic: "BNPAFRPP" }).onConflictDoNothing();
    await poserFenetre(-HEURE, HEURE);
    const res = await request(app).get("/api/maintenance");
    expect(Object.keys(res.body.maintenance).sort()).toEqual(["debut", "enCours", "fin", "message"]);
    expect(res.text).not.toContain("FR7630006000011234567890189");
  });
});

describe("Blocage de l'API pendant la maintenance", () => {
  it("sans maintenance, rien ne change ; une maintenance à venir ou terminée ne bloque rien", async () => {
    const manager = await createManager();
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(200);
    await poserFenetre(HEURE, 2 * HEURE);
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(200);
    await poserFenetre(-3 * HEURE, -HEURE);
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(200);
  });

  it("pendant la fenêtre, répond 503 MAINTENANCE avec les dates, le message et Retry-After — à tous les rôles et aux visiteurs", async () => {
    await poserFenetre(-HEURE, HEURE, "Migration en cours");
    const manager = await createManager();
    const tenant = await createTenant(manager.id);

    const parGestionnaire = await request(app).get("/api/properties").set(authHeader(tokenFor(manager)));
    expect(parGestionnaire.status).toBe(503);
    expect(parGestionnaire.body.code).toBe("MAINTENANCE");
    expect(parGestionnaire.body.params).toMatchObject({ message: "Migration en cours" });
    expect(new Date(parGestionnaire.body.params.fin).getTime()).toBeGreaterThan(Date.now());
    expect(Number(parGestionnaire.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(parGestionnaire.headers["retry-after"])).toBeLessThanOrEqual(3600);

    expect((await request(app).get("/api/tenants/mine/export").set(authHeader(await tokenLocataire(tenant.id)))).status).toBe(503);
    expect((await request(app).get("/api/listings/public")).status).toBe(503);
    expect((await request(app).post("/api/auth/register").send({})).status).toBe(503);
    expect((await request(app).post("/api/properties").set(authHeader(tokenFor(manager))).send({})).status).toBe(503);
  });

  it("laisse passer ce qui doit rester joignable : sondes, état, paiements, tâches planifiées, session", async () => {
    await poserFenetre(-HEURE, HEURE);
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/health/ready")).body.status).toBe("ok");
    expect((await request(app).get("/api/maintenance")).status).toBe(200);
    // Ces routes répondent selon leur propre logique (400/401/403…) — l'important est qu'elles ne répondent pas « maintenance ».
    const passent = [
      request(app).post("/api/auth/login").send({}),
      request(app).post("/api/auth/logout"),
      request(app).get("/api/auth/me"),
      request(app).post("/api/auth/2fa/verify-login").send({}),
      request(app).post("/api/payments/paydunya/ipn").send({}),
      request(app).post("/api/payments/stripe/webhook").send({}),
      request(app).get("/api/cron/daily"),
      request(app).post("/api/csp-report").send({}),
    ];
    for (const requete of passent) {
      const res = await requete;
      expect(res.body?.code, `${res.status}`).not.toBe("MAINTENANCE");
    }
  });

  it("l'administrateur passe — par jeton ou par cookie — et peut donc mener et clore l'opération", async () => {
    await poserFenetre(-HEURE, HEURE);
    const admin = await createAdmin();
    expect((await request(app).get("/api/admin/dashboard/stats").set(authHeader(tokenFor(admin)))).status).toBe(200);
    const parCookie = await request(app).get("/api/admin/dashboard/stats").set("Cookie", `token=${tokenFor(admin)}`).set("x-requested-with", "XMLHttpRequest");
    expect(parCookie.status).toBe(200);
  });

  it("un jeton falsifié ou expiré, ou celui d'un autre rôle, ne donne aucun passe-droit", async () => {
    await poserFenetre(-HEURE, HEURE);
    const admin = await createAdmin();
    const falsifie = jwt.sign({ userId: admin.id, role: "ADMIN" }, "autre-secret");
    const expire = jwt.sign({ userId: admin.id, role: "ADMIN" }, process.env.JWT_SECRET!, { expiresIn: -10 });
    const manager = await createManager();
    for (const entete of [authHeader(falsifie), authHeader(expire), authHeader(tokenFor(manager))]) {
      const res = await request(app).get("/api/admin/dashboard/stats").set(entete);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("MAINTENANCE");
    }
  });

  it("le garde ne dépend pas de la chaîne de requête : ajouter des paramètres ne contourne rien", async () => {
    await poserFenetre(-HEURE, HEURE);
    const res = await request(app).get("/api/listings/public?x=/api/health");
    expect(res.status).toBe(503);
  });

  it("ne bloque rien si la base ne répond pas : une lecture impossible ne doit pas rendre l'application inaccessible", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "select").mockImplementation(() => {
      throw new Error("base injoignable");
    });
    expect(await lireMaintenance()).toBeNull();
  });

  it("le service garde sa lecture dix secondes, puis la relit", async () => {
    await poserFenetre(-HEURE, HEURE);
    const t0 = Date.now();
    expect(fenetreEnCours(await lireMaintenance(t0), t0)).toBe(true);
    await testDb.update(platformSettings).set({ maintenanceStart: null, maintenanceEnd: null }).where(eq(platformSettings.id, "platform"));
    expect(await lireMaintenance(t0 + 5_000)).not.toBeNull(); // encore en cache
    expect(await lireMaintenance(t0 + 11_000)).toBeNull(); // relue
  });
});

describe("Programmation par l'administrateur (PUT/DELETE /api/admin/maintenance)", () => {
  async function admin() {
    const a = await createAdmin();
    return { a, entete: authHeader(tokenFor(a)) };
  }

  it("programme une maintenance, l'annonce publiquement et la journalise", async () => {
    const { entete } = await admin();
    const res = await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(HEURE), fin: iso(2 * HEURE), message: "  Sauvegarde annuelle  " });
    expect(res.status).toBe(200);
    expect(res.body.maintenance).toMatchObject({ message: "Sauvegarde annuelle", enCours: false });
    expect((await request(app).get("/api/maintenance")).body.maintenance.message).toBe("Sauvegarde annuelle");
    const journal = await testDb.select().from(adminAuditLogs);
    expect(journal.map((j: { action: string }) => j.action)).toEqual(["platform.maintenance.schedule"]);
  });

  it("remplace la maintenance précédente plutôt que d'en empiler une seconde", async () => {
    const { entete } = await admin();
    await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(HEURE), fin: iso(2 * HEURE), message: "première" });
    await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(3 * HEURE), fin: iso(4 * HEURE) });
    const etat = (await request(app).get("/api/maintenance")).body.maintenance;
    expect(etat.message).toBeNull();
    expect(new Date(etat.debut).getTime()).toBeGreaterThan(Date.now() + 2 * HEURE);
  });

  it("refuse une fenêtre incohérente : fin avant début, fin passée, plus de 24 h, dates ou message invalides", async () => {
    const { entete } = await admin();
    const envoyer = (corps: object) => request(app).put("/api/admin/maintenance").set(entete).send(corps);
    expect((await envoyer({ debut: iso(2 * HEURE), fin: iso(HEURE) })).body.code).toBe("MAINTENANCE_WINDOW_INVALID");
    expect((await envoyer({ debut: iso(-3 * HEURE), fin: iso(-HEURE) })).body.code).toBe("MAINTENANCE_WINDOW_INVALID");
    expect((await envoyer({ debut: iso(0), fin: iso(25 * HEURE) })).body.code).toBe("MAINTENANCE_TOO_LONG");
    expect((await envoyer({ debut: "pas une date", fin: iso(HEURE) })).status).toBe(400);
    expect((await envoyer({ fin: iso(HEURE) })).status).toBe(400);
    expect((await envoyer({ debut: iso(0), fin: iso(HEURE), message: "x".repeat(501) })).status).toBe(400);
    expect((await request(app).get("/api/maintenance")).body).toEqual({ maintenance: null });
  });

  it("accepte une maintenance qui commence tout de suite, et le blocage s'applique aussitôt", async () => {
    const { entete } = await admin();
    const manager = await createManager();
    await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(-1000), fin: iso(HEURE) });
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(503);
  });

  it("« terminer maintenant » : la maintenance en cours disparaît, l'accès revient immédiatement, et c'est journalisé", async () => {
    const { entete } = await admin();
    const manager = await createManager();
    await createProperty(manager.id);
    await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(-1000), fin: iso(HEURE) });
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(503);

    // L'administrateur passe pendant la maintenance : c'est lui qui la clôt.
    const fin = await request(app).delete("/api/admin/maintenance").set(entete);
    expect(fin.status).toBe(200);
    expect(fin.body).toEqual({ maintenance: null });
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(200);
    const actions = (await testDb.select().from(adminAuditLogs)).map((j: { action: string }) => j.action);
    expect(actions).toContain("platform.maintenance.end");
  });

  it("annuler une maintenance à venir la retire et le journal le dit autrement que « terminée »", async () => {
    const { entete } = await admin();
    await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(HEURE), fin: iso(2 * HEURE) });
    await request(app).delete("/api/admin/maintenance").set(entete);
    expect((await request(app).get("/api/maintenance")).body).toEqual({ maintenance: null });
    expect((await testDb.select().from(adminAuditLogs)).map((j: { action: string }) => j.action)).toContain("platform.maintenance.cancel");
  });

  it("annuler quand il n'y a rien est sans effet et ne journalise rien", async () => {
    const { entete } = await admin();
    expect((await request(app).delete("/api/admin/maintenance").set(entete)).status).toBe(200);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("l'état côté administrateur est le même que l'état public", async () => {
    const { entete } = await admin();
    await request(app).put("/api/admin/maintenance").set(entete).send({ debut: iso(HEURE), fin: iso(2 * HEURE), message: "Bientôt" });
    expect((await request(app).get("/api/admin/maintenance").set(entete)).body).toEqual((await request(app).get("/api/maintenance")).body);
  });

  it("est réservée à l'administrateur : ni gestionnaire, ni locataire, ni visiteur ne peuvent programmer ou annuler", async () => {
    const manager = await createManager();
    const corps = { debut: iso(HEURE), fin: iso(2 * HEURE) };
    expect((await request(app).put("/api/admin/maintenance").set(authHeader(tokenFor(manager))).send(corps)).status).toBe(403);
    expect((await request(app).delete("/api/admin/maintenance").set(authHeader(tokenFor(manager)))).status).toBe(403);
    expect((await request(app).put("/api/admin/maintenance").send(corps)).status).toBe(401);
    expect((await request(app).get("/api/maintenance")).body).toEqual({ maintenance: null });
  });
});
