import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { activityLogs, storedDocuments } from "../db/schema";
import { deleteStorageObjectBestEffort, getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn(),
  getSignedUrl: vi.fn(),
  deleteStorageObjectBestEffort: vi.fn(),
}));

const PDF = Buffer.from("%PDF-1.4 diagnostic");

beforeEach(() => {
  vi.mocked(uploadPrivateFile).mockReset().mockResolvedValue("documents/abc.pdf");
  vi.mocked(getSignedUrl).mockReset().mockResolvedValue("http://test.local/signed/abc.pdf");
  vi.mocked(deleteStorageObjectBestEffort).mockReset().mockResolvedValue(undefined);
});

async function setup() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Baobab" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  return { manager, property, tenant };
}

const deposer = (manager: { id: string }, champs: Record<string, string>, fichier: Buffer | null = PDF) => {
  let r = request(app).post("/api/stored-documents").set(authHeader(tokenFor(manager as never)));
  for (const [k, v] of Object.entries(champs)) r = r.field(k, v);
  if (fichier) r = r.attach("file", fichier, { filename: "dpe.pdf", contentType: "application/pdf" });
  return r;
};

const poser = async (managerId: string, propertyId: string | null, tenantId: string | null, extra: Partial<typeof storedDocuments.$inferInsert> = {}) => {
  const [d] = await testDb
    .insert(storedDocuments)
    .values({ managerId, propertyId, tenantId, title: "Doc", filePath: "documents/x.pdf", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10, ...extra })
    .returning();
  return d;
};

describe("POST /api/stored-documents", () => {
  it("range un document sur un bien, sans jamais exposer le chemin du stockage", async () => {
    const { manager, property } = await setup();

    const res = await deposer(manager, { propertyId: property.id, category: "DIAGNOSTIC", title: "DPE 2026", expiresAt: "2036-05-01" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "DPE 2026", category: "DIAGNOSTIC", propertyTitle: "Villa Baobab", tenantName: null, fileName: "dpe.pdf", mimeType: "application/pdf" });
    expect(res.body.filePath).toBeUndefined();
    expect(uploadPrivateFile).toHaveBeenCalledWith(expect.anything(), "documents");
    const [ligne] = await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, res.body.id));
    expect(ligne.filePath).toBe("documents/abc.pdf");
    expect(ligne.expiresAt?.toISOString().slice(0, 10)).toBe("2036-05-01");
  });

  it("accepte un rattachement à un locataire, avec ou sans bien, et des champs vides pour la date et les notes", async () => {
    const { manager, property, tenant } = await setup();

    const res = await deposer(manager, { tenantId: tenant.id, propertyId: property.id, category: "IDENTITY", title: "Passeport", expiresAt: "", notes: "" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantName: "Awa Sow", propertyTitle: "Villa Baobab", expiresAt: null, notes: null });
  });

  it("refuse sans fichier, sans rattachement, ou avec une catégorie inconnue — sans rien envoyer au stockage", async () => {
    const { manager, property } = await setup();

    const sansFichier = await deposer(manager, { propertyId: property.id, title: "X" }, null);
    const sansRattachement = await deposer(manager, { title: "X" });
    const categorie = await deposer(manager, { propertyId: property.id, title: "X", category: "SECRET" });

    expect(sansFichier.status).toBe(400);
    expect(sansFichier.body.code).toBe("STORED_DOCUMENT_FILE_REQUIRED");
    expect(sansRattachement.status).toBe(400);
    expect(categorie.status).toBe(400);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("refuse un type de fichier non autorisé ou un contenu qui ne correspond pas au type déclaré", async () => {
    const { manager, property } = await setup();

    const exe = await request(app)
      .post("/api/stored-documents")
      .set(authHeader(tokenFor(manager)))
      .field("propertyId", property.id)
      .field("title", "X")
      .attach("file", Buffer.from("MZ"), { filename: "a.exe", contentType: "application/x-msdownload" });
    const faux = await deposer(manager, { propertyId: property.id, title: "X" }, Buffer.from("pas un pdf"));

    expect(exe.status).toBe(400);
    expect(exe.body.code).toBe("FILE_TYPE_NOT_ALLOWED");
    expect(faux.status).toBe(400);
    expect(faux.body.code).toBe("FILE_CONTENT_MISMATCH");
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("refuse le bien ou le locataire d'une autre agence, sans rien envoyer au stockage", async () => {
    const { manager } = await setup();
    const autre = await setup();

    const bien = await deposer(manager, { propertyId: autre.property.id, title: "X" });
    const locataire = await deposer(manager, { tenantId: autre.tenant.id, title: "X" });

    expect(bien.status).toBe(404);
    expect(locataire.status).toBe(404);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("plafonne le nombre de documents par bien", async () => {
    const { manager, property } = await setup();
    await testDb.insert(storedDocuments).values(
      Array.from({ length: 100 }, (_, i) => ({ managerId: manager.id, propertyId: property.id, title: `D${i}`, filePath: `documents/${i}.pdf`, fileName: "d.pdf", mimeType: "application/pdf", sizeBytes: 1 }))
    );

    const res = await deposer(manager, { propertyId: property.id, title: "Un de trop" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STORED_DOCUMENT_LIMIT");
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("retire le fichier du stockage si la ligne ne peut pas être enregistrée", async () => {
    const { manager, property } = await setup();
    vi.mocked(uploadPrivateFile).mockResolvedValue("documents/orphelin.pdf");
    const insertion = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("base indisponible");
    });

    const res = await deposer(manager, { propertyId: property.id, title: "ok" });

    insertion.mockRestore();
    expect(res.status).toBe(500);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/orphelin.pdf");
    expect(await testDb.select().from(storedDocuments)).toHaveLength(0);
  });
});

describe("GET /api/stored-documents", () => {
  it("liste les documents de l'agence, filtrables par bien, locataire et catégorie", async () => {
    const { manager, property, tenant } = await setup();
    await poser(manager.id, property.id, null, { category: "DIAGNOSTIC", title: "DPE" });
    await poser(manager.id, null, tenant.id, { category: "IDENTITY", title: "CNI" });
    const autre = await setup();
    await poser(autre.manager.id, autre.property.id, null);

    const tous = await request(app).get("/api/stored-documents").set(authHeader(tokenFor(manager)));
    const parBien = await request(app).get(`/api/stored-documents?propertyId=${property.id}`).set(authHeader(tokenFor(manager)));
    const parLocataire = await request(app).get(`/api/stored-documents?tenantId=${tenant.id}`).set(authHeader(tokenFor(manager)));
    const parCategorie = await request(app).get("/api/stored-documents?category=DIAGNOSTIC").set(authHeader(tokenFor(manager)));

    expect(tous.body.total).toBe(2);
    expect(parBien.body.items.map((d: { title: string }) => d.title)).toEqual(["DPE"]);
    expect(parLocataire.body.items.map((d: { title: string }) => d.title)).toEqual(["CNI"]);
    expect(parLocataire.body.items[0].tenantName).toBe("Awa Sow");
    expect(parCategorie.body.items).toHaveLength(1);
    expect(tous.body.items.every((d: { filePath?: string }) => d.filePath === undefined)).toBe(true);
  });
});

describe("GET /api/stored-documents/:id/link", () => {
  it("donne un lien temporaire, et refuse le document d'une autre agence", async () => {
    const { manager, property } = await setup();
    const doc = await poser(manager.id, property.id, null, { filePath: "documents/secret.pdf" });
    const intrus = await createManager();

    const ok = await request(app).get(`/api/stored-documents/${doc.id}/link`).set(authHeader(tokenFor(manager)));
    const refus = await request(app).get(`/api/stored-documents/${doc.id}/link`).set(authHeader(tokenFor(intrus)));

    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ url: "http://test.local/signed/abc.pdf", fileName: "x.pdf" });
    expect(getSignedUrl).toHaveBeenCalledWith("documents/secret.pdf", 300);
    expect(refus.status).toBe(404);
    expect(refus.body.code).toBe("STORED_DOCUMENT_NOT_FOUND");
  });
});

describe("PUT /api/stored-documents/:id", () => {
  it("corrige le titre, la catégorie, l'expiration (et la retire), sans toucher au fichier", async () => {
    const { manager, property } = await setup();
    const doc = await poser(manager.id, property.id, null, { expiresAt: new Date(2026, 5, 1) });

    const res = await request(app)
      .put(`/api/stored-documents/${doc.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Nouveau titre", category: "INSURANCE", expiresAt: null, notes: "À renouveler" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Nouveau titre", category: "INSURANCE", expiresAt: null, notes: "À renouveler" });
    expect(res.body.filePath).toBeUndefined();
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("remet le rappel d'expiration à zéro quand la date change, pas quand la même date est renvoyée", async () => {
    const { manager, property } = await setup();
    const envoye = new Date(2026, 4, 1);
    const doc = await poser(manager.id, property.id, null, { expiresAt: new Date(2026, 5, 1), reminderSentAt: envoye });
    const modifier = (corps: Record<string, unknown>) =>
      request(app).put(`/api/stored-documents/${doc.id}`).set(authHeader(tokenFor(manager))).send(corps);
    const marqueur = async () => (await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, doc.id)))[0].reminderSentAt;

    // Même jour renvoyé par le formulaire rouvert : le rappel déjà parti ne repart pas.
    expect((await modifier({ title: "Titre", expiresAt: new Date(2026, 5, 1).toISOString() })).status).toBe(200);
    expect(await marqueur()).not.toBeNull();

    // Un autre titre seul ne touche pas non plus au marqueur.
    expect((await modifier({ title: "Autre titre" })).status).toBe(200);
    expect(await marqueur()).not.toBeNull();

    // Document renouvelé : nouvelle date, donc de nouveau suivi.
    expect((await modifier({ expiresAt: new Date(2027, 5, 1).toISOString() })).status).toBe(200);
    expect(await marqueur()).toBeNull();
  });

  it("refuse le document d'une autre agence", async () => {
    const { property, manager } = await setup();
    const doc = await poser(manager.id, property.id, null);
    const intrus = await createManager();

    const res = await request(app).put(`/api/stored-documents/${doc.id}`).set(authHeader(tokenFor(intrus))).send({ title: "Piraté" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/stored-documents/:id", () => {
  it("supprime la ligne puis le fichier, et répond succès même si le stockage est indisponible", async () => {
    const { manager, property } = await setup();
    const doc = await poser(manager.id, property.id, null, { filePath: "documents/a-purger.pdf" });
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage indisponible"));

    const res = await request(app).delete(`/api/stored-documents/${doc.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, doc.id))).toHaveLength(0);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/a-purger.pdf");
  });

  it("refuse le document d'une autre agence", async () => {
    const { manager, property } = await setup();
    const doc = await poser(manager.id, property.id, null);
    const intrus = await createManager();

    const res = await request(app).delete(`/api/stored-documents/${doc.id}`).set(authHeader(tokenFor(intrus)));

    expect(res.status).toBe(404);
    expect(await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, doc.id))).toHaveLength(1);
  });
});

describe("nettoyage du stockage", () => {
  it("purge les fichiers d'un bien supprimé", async () => {
    const { manager, property } = await setup();
    await poser(manager.id, property.id, null, { filePath: "documents/bien.pdf" });

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/bien.pdf");
    expect(await testDb.select().from(storedDocuments)).toHaveLength(0);
  });

  it("purge les fichiers d'un locataire supprimé", async () => {
    const { manager, tenant } = await setup();
    await poser(manager.id, null, tenant.id, { filePath: "documents/loc.pdf" });

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/loc.pdf");
  });

  it("efface les documents d'un locataire anonymisé : la fiche reste, ses pièces non", async () => {
    const { manager, property, tenant } = await setup();
    await createContract(property.id, tenant.id);
    await poser(manager.id, null, tenant.id, { filePath: "documents/identite.pdf" });
    await poser(manager.id, property.id, null, { filePath: "documents/diagnostic-du-bien.pdf" });

    const res = await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/identite.pdf");
    expect(deleteStorageObjectBestEffort).not.toHaveBeenCalledWith("documents/diagnostic-du-bien.pdf");
    const restants = await testDb.select().from(storedDocuments);
    expect(restants.map((d: { filePath: string }) => d.filePath)).toEqual(["documents/diagnostic-du-bien.pdf"]);
  });
  it("purge tous les documents rangés quand l'agence supprime son compte", async () => {
    const { manager, property, tenant } = await setup();
    await poser(manager.id, property.id, null, { filePath: "documents/un.pdf" });
    await poser(manager.id, null, tenant.id, { filePath: "documents/deux.pdf" });

    const res = await request(app).delete("/api/auth/account").set(authHeader(tokenFor(manager))).send({ password: "Password123!" });

    expect(res.status).toBe(204);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/un.pdf");
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("documents/deux.pdf");
    expect(await testDb.select().from(storedDocuments)).toHaveLength(0);
  });
  it("efface le nom du locataire dans le journal d'activité de ses documents quand il est anonymisé", async () => {
    const { manager, property, tenant } = await setup();
    await createContract(property.id, tenant.id);
    const depot = await deposer(manager, { tenantId: tenant.id, title: "Passeport" });
    expect(depot.status).toBe(201);
    const avant = await testDb.select().from(activityLogs).where(eq(activityLogs.entityId, depot.body.id));
    expect(avant[0].details).toContain("Awa Sow");

    const res = await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const apres = await testDb.select().from(activityLogs).where(eq(activityLogs.entityId, depot.body.id));
    expect(apres[0].details).not.toContain("Awa Sow");
    expect(apres[0].details).toContain("Locataire anonymisé");
  });
});

describe("export des données d'un locataire", () => {
  it("décrit les documents rangés à son nom, sans jamais exposer le chemin du stockage", async () => {
    const { manager, property, tenant } = await setup();
    await createContract(property.id, tenant.id);
    await poser(manager.id, null, tenant.id, { title: "Titre de séjour", category: "IDENTITY", filePath: "documents/secret-chemin.pdf" });
    await poser(manager.id, property.id, null, { title: "Diagnostic du bien" });

    const res = await request(app).get(`/api/tenants/${tenant.id}/export`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.documentsRanges).toHaveLength(1);
    expect(res.body.documentsRanges[0]).toMatchObject({ title: "Titre de séjour", category: "IDENTITY" });
    expect(JSON.stringify(res.body)).not.toContain("secret-chemin");
  });
});
