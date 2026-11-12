import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { contracts, issueReports } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createManager, createProperty, createTenant, createTenantPortalUser, createVendor, fakeJpegBuffer, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const MARQUEUR = "AAAAAAAA";

async function incidentSurBailSigne() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id, { email: "moussa@test.local" });
  const contract = await createContract(property.id, tenant.id, {
    terms: "Clauses particulières. ".repeat(200),
    managerSignatureUrl: SIGNATURE,
    tenantSignatureUrl: SIGNATURE,
    signedByManagerAt: new Date(),
    signedByTenantAt: new Date(),
  });
  const portail = await createTenantPortalUser(tenant);
  const vendor = await createVendor(manager.id, { name: "Plomberie Diop" });
  const [issue] = await testDb
    .insert(issueReports)
    .values({ contractId: contract.id, tenantId: tenant.id, title: "Fuite", description: "Fuite sous l'évier", photoUrl: "http://exemple.test/p.jpg", vendorId: vendor.id })
    .returning();
  return { manager, property, tenant, contract, portail, vendor, issue, h: authHeader(tokenFor(manager)) };
}

describe("Incidents — les listes ne renvoient que ce que les écrans lisent", () => {
  it("la liste du gestionnaire ne répète pas le bail entier (clauses, images de signature) sur chaque incident", async () => {
    const { property, tenant, contract, h } = await incidentSurBailSigne();

    const res = await request(app).get("/api/issues").set(h);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const corps = JSON.stringify(res.body);
    expect(corps).not.toContain(MARQUEUR);
    expect(corps).not.toContain("Clauses particulières");
    // Ce que l'écran lit.
    const incident = res.body.items[0];
    expect(incident.tenant.firstName).toBe(tenant.firstName);
    expect(incident.tenant.lastName).toBe(tenant.lastName);
    expect(incident.tenant.phone).toBe(tenant.phone);
    expect(incident.contract.id).toBe(contract.id);
    expect(incident.contract.property.title).toBe(property.title);
    expect(incident.vendor.name).toBe("Plomberie Diop");
    expect(incident.vendor.id).toBeTruthy();
    expect(corps.length).toBeLessThan(8_000);
  });

  it("la liste du locataire non plus, et ne montre au locataire que le nom et le métier du prestataire", async () => {
    const { property, tenant, portail } = await incidentSurBailSigne();

    const res = await request(app).get("/api/issues/mine").set(authHeader(tokenFor(portail, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const corps = JSON.stringify(res.body);
    expect(corps).not.toContain(MARQUEUR);
    expect(corps).not.toContain("Clauses particulières");
    expect(res.body[0].contract.property.title).toBe(property.title);
    expect(res.body[0].vendor).toEqual({ name: "Plomberie Diop", trade: expect.anything() });
    expect(corps.length).toBeLessThan(8_000);
  });
});

describe("PUT /api/issues/:id/status — pas d'e-mail ni d'écriture quand rien ne change", () => {
  const mailsAuLocataire = () => envoi.mock.calls.filter((c: unknown[]) => c[0] === "moussa@test.local");

  it("un enregistrement identique (double clic, onglet périmé) n'envoie aucun e-mail au locataire et ne réécrit rien", async () => {
    const { issue, h } = await incidentSurBailSigne();
    await testDb.update(issueReports).set({ status: "IN_PROGRESS", managerNote: "Plombier prévenu" }).where(eq(issueReports.id, issue.id));
    envoi.mockClear();
    const avant = (await testDb.select().from(issueReports).where(eq(issueReports.id, issue.id)))[0];

    const res = await request(app).put(`/api/issues/${issue.id}/status`).set(h).send({ status: "IN_PROGRESS", managerNote: "Plombier prévenu" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(mailsAuLocataire()).toHaveLength(0);
    const apres = (await testDb.select().from(issueReports).where(eq(issueReports.id, issue.id)))[0];
    expect(apres.updatedAt.getTime()).toBe(avant.updatedAt.getTime());
  });

  it("un vrai changement de statut prévient le locataire, une seule fois", async () => {
    const { issue, h } = await incidentSurBailSigne();
    envoi.mockClear();

    const res = await request(app).put(`/api/issues/${issue.id}/status`).set(h).send({ status: "RESOLVED", managerNote: "Réparé" });

    expect(res.status).toBe(200);
    expect(mailsAuLocataire()).toHaveLength(1);
    expect((await testDb.select().from(issueReports).where(eq(issueReports.id, issue.id)))[0].status).toBe("RESOLVED");
  });

  it("un changement de note seul, ou de date d'intervention seule, prévient aussi le locataire (ce sont des champs de l'e-mail)", async () => {
    const { issue, h } = await incidentSurBailSigne();
    envoi.mockClear();

    await request(app).put(`/api/issues/${issue.id}/status`).set(h).send({ status: "OPEN", managerNote: "Nouvelle note" });
    expect(mailsAuLocataire()).toHaveLength(1);

    await request(app).put(`/api/issues/${issue.id}/status`).set(h).send({ status: "OPEN", managerNote: "Nouvelle note", scheduledAt: "2027-03-01" });
    expect(mailsAuLocataire()).toHaveLength(2);
  });

  it("changer seulement le prestataire n'envoie pas d'e-mail (le prestataire ne figure pas dans le message) mais s'enregistre", async () => {
    const { manager, issue, h } = await incidentSurBailSigne();
    const autre = await createVendor(manager.id, { name: "Électricité Ba" });
    envoi.mockClear();

    const res = await request(app).put(`/api/issues/${issue.id}/status`).set(h).send({ status: "OPEN", vendorId: autre.id });

    expect(res.status).toBe(200);
    expect(res.body.vendor.name).toBe("Électricité Ba");
    expect(mailsAuLocataire()).toHaveLength(0);
    expect((await testDb.select().from(issueReports).where(eq(issueReports.id, issue.id)))[0].vendorId).toBe(autre.id);
  });
});

describe("Incidents — plafond de dépôts de photos par compte", () => {
  async function locataire() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portail = await createTenantPortalUser(tenant);
    return { contract, h: authHeader(tokenFor(portail, tenant.id)) };
  }
  const signaler = (contractId: string, h: Record<string, string>) =>
    request(app)
      .post("/api/issues")
      .set(h)
      .field("contractId", contractId)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "fuite.jpg", contentType: "image/jpeg" });

  it("accepte 30 dépôts, refuse le 31e (429, code traduisible), sans plafonner la lecture", async () => {
    const { contract, h } = await locataire();
    for (let i = 0; i < 30; i++) expect((await signaler(contract.id, h)).status).toBe(201);

    const refuse = await signaler(contract.id, h);
    expect(refuse.status).toBe(429);
    expect(refuse.body.code).toBe("ISSUE_RATE_LIMITED");

    expect((await request(app).get("/api/issues/mine").set(h)).status).toBe(200);
  }, 120_000);

  it("est propre à chaque compte : un locataire au plafond ne bloque pas un autre locataire", async () => {
    const a = await locataire();
    const b = await locataire();
    for (let i = 0; i < 30; i++) await signaler(a.contract.id, a.h);
    expect((await signaler(a.contract.id, a.h)).status).toBe(429);

    expect((await signaler(b.contract.id, b.h)).status).toBe(201);
  }, 120_000);
});

void contracts;
