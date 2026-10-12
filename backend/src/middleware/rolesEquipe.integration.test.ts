import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings, invoices, properties, users } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import type { RoleEquipe } from "../utils/rolesEquipe";

/**
 * Audit du compte gestionnaire, défaut n°1 : un collaborateur avait tous les
 * droits du propriétaire. Ces tests rejouent les quatre preuves de l'audit
 * (modifier l'IBAN, supprimer un bien, exporter les données d'un locataire,
 * marquer une facture payée) pour chaque rôle, via les vraies routes.
 */
async function agence() {
  const owner = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(owner.id);
  const tenant = await createTenant(owner.id);
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });
  const invoice = await createInvoice(contract.id, { status: "PENDING" });
  return { owner, property, tenant, contract, invoice };
}

async function collaborateur(ownerId: string, role: RoleEquipe | null) {
  const c = await createTeamMember(ownerId, { teamRole: role });
  return { c, token: tokenFor({ id: ownerId, role: "MANAGER" }, null, null, c.id) };
}

let ctx: Awaited<ReturnType<typeof agence>>;
beforeEach(async () => {
  ctx = await agence();
});

describe("les quatre preuves de l'audit, rejouées par rôle", () => {
  it.each(["READ_ONLY", "AGENT", "ACCOUNTANT"] as const)("%s ne peut pas modifier l'IBAN de l'agence", async (role) => {
    const { token } = await collaborateur(ctx.owner.id, role);
    const res = await request(app).put("/api/agency").set(authHeader(token)).send({ agencyName: "Piratée", bankIban: "FR7600000000000000000000000" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ROLE_EQUIPE_INSUFFISANT");
    expect(await testDb.select().from(agencySettings).where(eq(agencySettings.userId, ctx.owner.id))).toHaveLength(0);
  });

  it.each(["READ_ONLY", "AGENT", "ACCOUNTANT"] as const)("%s ne peut pas supprimer un bien", async (role) => {
    const { token } = await collaborateur(ctx.owner.id, role);
    const res = await request(app).delete(`/api/properties/${ctx.property.id}`).set(authHeader(token));
    expect(res.status).toBe(403);
    expect(await testDb.select().from(properties).where(eq(properties.id, ctx.property.id))).toHaveLength(1);
  });

  it.each(["READ_ONLY", "AGENT", "ACCOUNTANT"] as const)("%s ne peut pas exporter les données personnelles d'un locataire", async (role) => {
    const { token } = await collaborateur(ctx.owner.id, role);
    const res = await request(app).get(`/api/tenants/${ctx.tenant.id}/export`).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it.each(["READ_ONLY", "AGENT"] as const)("%s ne peut pas marquer une facture payée", async (role) => {
    const { token } = await collaborateur(ctx.owner.id, role);
    const res = await request(app).post(`/api/invoices/${ctx.invoice.id}/mark-paid`).set(authHeader(token)).send({});
    expect(res.status).toBe(403);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, ctx.invoice.id));
    expect(apres.status).toBe("PENDING");
  });
});

describe("ce que chaque rôle PEUT faire (le refus n'est pas devenu total)", () => {
  it("READ_ONLY consulte biens, locataires, factures", async () => {
    const { token } = await collaborateur(ctx.owner.id, "READ_ONLY");
    for (const url of ["/api/properties", "/api/tenants", "/api/invoices", "/api/contracts", "/api/dashboard/stats"]) {
      const res = await request(app).get(url).set(authHeader(token));
      expect(res.status, url).toBe(200);
    }
  });

  it("READ_ONLY peut marquer ses notifications comme lues", async () => {
    const { token } = await collaborateur(ctx.owner.id, "READ_ONLY");
    const res = await request(app).post("/api/notifications/seen").set(authHeader(token)).send({ cles: [] });
    expect(res.status).not.toBe(403);
  });

  it("AGENT crée et modifie un bien, mais ne le supprime pas", async () => {
    const { token } = await collaborateur(ctx.owner.id, "AGENT");
    const cree = await request(app)
      .post("/api/properties")
      .set(authHeader(token))
      .send({ title: "Villa Almadies", address: "3 rue des Almadies", surface: 120, rent: 250000 });
    expect(cree.status).toBe(201);
    const maj = await request(app).put(`/api/properties/${cree.body.id}`).set(authHeader(token)).send({ title: "Villa Almadies 2" });
    expect(maj.status).toBe(200);
    const sup = await request(app).delete(`/api/properties/${cree.body.id}`).set(authHeader(token));
    expect(sup.status).toBe(403);
  });

  it("ACCOUNTANT marque une facture payée et lit le bilan fiscal ; il ne crée pas de bien", async () => {
    const { token } = await collaborateur(ctx.owner.id, "ACCOUNTANT");
    const paye = await request(app).post(`/api/invoices/${ctx.invoice.id}/mark-paid`).set(authHeader(token)).send({});
    expect(paye.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, ctx.invoice.id));
    expect(apres.status).toBe("PAID");
    const bilan = await request(app).get("/api/fiscal/synthese").set(authHeader(token));
    expect(bilan.status).toBe(200);
    const bien = await request(app).post("/api/properties").set(authHeader(token)).send({ title: "X" });
    expect(bien.status).toBe(403);
  });
});

describe("droits historiques et propriétaire inchangés", () => {
  it("un collaborateur sans rôle choisi (invité avant cette évolution) garde tous ses droits", async () => {
    const { token } = await collaborateur(ctx.owner.id, null);
    const libre = await createProperty(ctx.owner.id);
    const res = await request(app).delete(`/api/properties/${libre.id}`).set(authHeader(token));
    expect(res.status).toBe(204);
  });

  it("le rôle FULL garde tous les droits", async () => {
    const { token } = await collaborateur(ctx.owner.id, "FULL");
    const res = await request(app).get(`/api/tenants/${ctx.tenant.id}/export`).set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it("le propriétaire n'est jamais restreint", async () => {
    const token = tokenFor(ctx.owner);
    expect((await request(app).get(`/api/tenants/${ctx.tenant.id}/export`).set(authHeader(token))).status).toBe(200);
    const libre = await createProperty(ctx.owner.id);
    expect((await request(app).delete(`/api/properties/${libre.id}`).set(authHeader(token))).status).toBe(204);
  });

  it("un rôle corrompu en base échoue fermé (lecture seule)", async () => {
    const { token } = await collaborateur(ctx.owner.id, "SUPERADMIN" as RoleEquipe);
    expect((await request(app).get("/api/properties").set(authHeader(token))).status).toBe(200);
    expect((await request(app).delete(`/api/properties/${ctx.property.id}`).set(authHeader(token))).status).toBe(403);
  });
});

describe("gestion des rôles (propriétaire seul)", () => {
  it("le changement de rôle joue immédiatement, sans nouveau jeton", async () => {
    const { c, token } = await collaborateur(ctx.owner.id, "READ_ONLY");
    const avant = await request(app).post("/api/vendors").set(authHeader(token)).send({ name: "Plomberie Sall", category: "PLUMBING" });
    expect(avant.status).toBe(403);

    const maj = await request(app).patch(`/api/team/${c.id}/role`).set(authHeader(tokenFor(ctx.owner))).send({ role: "AGENT" });
    expect(maj.status).toBe(200);
    expect(maj.body.role).toBe("AGENT");

    const apres = await request(app).post("/api/vendors").set(authHeader(token)).send({ name: "Plomberie Sall", category: "PLUMBING" });
    expect(apres.status).not.toBe(403);
  });

  it("un collaborateur ne peut pas changer un rôle, pas même le sien", async () => {
    const { c, token } = await collaborateur(ctx.owner.id, "FULL");
    const res = await request(app).patch(`/api/team/${c.id}/role`).set(authHeader(token)).send({ role: "FULL" });
    expect(res.status).toBe(403);
    const lecteur = await collaborateur(ctx.owner.id, "READ_ONLY");
    const auto = await request(app).patch(`/api/team/${lecteur.c.id}/role`).set(authHeader(lecteur.token)).send({ role: "FULL" });
    expect(auto.status).toBe(403);
    const [relu] = await testDb.select().from(users).where(eq(users.id, lecteur.c.id));
    expect(relu.teamRole).toBe("READ_ONLY");
  });

  it("refuse un rôle inconnu et un collaborateur d'une autre agence", async () => {
    const { c } = await collaborateur(ctx.owner.id, "AGENT");
    const mauvais = await request(app).patch(`/api/team/${c.id}/role`).set(authHeader(tokenFor(ctx.owner))).send({ role: "ROOT" });
    expect(mauvais.status).toBe(400);

    const autre = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const res = await request(app).patch(`/api/team/${c.id}/role`).set(authHeader(tokenFor(autre))).send({ role: "FULL" });
    expect([403, 404]).toContain(res.status);
    const [relu] = await testDb.select().from(users).where(eq(users.id, c.id));
    expect(relu.teamRole).toBe("AGENT");
  });

  it("l'invitation enregistre le rôle choisi (AGENT par défaut) et la liste le renvoie", async () => {
    const choisi = await request(app).post("/api/team").set(authHeader(tokenFor(ctx.owner))).send({ email: "compta@test.local", role: "ACCOUNTANT" });
    expect(choisi.status).toBe(201);
    expect(choisi.body.role).toBe("ACCOUNTANT");
    const defaut = await request(app).post("/api/team").set(authHeader(tokenFor(ctx.owner))).send({ email: "sans-role@test.local" });
    expect(defaut.body.role).toBe("AGENT");

    const liste = await request(app).get("/api/team").set(authHeader(tokenFor(ctx.owner)));
    const parEmail = Object.fromEntries(liste.body.map((m: { email: string; role: string }) => [m.email, m.role]));
    expect(parEmail["compta@test.local"]).toBe("ACCOUNTANT");
    expect(parEmail["sans-role@test.local"]).toBe("AGENT");
  });

  it("l'invitation refuse un rôle inconnu", async () => {
    const res = await request(app).post("/api/team").set(authHeader(tokenFor(ctx.owner))).send({ email: "x@test.local", role: "ROOT" });
    expect(res.status).toBe(400);
  });

  it("/api/auth/me expose le rôle (null pour le propriétaire, FULL pour un rôle jamais choisi)", async () => {
    const proprio = await request(app).get("/api/auth/me").set(authHeader(tokenFor(ctx.owner)));
    expect(proprio.body.teamRole).toBeNull();
    const lecteur = await collaborateur(ctx.owner.id, "READ_ONLY");
    expect((await request(app).get("/api/auth/me").set(authHeader(lecteur.token))).body.teamRole).toBe("READ_ONLY");
    const ancien = await collaborateur(ctx.owner.id, null);
    expect((await request(app).get("/api/auth/me").set(authHeader(ancien.token))).body.teamRole).toBe("FULL");
  });
});
