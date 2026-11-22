import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings, contractCotenants, contracts, invoices, issueReports, leaseNotices, leaseSettlements, properties } from "../db/schema";
import * as emailService from "../services/email.service";
import { oublierAdressesDeReponse } from "../services/reponseAgence.service";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createInspection, createInvoice, createManager, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Vie d'un bail par les routes : création d'un bail non actif, bail d'un locataire anonymisé, suppression (fichiers nettoyés, bien libéré
 * ou non), renouvellement sans corps, signature refusée une seconde fois, restitution du dépôt (courriel, annulation), scan du contrat
 * et fichiers de l'espace locataire. Les fichiers principaux vérifient les parcours heureux ; ici, chaque refus et chaque repli.
 */

const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let suppression: ReturnType<typeof vi.spyOn>;
let courriel: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  oublierAdressesDeReponse();
  vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/signe/${chemin}`);
  vi.spyOn(storageService, "getSignedUrls").mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://stockage.test/signe/${c}`] as const)));
  suppression = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function agence(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager(overrides);
  const property = await createProperty(manager.id, { title: "Villa Ngor", status: "AVAILABLE" });
  const tenant = await createTenant(manager.id, { email: "aminata@test.local" });
  return { manager, property, tenant, h: authHeader(tokenFor(manager)) };
}
const sansEspaces = (s: string) => s.split(" ").join("").split("\u00a0").join("").split("\u202f").join("");
const journal = (managerId: string, action: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));
const bienDe = async (id: string) => (await testDb.select().from(properties).where(eq(properties.id, id)))[0];

const corps = (propertyId: string, tenantId: string, extra: Record<string, unknown> = {}) => ({
  propertyId,
  tenantId,
  rent: 500,
  deposit: 1000,
  startDate: "2026-06-01",
  endDate: "2027-05-31",
  ...extra,
});

/* ───────────────────────────── Création et modification ───────────────────────────── */

describe("création d'un bail : refus et repli", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 1));
  });

  it("une fin avant ou égale au début est refusée avec son code, sans rien créer", async () => {
    const { property, tenant, h } = await agence();

    const egale = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "2026-06-01", endDate: "2026-06-01" }));
    const avant = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "2026-06-01", endDate: "2026-05-01" }));

    expect(egale.status).toBe(400);
    expect(egale.body.code).toBe("CONTRACT_END_BEFORE_START");
    expect(avant.status).toBe(400);
    expect(await testDb.select().from(contracts)).toEqual([]);
    expect((await bienDe(property.id)).status).toBe("AVAILABLE");
  });

  it("« facturation depuis » hors du bail est refusée : avant le début, ou à la fin ou après", async () => {
    const { property, tenant, h } = await agence();

    for (const billingFrom of ["2026-05-01", "2027-05-31", "2028-01-01"]) {
      const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { billingFrom }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CONTRACT_BILLING_FROM_INVALID");
    }
  });

  it("la devise du bail est celle de la requête, sinon celle du bien", async () => {
    const { manager, tenant, h } = await agence();
    const bienXof = await createProperty(manager.id, { title: "Studio", currency: "XOF" });
    const bienEur = await createProperty(manager.id, { title: "Appart", currency: "EUR" });

    const parDefaut = await request(app).post("/api/contracts").set(h).send(corps(bienXof.id, tenant.id));
    const explicite = await request(app).post("/api/contracts").set(h).send(corps(bienEur.id, tenant.id, { currency: "XOF" }));
    const duBien = await request(app).post("/api/contracts").set(h).send(corps(bienEur.id, tenant.id, { startDate: "2028-01-01", endDate: "2029-01-01", status: "ENDED" }));

    expect(parDefaut.status).toBe(201);
    expect(parDefaut.body.currency).toBe("XOF"); // celle du bien
    expect(explicite.status).toBe(201);
    expect(explicite.body.currency).toBe("XOF"); // celle de la requête, contre celle du bien (EUR)
    expect(duBien.body.currency).toBe("EUR");
  });

  it("un bail déjà terminé peut être enregistré sur une période déjà occupée : seuls les baux ACTIFS se chevauchent", async () => {
    const { manager, property, tenant, h } = await agence();
    await createContract(property.id, tenant.id, { startDate: new Date(2026, 0, 1), endDate: new Date(2027, 11, 31), status: "ACTIVE" });

    const termine = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "2026-02-01", endDate: "2026-11-30", status: "ENDED" }));
    const actif = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "2026-02-01", endDate: "2026-11-30" }));

    expect(termine.status).toBe(201);
    expect(termine.body.status).toBe("ENDED");
    expect(actif.status).toBe(409);
    expect(await journal(manager.id, "contract.create")).toHaveLength(1);
  });

  it("aucun bail ne peut être établi au nom d'un locataire anonymisé", async () => {
    const { manager, property, h } = await agence();
    const efface = await createTenant(manager.id, { email: "efface@test.local", anonymizedAt: new Date() });

    const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, efface.id));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_ANONYMIZED_NO_LEASE");
    expect(await testDb.select().from(contracts)).toEqual([]);
  });
});

describe("modification d'un bail : locataire anonymisé et journal", () => {
  it("rattacher le bail à un locataire anonymisé est refusé, et le bail reste inchangé", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const efface = await createTenant(manager.id, { email: "efface@test.local", anonymizedAt: new Date() });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ tenantId: efface.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_ANONYMIZED_NO_LEASE");
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contrat.id)))[0].tenantId).toBe(tenant.id);
  });

  it("le journal dit le bien et, quand le statut change, le nouveau statut", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);

    await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ terms: "Clause" });
    await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ status: "TERMINATED" });

    const lignes = await journal(manager.id, "contract.update");
    expect(lignes.map((l: { details: string }) => l.details).sort()).toEqual(["Contrat modifié pour le bien Villa Ngor", "Contrat modifié pour le bien Villa Ngor (statut : TERMINATED)"]);
    expect(lignes[0].entityLabel).toBe("Villa Ngor");
  });
});

/* ───────────────────────────── Suppression ───────────────────────────── */

describe("suppression d'un bail", () => {
  it("une facture non annulée qui porte une référence de paiement bloque la suppression ; annulée, elle ne bloque pas", async () => {
    const { property, tenant, h } = await agence();
    const bloque = await createContract(property.id, tenant.id, { status: "ENDED" });
    await createInvoice(bloque.id, { status: "PENDING", paymentRef: "cs_en_cours" });

    const res = await request(app).delete(`/api/contracts/${bloque.id}`).set(h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTRACT_HAS_PENDING_PAYMENT");
    expect(await testDb.select().from(contracts).where(eq(contracts.id, bloque.id))).toHaveLength(1);

    await testDb.update(invoices).set({ status: "CANCELLED" }).where(eq(invoices.contractId, bloque.id));
    const apres = await request(app).delete(`/api/contracts/${bloque.id}`).set(h);
    expect(apres.status).toBe(204);
  });

  it("une facture en attente SANS référence de paiement ni acompte ne bloque pas la suppression", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ENDED" });
    await createInvoice(contrat.id, { status: "PENDING", paymentRef: null, amountPaid: 0 });

    const res = await request(app).delete(`/api/contracts/${contrat.id}`).set(h);

    expect(res.status).toBe(204);
    expect(await testDb.select().from(invoices).where(eq(invoices.contractId, contrat.id))).toEqual([]);
  });

  it("il reste un bail TERMINÉ sur le bien : supprimer l'autre le libère quand même (seuls les baux actifs l'occupent)", async () => {
    const { property, tenant, h } = await agence();
    const garde = await createContract(property.id, tenant.id, { status: "ENDED", startDate: new Date(2023, 0, 1), endDate: new Date(2024, 0, 1) });
    const supprime = await createContract(property.id, tenant.id, { status: "TERMINATED", startDate: new Date(2024, 0, 1), endDate: new Date(2025, 0, 1) });
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));

    expect((await request(app).delete(`/api/contracts/${supprime.id}`).set(h)).status).toBe(204);

    expect((await bienDe(property.id)).status).toBe("AVAILABLE");
    expect(await testDb.select().from(contracts).where(eq(contracts.id, garde.id))).toHaveLength(1);
  });

  it("supprimer un bail terminé libère le bien s'il n'y a plus de bail actif, et le garde occupé s'il en reste un", async () => {
    const { manager, property, tenant, h } = await agence();
    const libre = await createContract(property.id, tenant.id, { status: "ENDED" });
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));

    expect((await request(app).delete(`/api/contracts/${libre.id}`).set(h)).status).toBe(204);
    expect((await bienDe(property.id)).status).toBe("AVAILABLE");

    const occupe = await createProperty(manager.id, { title: "Studio B", status: "OCCUPIED" });
    await createContract(occupe.id, tenant.id, { status: "ACTIVE", startDate: new Date(2026, 0, 1), endDate: new Date(2027, 0, 1) });
    const ancien = await createContract(occupe.id, tenant.id, { status: "ENDED", startDate: new Date(2024, 0, 1), endDate: new Date(2025, 0, 1) });

    expect((await request(app).delete(`/api/contracts/${ancien.id}`).set(h)).status).toBe(204);
    expect((await bienDe(occupe.id)).status).toBe("OCCUPIED");
  });

  it("les fichiers du bail sont retirés du stockage : scan, scans des congés, photos des signalements (y compris les photos supplémentaires)", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ENDED", scannedContractUrl: "contracts/scan.pdf" });
    await testDb.insert(leaseNotices).values({
      contractId: contrat.id,
      managerId: manager.id,
      givenBy: "TENANT",
      deliveryMode: "HAND_DELIVERY",
      servedAt: new Date(Date.UTC(2026, 0, 1)),
      periodValue: 1,
      periodUnit: "MONTHS",
      exitDate: new Date(Date.UTC(2026, 1, 1)),
      documentUrl: "notices/conge.pdf",
    });
    await testDb.insert(issueReports).values([
      { contractId: contrat.id, tenantId: tenant.id, title: "Fuite", description: "x", photoUrl: "issues/p1.jpg", additionalPhotos: JSON.stringify(["issues/p2.jpg", "issues/p3.jpg"]) },
      { contractId: contrat.id, tenantId: tenant.id, title: "Illisible", description: "x", photoUrl: "issues/p4.jpg", additionalPhotos: "pas du json" },
      { contractId: contrat.id, tenantId: tenant.id, title: "Pas un tableau", description: "x", photoUrl: "issues/p5.jpg", additionalPhotos: JSON.stringify({ a: 1 }) },
      { contractId: contrat.id, tenantId: tenant.id, title: "Sans supplément", description: "x", photoUrl: "issues/p6.jpg", additionalPhotos: null },
    ] as Array<typeof issueReports.$inferInsert>);

    const res = await request(app).delete(`/api/contracts/${contrat.id}`).set(h);

    expect(res.status).toBe(204);
    const retires = suppression.mock.calls.map((c: unknown[]) => c[0]).sort();
    expect(retires).toEqual(["contracts/scan.pdf", "issues/p1.jpg", "issues/p2.jpg", "issues/p3.jpg", "issues/p4.jpg", "issues/p5.jpg", "issues/p6.jpg", "notices/conge.pdf"].sort());
    expect(await testDb.select().from(issueReports).where(eq(issueReports.contractId, contrat.id))).toEqual([]);
  });

  it("un stockage en panne ne fait pas échouer la suppression, déjà enregistrée en base", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ENDED", scannedContractUrl: "contracts/scan.pdf" });
    suppression.mockRejectedValue(new Error("stockage coupé"));

    const res = await request(app).delete(`/api/contracts/${contrat.id}`).set(h);

    expect(res.status).toBe(204);
    expect(await testDb.select().from(contracts).where(eq(contracts.id, contrat.id))).toEqual([]);
  });

  it("la suppression est tracée avec le titre du bien ; un bail inconnu répond 404", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ENDED" });

    await request(app).delete(`/api/contracts/${contrat.id}`).set(h);

    const [ligne] = await journal(manager.id, "contract.delete");
    expect(ligne).toMatchObject({ entityLabel: "Villa Ngor", details: "Contrat supprimé pour le bien Villa Ngor" });
    expect((await request(app).delete("/api/contracts/inconnu").set(h)).status).toBe(404);
  });
});

/* ───────────────────────────── Renouvellement ───────────────────────────── */

describe("renouvellement d'un bail", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 1));
  });

  it("sans corps : 12 mois à partir du lendemain de la fin, l'ancien bail est clos, le bien reste occupé, l'opération est tracée", async () => {
    const { manager, property, tenant, h } = await agence();
    const ancien = await createContract(property.id, tenant.id, { startDate: new Date(2025, 5, 1), endDate: new Date(2026, 5, 30), status: "ACTIVE", terms: "Clause" });
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));

    const res = await request(app).post(`/api/contracts/${ancien.id}/renew`).set(h);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.terms).toBe("Clause");
    expect(res.body.startDate.slice(0, 10)).toBe("2026-07-01");
    expect(res.body.endDate.slice(0, 10)).toBe("2027-07-01");
    expect((await testDb.select().from(contracts).where(eq(contracts.id, ancien.id)))[0].status).toBe("ENDED");
    expect((await bienDe(property.id)).status).toBe("OCCUPIED");
    const [ligne] = await journal(manager.id, "contract.renew");
    expect(ligne.details).toBe("Contrat renouvelé pour 12 mois sur le bien Villa Ngor");
    expect(ligne.entityLabel).toBe("Villa Ngor");
  });

  it("une durée précisée est respectée (6 mois), mais plafonnée à 60 mois et jamais nulle ni décimale", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { startDate: new Date(2025, 5, 1), endDate: new Date(2026, 5, 30), status: "ACTIVE" });

    for (const months of [0, -3, 61, 2.5, "abc"]) {
      expect((await request(app).post(`/api/contracts/${contrat.id}/renew`).set(h).send({ months })).status).toBe(400);
    }
    const res = await request(app).post(`/api/contracts/${contrat.id}/renew`).set(h).send({ months: 6 });

    expect(res.status).toBe(201);
    expect(res.body.endDate.slice(0, 10)).toBe("2027-01-01");
  });

  it("un bail inconnu répond 404, un bail déjà clos 409, et le bail d'une autre agence 404", async () => {
    const { property, tenant, h } = await agence();
    const clos = await createContract(property.id, tenant.id, { status: "ENDED" });
    const autre = await createManager();
    const autreBien = await createProperty(autre.id);
    const autreLocataire = await createTenant(autre.id);
    const etranger = await createContract(autreBien.id, autreLocataire.id, { status: "ACTIVE" });

    expect((await request(app).post("/api/contracts/inconnu/renew").set(h)).status).toBe(404);
    const dejaClos = await request(app).post(`/api/contracts/${clos.id}/renew`).set(h);
    expect(dejaClos.status).toBe(409);
    expect(dejaClos.body.code).toBe("CONTRACT_RENEW_ACTIVE_ONLY");
    expect((await request(app).post(`/api/contracts/${etranger.id}/renew`).set(h)).status).toBe(404);
    expect((await testDb.select().from(contracts).where(eq(contracts.id, etranger.id)))[0].status).toBe("ACTIVE");
  });
});

/* ───────────────────────────── Signature ───────────────────────────── */

describe("signature du bail : une signature ne se remplace pas", () => {
  it("le locataire ne signe qu'une fois : la seconde tentative est refusée et la première signature est gardée", async () => {
    const { property, tenant } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const h = authHeader(await tokenLocataire(tenant.id));

    const premiere = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: SIGNATURE });
    const seconde = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: SIGNATURE.replace("iVBOR", "iVBPR") });

    expect(premiere.status).toBe(200);
    expect(seconde.status).toBe(409);
    expect(seconde.body.code).toBe("LEASE_ALREADY_SIGNED_BY_YOU");
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contrat.id)))[0].tenantSignatureUrl).toBe(SIGNATURE);
  });

  it("le gestionnaire ne signe qu'une fois non plus", async () => {
    const { property, tenant, h } = await agence({ subscriptionPlan: "PRO" });
    const contrat = await createContract(property.id, tenant.id);

    const premiere = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: SIGNATURE });
    const seconde = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: SIGNATURE });

    expect(premiere.status).toBe(200);
    expect(seconde.status).toBe(409);
    expect(seconde.body.code).toBe("LEASE_ALREADY_SIGNED_BY_MANAGER");
  });

  it("un colocataire est partie au bail mais ne signe pas (403) ; un locataire étranger au bail n'en voit pas l'existence (404)", async () => {
    const { manager, property, tenant } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const coloc = await createTenant(manager.id, { email: "coloc@test.local" });
    await testDb.insert(contractCotenants).values({ contractId: contrat.id, tenantId: coloc.id });
    const etranger = await createTenant(manager.id, { email: "etranger@test.local" });

    const colocataire = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(authHeader(await tokenLocataire(coloc.id))).send({ signatureDataUrl: SIGNATURE });
    const autre = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(authHeader(await tokenLocataire(etranger.id))).send({ signatureDataUrl: SIGNATURE });

    expect(colocataire.status).toBe(403);
    expect(colocataire.body.code).toBe("ACCESS_DENIED");
    expect(autre.status).toBe(404);
  });

  it("un bail inconnu répond 404 ; une signature qui n'est pas une image (SVG, HTML, base64 invalide) est refusée", async () => {
    const { property, tenant, h } = await agence({ subscriptionPlan: "PRO" });
    const contrat = await createContract(property.id, tenant.id);

    expect((await request(app).post("/api/contracts/inconnu/sign").set(h).send({ signatureDataUrl: SIGNATURE })).status).toBe(404);
    for (const signatureDataUrl of ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "<script>alert(1)</script>", "data:image/png;base64,@@@", "data:text/html;base64,PGI+"]) {
      expect((await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl })).status).toBe(400);
    }
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contrat.id)))[0].signedByManagerAt).toBeNull();
  });
});

/* ───────────────────────────── Restitution du dépôt ───────────────────────────── */

describe("restitution du dépôt : courriel, annulation, limites", () => {
  async function bailSorti(overrides: Parameters<typeof createTenant>[1] = {}) {
    const { manager, property, h } = await agence();
    const tenant = await createTenant(manager.id, { email: "locataire@test.local", ...overrides });
    const contrat = await createContract(property.id, tenant.id, { deposit: 1000 });
    await createInspection(contrat, manager.id, { type: "EXIT", status: "COMPLETED" });
    return { manager, contrat, tenant, h };
  }

  it("le locataire est prévenu par courriel, avec l'adresse de réponse de l'agence ; l'annulation, elle, ne prévient personne", async () => {
    const { manager, contrat, tenant, h } = await bailSorti();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Rivage", email: "contact@rivage.sn" });

    const res = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [{ label: "Peinture", amount: 100 }] });

    expect(res.status).toBe(200);
    expect(courriel).toHaveBeenCalledTimes(1);
    const [destinataire, , html, , options] = courriel.mock.calls[0] as unknown as [string, string, string, unknown, { replyTo?: string }];
    expect(destinataire).toBe(tenant.email);
    expect(options.replyTo).toBe("contact@rivage.sn");
    expect(html).toContain("Peinture");
    expect(sansEspaces(html)).toContain(">900€<"); // dépôt 1000 − retenue 100 : la somme rendue figure dans le courriel

    courriel.mockClear();
    const annulation = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: null });
    expect(annulation.status).toBe(200);
    expect(courriel).not.toHaveBeenCalled();
    expect(annulation.body.depositRefundedAt).toBeNull();
    expect(annulation.body.depositDeductions).toBeNull();
  });

  it("un locataire sans adresse e-mail : la restitution est enregistrée, aucun envoi n'est tenté", async () => {
    const { contrat, h } = await bailSorti({ email: "" });

    const res = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [] });

    expect(res.status).toBe(200);
    expect(res.body.depositRefundedAt).not.toBeNull();
    expect(courriel).not.toHaveBeenCalled();
  });

  it("un courriel qui échoue ne fait pas échouer la restitution, et l'échec est journalisé", async () => {
    const { contrat, h } = await bailSorti();
    courriel.mockRejectedValueOnce(new Error("SMTP coupé"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [] });

    expect(res.status).toBe(200);
    expect(erreur).toHaveBeenCalled();
    expect(String(erreur.mock.calls[0][0])).toContain("restitution du dépôt");
  });

  it("des retenues égales au dépôt sont acceptées (rien à rendre), au-delà refusées avec les montants", async () => {
    const { contrat, h } = await bailSorti();

    const exact = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [{ label: "Dégâts", amount: 600 }, { label: "Loyers", amount: 400 }] });
    const trop = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [{ label: "Dégâts", amount: 1000.01 }] });

    expect(exact.status).toBe(200);
    expect(trop.status).toBe(400);
    expect(trop.body.code).toBe("DEPOSIT_DEDUCTIONS_EXCEED");
    expect(trop.body.params).toEqual({ total: 1000.01, deposit: 1000 });
  });

  it("plus de 20 retenues, ou un champ « deductions » absent, sont refusés", async () => {
    const { contrat, h } = await bailSorti();
    const retenues = Array.from({ length: 21 }, (_, i) => ({ label: `R${i}`, amount: 1 }));

    expect((await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: retenues })).status).toBe(400);
    expect((await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({})).status).toBe(400);
  });

  it("la restitution et son annulation sont tracées avec le nombre de retenues", async () => {
    const { manager, contrat, h } = await bailSorti();

    await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [{ label: "A", amount: 1 }, { label: "B", amount: 2 }] });
    await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: null });

    const lignes = (await journal(manager.id, "contract.deposit_refund")).map((l: { details: string }) => l.details).sort();
    expect(lignes).toEqual(["Restitution du dépôt annulée pour le bien Villa Ngor", "Restitution du dépôt enregistrée pour le bien Villa Ngor (2 retenue(s))"]);
    expect((await journal(manager.id, "contract.deposit_refund")).every((l: { entityLabel: string }) => l.entityLabel === "Villa Ngor")).toBe(true);
  });

  it("un bail inconnu répond 404", async () => {
    const { h } = await bailSorti();

    expect((await request(app).put("/api/contracts/inconnu/deposit-refund").set(h).send({ deductions: [] })).status).toBe(404);
  });
});

/* ───────────────────────────── Scan du contrat ───────────────────────────── */

describe("scan du contrat", () => {
  const PDF = Buffer.from("%PDF-1.4 contrat");

  it("sans fichier : 400 avec son code ; un fichier dont le contenu n'est pas celui qu'il annonce est refusé", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);

    const sans = await request(app).post(`/api/contracts/${contrat.id}/scan`).set(h);
    const faux = await request(app).post(`/api/contracts/${contrat.id}/scan`).set(h).attach("scan", Buffer.from("ceci n'est pas un PDF"), { filename: "x.pdf", contentType: "application/pdf" });

    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe("CONTRACT_SCAN_FILE_REQUIRED");
    expect(faux.status).toBe(400);
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contrat.id)))[0].scannedContractUrl).toBeNull();
  });

  it("un nouveau scan remplace l'ancien, qui est retiré du stockage ; le premier scan n'en retire rien", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);

    const premier = await request(app).post(`/api/contracts/${contrat.id}/scan`).set(h).attach("scan", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(premier.status).toBe(200);
    expect(suppression).not.toHaveBeenCalled();
    const ancienChemin = (await testDb.select().from(contracts).where(eq(contracts.id, contrat.id)))[0].scannedContractUrl;
    expect(ancienChemin).toBeTruthy();

    const second = await request(app).post(`/api/contracts/${contrat.id}/scan`).set(h).attach("scan", PDF, { filename: "b.pdf", contentType: "application/pdf" });

    expect(second.status).toBe(200);
    expect(suppression).toHaveBeenCalledTimes(1);
    expect(suppression.mock.calls[0][0]).toBe(ancienChemin);
  });

  it("le bail d'une autre agence ou un bail inconnu répondent 404, le dépôt du scan est tracé avec le titre du bien", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const autre = await createManager();

    const etranger = await request(app).post(`/api/contracts/${contrat.id}/scan`).set(authHeader(tokenFor(autre))).attach("scan", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    const inconnu = await request(app).post("/api/contracts/inconnu/scan").set(h).attach("scan", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    await request(app).post(`/api/contracts/${contrat.id}/scan`).set(h).attach("scan", PDF, { filename: "a.pdf", contentType: "application/pdf" });

    expect(etranger.status).toBe(404);
    expect(inconnu.status).toBe(404);
    const [ligne] = await journal(manager.id, "contract.scan_upload");
    expect(ligne.details).toBe("Contrat papier scanné uploadé pour le bien Villa Ngor");
  });
});

/* ───────────────────────────── Lecture : scans et espace locataire ───────────────────────────── */

describe("lecture des baux : liens du scan et espace locataire", () => {
  it("un scan déjà en lien complet est rendu tel quel ; un chemin de stockage est remplacé par son lien signé (fiche, liste et espace locataire)", async () => {
    const { property, tenant, h } = await agence();
    const complet = await createContract(property.id, tenant.id, { scannedContractUrl: "https://exemple.test/scan.pdf", status: "ENDED", startDate: new Date(2024, 0, 1), endDate: new Date(2025, 0, 1) });
    const chemin = await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/scan.pdf" });

    expect((await request(app).get(`/api/contracts/${complet.id}`).set(h)).body.scannedContractUrl).toBe("https://exemple.test/scan.pdf");
    expect((await request(app).get(`/api/contracts/${chemin.id}`).set(h)).body.scannedContractUrl).toBe("https://stockage.test/signe/contracts/scan.pdf");

    const liste = (await request(app).get("/api/contracts").set(h)).body.items as Array<{ id: string; scannedContractUrl: string }>;
    expect(liste.find((c) => c.id === complet.id)!.scannedContractUrl).toBe("https://exemple.test/scan.pdf");
    expect(liste.find((c) => c.id === chemin.id)!.scannedContractUrl).toBe("https://stockage.test/signe/contracts/scan.pdf");

    const mine = (await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(tenant.id)))).body as Array<{ id: string; scannedContractUrl: string }>;
    expect(mine.find((c) => c.id === complet.id)!.scannedContractUrl).toBe("https://exemple.test/scan.pdf");
    expect(mine.find((c) => c.id === chemin.id)!.scannedContractUrl).toBe("https://stockage.test/signe/contracts/scan.pdf");
  });

  it("la liste ne demande la signature que des chemins de stockage, jamais des liens complets ; un chemin non signé est rendu tel quel", async () => {
    const { property, tenant, h } = await agence();
    await createContract(property.id, tenant.id, { scannedContractUrl: "https://exemple.test/scan.pdf", status: "ENDED", startDate: new Date(2024, 0, 1), endDate: new Date(2025, 0, 1) });
    const chemin = await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/scan.pdf" });
    const signer = vi.spyOn(storageService, "getSignedUrls").mockResolvedValue(new Map()); // le stockage ne signe rien

    const liste = (await request(app).get("/api/contracts").set(h)).body.items as Array<{ id: string; scannedContractUrl: string }>;

    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer.mock.calls[0][0]).toEqual(["contracts/scan.pdf"]);
    expect(liste.find((c) => c.id === chemin.id)!.scannedContractUrl).toBe("contracts/scan.pdf");
  });

  it("un lien qui ne se signe pas (stockage en panne) est rendu tel quel au lieu de faire échouer la lecture", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/scan.pdf" });
    vi.spyOn(storageService, "getSignedUrl").mockRejectedValue(new Error("stockage coupé"));

    const res = await request(app).get(`/api/contracts/${contrat.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.body.scannedContractUrl).toBe("contracts/scan.pdf");
  });

  it("un locataire sans aucun bail reçoit une liste vide", async () => {
    const { manager } = await agence();
    const sansBail = await createTenant(manager.id, { email: "sansbail@test.local" });

    const res = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(sansBail.id)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("plusieurs soldes sur un même bail : le locataire voit chaque résumé, du plus récent au plus ancien, sans détail ni gestionnaire", async () => {
    const { manager, property, tenant } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const base = { contractId: contrat.id, managerId: manager.id, exitDate: new Date(Date.UTC(2026, 5, 30)), depositAmount: 1000, details: '{"secret":1}' };
    const [ancien] = await testDb.insert(leaseSettlements).values({ ...base, balance: 100, createdAt: new Date(Date.UTC(2026, 6, 1)) }).returning();
    const [recent] = await testDb.insert(leaseSettlements).values({ ...base, balance: -50, createdAt: new Date(Date.UTC(2026, 6, 5)), settledAt: new Date(Date.UTC(2026, 6, 9)) }).returning();

    const res = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    const soldes = res.body[0].settlements as Array<Record<string, unknown>>;
    expect(soldes.map((s) => s.id)).toEqual([recent.id, ancien.id]);
    expect(soldes[0]).toMatchObject({ balance: -50, currency: "EUR" });
    expect(soldes[0].settledAt).not.toBeNull();
    expect(soldes[1].settledAt).toBeNull();
    expect(Object.keys(soldes[0]).sort()).toEqual(["balance", "createdAt", "currency", "exitDate", "id", "reference", "settledAt"]);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("un locataire titulaire de deux baux voit sur chacun SES soldes, jamais ceux de l'autre", async () => {
    const { manager, property, tenant } = await agence();
    const autreBien = await createProperty(manager.id, { title: "Studio B" });
    const bailA = await createContract(property.id, tenant.id, { status: "ENDED", startDate: new Date(2024, 0, 1), endDate: new Date(2025, 0, 1) });
    const bailB = await createContract(autreBien.id, tenant.id, { status: "ENDED", startDate: new Date(2025, 0, 1), endDate: new Date(2026, 0, 1) });
    const base = { managerId: manager.id, exitDate: new Date(Date.UTC(2025, 0, 1)), depositAmount: 1000, details: "{}" };
    const [soldeA] = await testDb.insert(leaseSettlements).values({ ...base, contractId: bailA.id, balance: 10 }).returning();
    const [soldeB1] = await testDb.insert(leaseSettlements).values({ ...base, contractId: bailB.id, balance: 20 }).returning();
    const [soldeB2] = await testDb.insert(leaseSettlements).values({ ...base, contractId: bailB.id, balance: 30, createdAt: new Date(Date.UTC(2030, 0, 1)) }).returning();

    const res = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(tenant.id)));

    const parBail = new Map((res.body as Array<{ id: string; settlements: Array<{ id: string }> }>).map((b) => [b.id, b.settlements.map((s) => s.id)]));
    expect(parBail.get(bailA.id)).toEqual([soldeA.id]);
    expect(parBail.get(bailB.id)).toEqual([soldeB2.id, soldeB1.id]);
  });

  it("le colocataire voit le bail avec la qualité « COLOCATAIRE », le titulaire avec « TITULAIRE »", async () => {
    const { manager, property, tenant } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const coloc = await createTenant(manager.id, { email: "coloc@test.local" });
    await testDb.insert(contractCotenants).values({ contractId: contrat.id, tenantId: coloc.id });

    const titulaire = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(tenant.id)));
    const colocataire = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(coloc.id)));

    expect(titulaire.body[0].qualite).toBe("TITULAIRE");
    expect(colocataire.body[0].qualite).toBe("COLOCATAIRE");
    expect(colocataire.body[0].id).toBe(contrat.id);
  });
});
