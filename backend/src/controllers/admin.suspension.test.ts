import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createManager,
  createTeamMember,
  createTenant,
  tokenCollaborateur,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const MOTIF = "Facture impayée depuis 3 mois — dossier INTERNE-42";

async function suspendre(managerId: string, adminToken: string, reason: string = MOTIF) {
  return request(app).post(`/api/admin/managers/${managerId}/suspend`).set(authHeader(adminToken)).send({ reason });
}

async function adminToken() {
  return tokenFor(await createAdmin());
}

describe("POST /api/admin/managers/:id/suspend", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    expect((await request(app).post(`/api/admin/managers/${manager.id}/suspend`).send({ reason: "x y z" })).status).toBe(401);
    const res = await request(app)
      .post(`/api/admin/managers/${manager.id}/suspend`)
      .set(authHeader(tokenFor(manager)))
      .send({ reason: "tentative" });
    expect(res.status).toBe(403);
  });

  it("suspend le compte, enregistre le motif et laisse une trace d'audit", async () => {
    const admin = await createAdmin();
    const manager = await createManager();

    const res = await suspendre(manager.id, tokenFor(admin));

    expect(res.status).toBe(200);
    const detail = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(tokenFor(admin)));
    expect(detail.body.suspendedAt).not.toBeNull();
    expect(detail.body.suspensionReason).toBe(MOTIF);

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      action: "manager.suspend",
      adminId: admin.id,
      targetUserId: manager.id,
      targetLabel: manager.email,
    });
    expect(lignes[0].details).toContain(MOTIF);
  });

  it("exige un motif", async () => {
    const token = await adminToken();
    const manager = await createManager();
    expect((await suspendre(manager.id, token, "  ")).status).toBe(400);
    const sansMotif = await request(app).post(`/api/admin/managers/${manager.id}/suspend`).set(authHeader(token)).send({});
    expect(sansMotif.status).toBe(400);
  });

  it("renvoie 404 pour un id inconnu, un collaborateur ou un administrateur", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    for (const id of ["inconnu", collaborateur.id, admin.id]) {
      expect((await suspendre(id, token)).status).toBe(404);
    }
  });

  it("renvoie 409 si le compte est déjà suspendu, sans doubler la trace", async () => {
    const token = await adminToken();
    const manager = await createManager();
    expect((await suspendre(manager.id, token)).status).toBe(200);
    expect((await suspendre(manager.id, token)).status).toBe(409);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(1);
  });
});

describe("effet de la suspension", () => {
  it("coupe une session DÉJÀ ouverte dès la requête suivante (401 ACCOUNT_SUSPENDED)", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const jeton = tokenFor(manager);

    expect((await request(app).get("/api/properties").set(authHeader(jeton))).status).toBe(200);
    await suspendre(manager.id, token);

    const res = await request(app).get("/api/properties").set(authHeader(jeton));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("bloque aussi les collaborateurs de l'agence", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const jetonCollab = await tokenCollaborateur(manager);

    await suspendre(manager.id, token);

    const res = await request(app).get("/api/properties").set(authHeader(jetonCollab));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("refuse la connexion, sans jeton ni cookie, et ne révèle pas le motif", async () => {
    const token = await adminToken();
    const manager = await createManager();
    await suspendre(manager.id, token);

    const res = await request(app).post("/api/auth/login").send({ email: manager.email, password: "Password123!" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
    expect(res.body.token).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("INTERNE-42");
  });

  it("refuse la connexion d'un collaborateur d'une agence suspendue", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    await suspendre(manager.id, token);

    const res = await request(app).post("/api/auth/login").send({ email: collaborateur.email, password: "Password123!" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("ne touche pas les locataires de l'agence", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const jetonLocataire = await tokenLocataire(tenant.id);
    await suspendre(manager.id, token);

    const res = await request(app).get("/api/tenants/mine/export").set(authHeader(jetonLocataire));
    expect(res.status).toBe(200);
  });

  it("n'affecte pas les autres agences", async () => {
    const token = await adminToken();
    const suspendu = await createManager();
    const autre = await createManager();
    await suspendre(suspendu.id, token);

    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(autre)))).status).toBe(200);
  });
});

describe("POST /api/admin/managers/:id/reactivate", () => {
  it("lève la suspension : la connexion refonctionne, motif effacé, trace d'audit", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    await suspendre(manager.id, token);

    const res = await request(app).post(`/api/admin/managers/${manager.id}/reactivate`).set(authHeader(token));
    expect(res.status).toBe(200);

    const login = await request(app).post("/api/auth/login").send({ email: manager.email, password: "Password123!" });
    expect(login.status).toBe(200);
    const detail = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));
    expect(detail.body.suspendedAt).toBeNull();
    expect(detail.body.suspensionReason).toBeNull();

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes.map((l: { action: string }) => l.action).sort()).toEqual(["manager.reactivate", "manager.suspend"]);
  });

  it("renvoie 409 si le compte n'est pas suspendu, 404 pour un collaborateur, 403 pour un gestionnaire", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);

    expect((await request(app).post(`/api/admin/managers/${manager.id}/reactivate`).set(authHeader(token))).status).toBe(409);
    expect((await request(app).post(`/api/admin/managers/${collaborateur.id}/reactivate`).set(authHeader(token))).status).toBe(404);
    expect(
      (await request(app).post(`/api/admin/managers/${manager.id}/reactivate`).set(authHeader(tokenFor(manager)))).status
    ).toBe(403);
  });
});

describe("liste des gestionnaires et suspension", () => {
  it("expose suspendedAt et filtre sur status=SUSPENDED", async () => {
    const token = await adminToken();
    const suspendu = await createManager();
    await createManager();
    await suspendre(suspendu.id, token);

    const tous = await request(app).get("/api/admin/managers").set(authHeader(token));
    const ligne = tous.body.items.find((i: { id: string }) => i.id === suspendu.id);
    expect(ligne.suspendedAt).not.toBeNull();
    expect(JSON.stringify(tous.body)).not.toContain("INTERNE-42");

    const filtre = await request(app).get("/api/admin/managers").query({ status: "SUSPENDED" }).set(authHeader(token));
    expect(filtre.body.total).toBe(1);
    expect(filtre.body.items[0].id).toBe(suspendu.id);
  });
});
