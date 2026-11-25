import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import {
  activityLogs,
  contractCotenants,
  contractGuarantors,
  inspections,
  issueReports,
  messages,
  storedDocuments,
  tenants,
  users,
} from "../db/schema";
import * as exportService from "../services/exportDonnees.service";
import { fetchFiabiliteParLocataire } from "../services/reliability.service";
import { deleteStorageObjectBestEffort, getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import {
  authHeader,
  createContract,
  createInspection,
  createInvoice,
  createManager,
  createPortalUser,
  createProperty,
  createTenant,
  createTenantPortalUser,
  fakeJpegBuffer,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de tenant.controller.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les lacunes : les CODES et les messages des refus (le frontend traduit le code, l'utilisateur lit le message), les bornes du schéma,
 * la pagination et l'ordre de la liste, ce que le détail renvoie (jamais les images de signature), l'isolation entre locataires d'une même
 * agence (une requête sans filtre n'était vue que par un test qui en comptait deux), le contenu exact de chaque effacement de
 * l'anonymisation (garants, voix, documents, textes libres, journal), le nettoyage du stockage qui ne doit jamais faire échouer l'opération,
 * et l'accès au portail (compte réutilisé, mot de passe haché, journal sans secret).
 */

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn().mockResolvedValue("tenants/nouvelle-piece.jpg"),
  getSignedUrl: vi.fn().mockResolvedValue("http://test.local/signed/piece.pdf"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.mocked(uploadPrivateFile).mockClear().mockResolvedValue("tenants/nouvelle-piece.jpg");
  vi.mocked(getSignedUrl).mockClear().mockResolvedValue("http://test.local/signed/piece.pdf");
  vi.mocked(deleteStorageObjectBestEffort).mockReset().mockResolvedValue(undefined);
});

async function agence() {
  const manager = await createManager();
  return { manager, h: authHeader(tokenFor(manager)) };
}
const CORPS = { firstName: "Alice", lastName: "Martin", phone: "+33 6 12 34 56 78", email: "alice@test.local" };
const creer = (h: Record<string, string>, corps: Record<string, unknown> = {}) => request(app).post("/api/tenants").set(h).send({ ...CORPS, ...corps });
const journal = (managerId: string, action: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));
const JPEG = { filename: "piece.jpg", contentType: "image/jpeg" };
const PAGE_WEB = Buffer.from("<html><body><script>alert(1)</script></body></html>");
const DEGUISE = { filename: "photo.png", contentType: "image/png" };

/* ───────────────────────────── Schéma ───────────────────────────── */

describe("schéma d'un locataire", () => {
  it("un prénom ou un nom vide est refusé, un seul caractère suffit", async () => {
    const { h } = await agence();

    expect((await creer(h, { firstName: "" })).status).toBe(400);
    expect((await creer(h, { lastName: "" })).status).toBe(400);
    expect((await creer(h, { firstName: "A", lastName: "B", email: "ab@test.local" })).status).toBe(201);
  });

  it("la civilité peut être explicitement absente (null) : le document reste correct sans", async () => {
    const { h } = await agence();

    const res = await creer(h, { civility: null });

    expect(res.status).toBe(201);
    expect(res.body.civility).toBeNull();
  });

  it("un email de 254 caractères est accepté, de 255 refusé ; un email mal formé est refusé", async () => {
    const { h } = await agence();
    const email = (n: number) => `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(n)}.com`;

    expect(email(57)).toHaveLength(254);
    expect((await creer(h, { email: email(57) })).status).toBe(201);
    expect((await creer(h, { email: email(58) })).status).toBe(400);
    expect((await creer(h, { email: "pas-un-email" })).status).toBe(400);
  });

  it("l'email est enregistré sans casse ni espaces autour, et la langue doit être une langue connue", async () => {
    const { h } = await agence();

    const res = await creer(h, { email: "Alice.Martin@Test.LOCAL" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("alice.martin@test.local");

    expect((await creer(h, { email: "autre@test.local", language: "xx" })).status).toBe(400);
    expect((await creer(h, { email: "autre@test.local", language: "pt" })).body.language).toBe("pt");
  });
});

/* ───────────────────────────── Liste ───────────────────────────── */

describe("GET /api/tenants", () => {
  it("renvoie les locataires de l'agence, du plus récent au plus ancien, avec leur total (sans ceux d'une autre agence)", async () => {
    const { manager, h } = await agence();
    const { manager: autre } = await agence();
    const ancien = await createTenant(manager.id, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const milieu = await createTenant(manager.id, { createdAt: new Date("2026-02-01T00:00:00Z") });
    const recent = await createTenant(manager.id, { createdAt: new Date("2026-03-01T00:00:00Z") });
    await createTenant(autre.id, { createdAt: new Date("2026-04-01T00:00:00Z") });

    const res = await request(app).get("/api/tenants").set(h);

    expect(res.status).toBe(200);
    expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([recent.id, milieu.id, ancien.id]);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(1);
  });

  it("la taille de page et le numéro de page sont respectés", async () => {
    const { manager, h } = await agence();
    const a = await createTenant(manager.id, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const b = await createTenant(manager.id, { createdAt: new Date("2026-02-01T00:00:00Z") });
    const c = await createTenant(manager.id, { createdAt: new Date("2026-03-01T00:00:00Z") });

    const page1 = await request(app).get("/api/tenants?page=1&pageSize=2").set(h);
    const page2 = await request(app).get("/api/tenants?page=2&pageSize=2").set(h);

    expect(page1.body.items.map((t: { id: string }) => t.id)).toEqual([c.id, b.id]);
    expect(page2.body.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
    expect(page1.body.total).toBe(3);
    expect(page1.body.totalPages).toBe(2);
  });

  it("chaque ligne porte la fiabilité de SON locataire, et le locataire sans historique garde la sienne (celle de l'absence d'historique)", async () => {
    const { manager, h } = await agence();
    const property = await createProperty(manager.id);
    const sansHistorique = await createTenant(manager.id, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const avecHistorique = await createTenant(manager.id, { createdAt: new Date("2026-03-01T00:00:00Z") });
    const contrat = await createContract(property.id, avecHistorique.id);
    await createInvoice(contrat.id, { status: "PAID", dueDate: new Date(2026, 5, 20), paidAt: new Date(2026, 5, 28) });
    const fiabilites = await fetchFiabiliteParLocataire([avecHistorique.id, sansHistorique.id]);
    const attendu = fiabilites.get(avecHistorique.id);
    const attenduSans = fiabilites.get(sansHistorique.id);
    expect(attendu).toBeDefined();
    expect(attendu).not.toEqual(attenduSans);

    const res = await request(app).get("/api/tenants").set(h);

    const parId = new Map(res.body.items.map((t: { id: string; fiabilite?: unknown }) => [t.id, t]));
    expect((parId.get(avecHistorique.id) as { fiabilite: unknown }).fiabilite).toEqual(attendu);
    expect((parId.get(sansHistorique.id) as { fiabilite: unknown }).fiabilite).toEqual(attenduSans);
  });
});

/* ───────────────────────────── Détail ───────────────────────────── */

describe("GET /api/tenants/:id", () => {
  async function dossier() {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { title: "Villa Ngor" });
    const autreBien = await createProperty(manager.id, { title: "Studio Plateau" });
    const locataire = await createTenant(manager.id);
    const voisin = await createTenant(manager.id);
    const contrat = await createContract(bien.id, locataire.id, {
      signedByTenantAt: new Date(2026, 5, 4),
      tenantSignatureUrl: "data:image/png;base64,AAAA",
      signedByManagerAt: new Date(2026, 5, 3),
      managerSignatureUrl: "data:image/png;base64,BBBB",
      scannedContractUrl: "contrats/scan.pdf",
    });
    const contratVoisin = await createContract(autreBien.id, voisin.id);
    const [signalement] = await testDb
      .insert(issueReports)
      .values({ contractId: contrat.id, tenantId: locataire.id, title: "Fuite", description: "Robinet", photoUrl: "photos/a.jpg" })
      .returning();
    await testDb.insert(issueReports).values({ contractId: contratVoisin.id, tenantId: voisin.id, title: "Bruit", description: "Voisin", photoUrl: "photos/b.jpg" });
    return { manager, h, locataire, voisin, contrat, contratVoisin, signalement };
  }

  it("renvoie la fiche avec SES contrats (et leur bien), SES signalements et sa fiabilité, pas ceux d'un autre locataire", async () => {
    const { h, locataire, contrat, signalement } = await dossier();
    await createInvoice(contrat.id, { status: "PAID", dueDate: new Date(2026, 5, 20), paidAt: new Date(2026, 5, 20) });

    const res = await request(app).get(`/api/tenants/${locataire.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(locataire.id);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].id).toBe(contrat.id);
    expect(res.body.contracts[0].property.title).toBe("Villa Ngor");
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].id).toBe(signalement.id);
    expect(res.body.fiabilite).toEqual((await fetchFiabiliteParLocataire([locataire.id])).get(locataire.id));
  });

  it("ne renvoie jamais les images de signature des baux (500 000 caractères chacune), mais garde leurs dates", async () => {
    const { h, locataire } = await dossier();

    const res = await request(app).get(`/api/tenants/${locataire.id}`).set(h);

    const bail = res.body.contracts[0];
    expect(bail).not.toHaveProperty("tenantSignatureUrl");
    expect(bail).not.toHaveProperty("managerSignatureUrl");
    expect(bail.signedByTenantAt).toBeTruthy();
    expect(bail.signedByManagerAt).toBeTruthy();
  });

  it("le scan d'un bail est renvoyé sous une adresse signée ; une adresse complète reste telle quelle", async () => {
    const { h, locataire, contrat } = await dossier();

    const signe = await request(app).get(`/api/tenants/${locataire.id}`).set(h);
    expect(signe.body.contracts[0].scannedContractUrl).toBe("http://test.local/signed/piece.pdf");
    expect(vi.mocked(getSignedUrl)).toHaveBeenCalledWith("contrats/scan.pdf");

    await testDb.update((await import("../db/schema")).contracts).set({ scannedContractUrl: "https://stockage.example/scan.pdf" }).where(eq((await import("../db/schema")).contracts.id, contrat.id));
    const complet = await request(app).get(`/api/tenants/${locataire.id}`).set(h);
    expect(complet.body.contracts[0].scannedContractUrl).toBe("https://stockage.example/scan.pdf");
  });
});

/* ───────────────────────────── Création ───────────────────────────── */

describe("POST /api/tenants : codes, fichier, langue, agence, journal", () => {
  it("un email déjà pris dans l'agence est refusé : 409 TENANT_EMAIL_EXISTS et son message ; une autre agence peut l'utiliser", async () => {
    const { h } = await agence();
    const { h: autreH } = await agence();
    await creer(h);

    const doublon = await creer(h);

    expect(doublon.status).toBe(409);
    expect(doublon.body.code).toBe("TENANT_EMAIL_EXISTS");
    expect((await creer(autreH)).status).toBe(201);
  });

  it("la pièce d'identité est enregistrée sous le chemin renvoyé par le stockage, dans le dossier « tenants »", async () => {
    const { h } = await agence();

    const res = await request(app).post("/api/tenants").set(h).field(CORPS).attach("idDocument", fakeJpegBuffer("piece"), JPEG);

    expect(res.status).toBe(201);
    expect(res.body.idDocument).toBe("tenants/nouvelle-piece.jpg");
    expect(vi.mocked(uploadPrivateFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadPrivateFile).mock.calls[0][1]).toBe("tenants");
  });

  it("un fichier dont le contenu n'est pas celui déclaré est refusé avant tout dépôt", async () => {
    const { manager, h } = await agence();

    const res = await request(app).post("/api/tenants").set(h).field(CORPS).attach("idDocument", PAGE_WEB, DEGUISE);

    expect(res.status).toBe(400);
    expect(vi.mocked(uploadPrivateFile)).not.toHaveBeenCalled();
    expect(await testDb.select().from(tenants).where(eq(tenants.managerId, manager.id))).toHaveLength(0);
  });

  it("la langue des emails est celle choisie, sinon celle de l'interface du gestionnaire, sinon le français", async () => {
    const { h } = await agence();

    const choisie = await request(app).post("/api/tenants").set(h).set("Accept-Language", "pt").send({ ...CORPS, language: "en" });
    const interface_ = await request(app).post("/api/tenants").set(h).set("Accept-Language", "pt").send({ ...CORPS, email: "pt@test.local" });
    const defaut = await request(app).post("/api/tenants").set(h).send({ ...CORPS, email: "fr@test.local" });

    expect(choisie.body.language).toBe("en");
    expect(interface_.body.language).toBe("pt");
    expect(defaut.body.language).toBe("fr");
  });

  it("la fiche appartient toujours à l'agence du jeton, jamais à celle qu'un corps prétendrait", async () => {
    const { manager, h } = await agence();
    const { manager: autre } = await agence();

    const res = await creer(h, { managerId: autre.id });

    expect(res.body.managerId).toBe(manager.id);
  });

  it("trace la création dans le journal : action, type d'entité, fiche, libellé et détail", async () => {
    const { manager, h } = await agence();

    const res = await creer(h);

    const [ligne] = await journal(manager.id, "tenant.create");
    expect(ligne.entityType).toBe("tenant");
    expect(ligne.entityId).toBe(res.body.id);
    expect(ligne.entityLabel).toBe("Alice Martin");
    expect(ligne.details).toBe("Locataire ajouté : Alice Martin (alice@test.local)");
  });
});

/* ───────────────────────────── Modification ───────────────────────────── */

describe("PUT /api/tenants/:id", () => {
  it("la fiche d'un locataire anonymisé est figée : 409 TENANT_ANONYMIZED_LOCKED et son message", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { anonymizedAt: new Date() });

    const res = await request(app).put(`/api/tenants/${tenant.id}`).set(h).send({ firstName: "Nouveau" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_ANONYMIZED_LOCKED");
  });

  it("garder son propre email est permis ; prendre celui d'un AUTRE locataire de l'agence est refusé (409), celui d'une autre agence est permis", async () => {
    const { manager, h } = await agence();
    const { manager: autre } = await agence();
    const moi = await createTenant(manager.id, { email: "moi@test.local" });
    await createTenant(manager.id, { email: "voisin@test.local" });
    await createTenant(autre.id, { email: "ailleurs@test.local" });

    expect((await request(app).put(`/api/tenants/${moi.id}`).set(h).send({ email: "moi@test.local", firstName: "Moi" })).status).toBe(200);
    expect((await request(app).put(`/api/tenants/${moi.id}`).set(h).send({ email: "ailleurs@test.local" })).status).toBe(200);

    const conflit = await request(app).put(`/api/tenants/${moi.id}`).set(h).send({ email: "voisin@test.local" });
    expect(conflit.status).toBe(409);
    expect(conflit.body.code).toBe("TENANT_EMAIL_EXISTS");
  });

  it("ne modifie que la fiche visée, et seulement les champs envoyés", async () => {
    const { manager, h } = await agence();
    const cible = await createTenant(manager.id, { firstName: "Cible", lastName: "Un" });
    const autre = await createTenant(manager.id, { firstName: "Autre", lastName: "Deux" });

    const res = await request(app).put(`/api/tenants/${cible.id}`).set(h).send({ firstName: "Nouveau" });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe("Nouveau");
    expect(res.body.lastName).toBe("Un");
    const [intact] = await testDb.select().from(tenants).where(eq(tenants.id, autre.id));
    expect(intact.firstName).toBe("Autre");
  });

  it("un fichier dont le contenu n'est pas celui déclaré est refusé avant tout dépôt", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id);

    const res = await request(app).put(`/api/tenants/${tenant.id}`).set(h).attach("idDocument", PAGE_WEB, DEGUISE);

    expect(res.status).toBe(400);
    expect(vi.mocked(uploadPrivateFile)).not.toHaveBeenCalled();
  });

  it("une nouvelle pièce remplace l'ancienne, qui est retirée du stockage (jamais la nouvelle) ; sans fichier, la pièce reste", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { idDocument: "tenants/ancienne.jpg" });

    const sans = await request(app).put(`/api/tenants/${tenant.id}`).set(h).field({ firstName: "Sans" });
    expect(sans.body.idDocument).toBe("tenants/ancienne.jpg");
    expect(vi.mocked(deleteStorageObjectBestEffort)).not.toHaveBeenCalled();

    const avec = await request(app).put(`/api/tenants/${tenant.id}`).set(h).attach("idDocument", fakeJpegBuffer("neuve"), JPEG);
    expect(avec.status).toBe(200);
    expect(avec.body.idDocument).toBe("tenants/nouvelle-piece.jpg");
    expect(vi.mocked(deleteStorageObjectBestEffort).mock.calls.map((a) => a[0])).toEqual(["tenants/ancienne.jpg"]);
  });

  it("une première pièce (sans ancienne) n'appelle aucun nettoyage du stockage", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id);

    const res = await request(app).put(`/api/tenants/${tenant.id}`).set(h).attach("idDocument", fakeJpegBuffer("premiere"), JPEG);

    expect(res.status).toBe(200);
    expect(vi.mocked(deleteStorageObjectBestEffort)).not.toHaveBeenCalled();
  });

  it("trace la modification dans le journal : action, type d'entité et détail", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { firstName: "Alice", lastName: "Martin" });

    await request(app).put(`/api/tenants/${tenant.id}`).set(h).send({ phone: "+33 6 12 34 56 78" });

    const [ligne] = await journal(manager.id, "tenant.update");
    expect(ligne.entityType).toBe("tenant");
    expect(ligne.entityId).toBe(tenant.id);
    expect(ligne.entityLabel).toBe("Alice Martin");
    expect(ligne.details).toBe("Locataire modifié : Alice Martin");
  });
});

/* ───────────────────────────── Export ───────────────────────────── */

describe("export des données d'un locataire", () => {
  it("le gestionnaire reçoit un fichier JSON en pièce jointe, lisible (indenté), et l'export est tracé avec le nom de la personne", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { firstName: "Alice", lastName: "Martin" });

    const res = await request(app).get(`/api/tenants/${tenant.id}/export`).set(h);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${exportService.nomFichierExport(tenant)}"`);
    expect(res.text).toBe(JSON.stringify(JSON.parse(res.text), null, 2));
    const [ligne] = await journal(manager.id, "tenant.export");
    expect(ligne.entityLabel).toBe("Alice Martin");
    expect(ligne.details).toBe("Export des données personnelles de Alice Martin");
  });

  it("un dossier que le service ne sait pas construire répond 404 « Locataire introuvable »", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id);
    const espion = vi.spyOn(exportService, "construireExportLocataire").mockResolvedValueOnce(null as never);

    const res = await request(app).get(`/api/tenants/${tenant.id}/export`).set(h);
    espion.mockRestore();

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TENANT_NOT_FOUND");
  });

  it("le locataire exporte SA fiche par son compte ; sans fiche rattachée, 403 TENANT_NOT_LINKED, même si d'autres fiches existent", async () => {
    const { manager } = await agence();
    const sa = await createTenant(manager.id);
    const compte = await createTenantPortalUser(sa);
    await createTenant(manager.id);

    const ok = await request(app).get("/api/tenants/mine/export").set(authHeader(tokenFor(compte, sa.id)));
    expect(ok.status).toBe(200);

    const sansFiche = await createPortalUser("TENANT");
    const refus = await request(app).get("/api/tenants/mine/export").set(authHeader(tokenFor(sansFiche)));
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe("TENANT_NOT_LINKED");
  });
});

/* ───────────────────────────── Anonymisation ───────────────────────────── */

describe("anonymisation d'un locataire : ce qui est effacé, et rien d'autre", () => {
  const EMAIL = "moussa.ba@test.local";
  const TEL = "+221770001122";

  async function dossier() {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id);
    const autreBien = await createProperty(manager.id);
    const locataire = await createTenant(manager.id, { firstName: "Moussa", lastName: "Ba", email: EMAIL, phone: TEL, idDocument: "tenants/piece.jpg" });
    const voisin = await createTenant(manager.id, { firstName: "Fama", lastName: "Seck" });
    const compte = await createTenantPortalUser(locataire);
    const compteVoisin = await createTenantPortalUser(voisin);
    const contrat = await createContract(bien.id, locataire.id, { status: "ENDED" });
    const contratVoisin = await createContract(autreBien.id, voisin.id);
    const factureVoisin = await createInvoice(contratVoisin.id);
    const inspection = await createInspection(contrat, manager.id, {
      tenantSignatureUrl: "data:image/png;base64,AAAA",
      generalComments: "Moussa Ba a rendu les clés",
      roomsData: "Salon propre — Moussa Ba",
      metersData: "Compteur relevé par Moussa Ba",
      keysData: "2 clés remises à Moussa Ba",
    });
    const inspectionVoisin = await createInspection(contratVoisin, manager.id, {
      tenantSignatureUrl: "data:image/png;base64,BBBB",
      generalComments: "Moussa Ba cité par erreur",
    });
    const [garant] = await testDb
      .insert(contractGuarantors)
      .values({ contractId: contrat.id, civility: "M", firstName: "Omar", lastName: "Ndiaye", phone: "+221770009999", email: "omar@test.local", address: "5 rue Blanchot", notes: "Oncle" })
      .returning();
    const [garantVoisin] = await testDb
      .insert(contractGuarantors)
      .values({ contractId: contratVoisin.id, firstName: "Awa", lastName: "Fall", phone: "+221770008888", email: "awa@test.local", address: "Thiès", notes: "Tante" })
      .returning();
    const [signalement] = await testDb
      .insert(issueReports)
      .values({ contractId: contrat.id, tenantId: locataire.id, title: "Fuite chez Moussa Ba", description: `Joindre ${EMAIL} ou ${TEL}`, managerNote: `Appeler ${TEL}`, photoUrl: "photos/a.jpg" })
      .returning();
    const [document] = await testDb
      .insert(storedDocuments)
      .values({ managerId: manager.id, tenantId: locataire.id, title: "Assurance", filePath: "docs/assurance.pdf", fileName: "assurance.pdf", mimeType: "application/pdf", sizeBytes: 10 })
      .returning();
    const [documentVoisin] = await testDb
      .insert(storedDocuments)
      .values({ managerId: manager.id, tenantId: voisin.id, title: "Bail", filePath: "docs/bail-voisin.pdf", fileName: "bail.pdf", mimeType: "application/pdf", sizeBytes: 10 })
      .returning();
    const [voix] = await testDb
      .insert(messages)
      .values({ contractId: contrat.id, senderId: manager.id, senderRole: "TENANT", tenantId: locataire.id, content: "", audioPath: "audio/locataire.webm", audioMime: "audio/webm", audioDurationSec: 5 })
      .returning();
    const [voixGestionnaire] = await testDb
      .insert(messages)
      .values({ contractId: contrat.id, senderId: manager.id, senderRole: "MANAGER", tenantId: locataire.id, content: "", audioPath: "audio/gestionnaire.webm", audioMime: "audio/webm", audioDurationSec: 7 })
      .returning();
    const nom = "Moussa Ba";
    const entree = (entityType: string, entityId: string | null, details: string) => ({
      managerId: manager.id,
      actorLabel: "Gestionnaire",
      action: `${entityType}.test`,
      entityType,
      entityId,
      entityLabel: `${entityType} — ${nom}`,
      details,
    });
    await testDb.insert(activityLogs).values([
      entree("tenant", locataire.id, `Locataire ajouté : ${nom} (${EMAIL})`),
      entree("contract", contrat.id, `Contrat pour ${nom}`),
      entree("issue", signalement.id, `Signalement de ${nom}`),
      entree("document", document.id, `Document ajouté : Assurance — ${nom}`),
      entree("invoice", factureVoisin.id, `Facture du voisin, mentionne ${nom} par erreur`),
    ]);
    return { manager, h, bien, locataire, voisin, compte, compteVoisin, contrat, contratVoisin, inspection, inspectionVoisin, garant, garantVoisin, signalement, document, documentVoisin, voix, voixGestionnaire, factureVoisin, nom };
  }

  const anonymiser = (h: Record<string, string>, id: string) => request(app).post(`/api/tenants/${id}/anonymiser`).set(h);

  it("répond 200 avec son message, et trace l'anonymisation sans le nom réel (type, libellé et détail)", async () => {
    const { manager, h, locataire } = await dossier();

    const res = await anonymiser(h, locataire.id);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(
      "Les données identifiantes de ce locataire ont été effacées. Son historique de contrats et de paiements est conservé, comme l'exige la réglementation comptable."
    );
    const [ligne] = await journal(manager.id, "tenant.anonymize");
    expect(ligne.entityType).toBe("tenant");
    expect(ligne.entityId).toBe(locataire.id);
    expect(ligne.entityLabel).toBe("Locataire anonymisé");
    expect(ligne.details).toBe("Données identifiantes effacées à la demande du locataire (droit à l'effacement). L'historique locatif et comptable est conservé.");
  });

  it("la fiche perd son rattachement au compte du portail, et chaque fiche anonymisée garde une adresse unique", async () => {
    const { h, locataire, voisin } = await dossier();

    expect((await anonymiser(h, locataire.id)).status).toBe(200);
    expect((await anonymiser(h, voisin.id)).status).toBe(200);

    const [apres] = await testDb.select().from(tenants).where(eq(tenants.id, locataire.id));
    const [apresVoisin] = await testDb.select().from(tenants).where(eq(tenants.id, voisin.id));
    expect(apres.userId).toBeNull();
    expect(apres.email).toBe(`anonyme-${locataire.id}@supprime.invalid`);
    expect(apresVoisin.email).toBe(`anonyme-${voisin.id}@supprime.invalid`);
  });

  it("supprime SES documents rangés et le seul compte du portail du locataire, pas ceux d'un voisin ni le gestionnaire", async () => {
    const { manager, h, locataire, compte, compteVoisin, document, documentVoisin } = await dossier();

    await anonymiser(h, locataire.id);

    expect(await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, document.id))).toHaveLength(0);
    expect(await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, documentVoisin.id))).toHaveLength(1);
    expect(await testDb.select().from(users).where(eq(users.id, compte.id))).toHaveLength(0);
    expect(await testDb.select().from(users).where(eq(users.id, compteVoisin.id))).toHaveLength(1);
    expect(await testDb.select().from(users).where(eq(users.id, manager.id))).toHaveLength(1);
  });

  it("un locataire sans compte du portail s'anonymise aussi", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id);

    const res = await anonymiser(h, tenant.id);

    expect(res.status).toBe(200);
    expect(await testDb.select().from(users).where(eq(users.id, manager.id))).toHaveLength(1);
  });

  it("efface TOUTES les données de ses garants (civilité, nom, téléphone, email, adresse, notes), pas ceux d'un autre bail", async () => {
    const { h, locataire, garant, garantVoisin } = await dossier();

    await anonymiser(h, locataire.id);

    const [efface] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, garant.id));
    expect(efface).toMatchObject({ civility: null, firstName: "Garant", lastName: "anonymisé", phone: "", email: null, address: null, notes: null });
    const [intact] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, garantVoisin.id));
    expect(intact).toMatchObject({ firstName: "Awa", lastName: "Fall", phone: "+221770008888", email: "awa@test.local", address: "Thiès", notes: "Tante" });
  });

  it("efface la signature de ses états des lieux, pas celle des états des lieux d'un autre locataire", async () => {
    const { h, locataire, inspection, inspectionVoisin } = await dossier();

    await anonymiser(h, locataire.id);

    const [efface] = await testDb.select().from(inspections).where(eq(inspections.id, inspection.id));
    const [intact] = await testDb.select().from(inspections).where(eq(inspections.id, inspectionVoisin.id));
    expect(efface.tenantSignatureUrl).toBeNull();
    expect(intact.tenantSignatureUrl).toBe("data:image/png;base64,BBBB");
  });

  it("efface ses messages vocaux (fichier ET type), conserve ceux du gestionnaire, et retire les fichiers du stockage", async () => {
    const { h, locataire, voix, voixGestionnaire } = await dossier();

    await anonymiser(h, locataire.id);

    const [efface] = await testDb.select().from(messages).where(eq(messages.id, voix.id));
    expect(efface.audioPath).toBeNull();
    expect(efface.audioMime).toBeNull();
    expect(efface.audioDurationSec).toBe(5);
    const [intact] = await testDb.select().from(messages).where(eq(messages.id, voixGestionnaire.id));
    expect(intact.audioPath).toBe("audio/gestionnaire.webm");
    expect(intact.audioMime).toBe("audio/webm");
    const supprimes = vi.mocked(deleteStorageObjectBestEffort).mock.calls.map((a) => a[0]);
    expect(supprimes).toContain("audio/locataire.webm");
    expect(supprimes).not.toContain("audio/gestionnaire.webm");
  });

  it("retire du stockage la pièce d'identité ET ses documents rangés", async () => {
    const { h, locataire, voisin } = await dossier();

    await anonymiser(h, locataire.id);

    const supprimes = vi.mocked(deleteStorageObjectBestEffort).mock.calls.map((a) => a[0]);
    expect(supprimes).toContain("tenants/piece.jpg");
    expect(supprimes).toContain("docs/assurance.pdf");
    expect(supprimes).not.toContain("docs/bail-voisin.pdf");
    expect(voisin.idDocument).toBeNull();
  });

  it("un stockage indisponible n'annule jamais une anonymisation déjà enregistrée", async () => {
    const { h, locataire } = await dossier();
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage indisponible"));

    const res = await anonymiser(h, locataire.id);

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(tenants).where(eq(tenants.id, locataire.id));
    expect(apres.anonymizedAt).not.toBeNull();
  });

  it("remplace dans les textes libres son email et son téléphone (« adresse effacée », « numéro effacé »), et son nom dans les états des lieux", async () => {
    const { h, locataire, signalement, inspection } = await dossier();

    await anonymiser(h, locataire.id);

    const [issue] = await testDb.select().from(issueReports).where(eq(issueReports.id, signalement.id));
    expect(issue.title).toBe("Fuite chez Locataire anonymisé");
    expect(issue.description).toBe("Joindre adresse effacée ou numéro effacé");
    expect(issue.managerNote).toBe("Appeler numéro effacé");
    const [edl] = await testDb.select().from(inspections).where(eq(inspections.id, inspection.id));
    expect(edl.generalComments).toBe("Locataire anonymisé a rendu les clés");
    expect(edl.roomsData).toBe("Salon propre — Locataire anonymisé");
    expect(edl.metersData).toBe("Compteur relevé par Locataire anonymisé");
    expect(edl.keysData).toBe("2 clés remises à Locataire anonymisé");
  });

  it("ne touche pas aux textes des états des lieux d'un autre locataire, même s'ils citent le nom effacé", async () => {
    const { h, locataire, inspectionVoisin } = await dossier();

    await anonymiser(h, locataire.id);

    const [intact] = await testDb.select().from(inspections).where(eq(inspections.id, inspectionVoisin.id));
    expect(intact.generalComments).toBe("Moussa Ba cité par erreur");
  });

  it("efface le nom dans le journal de la fiche, du contrat, du signalement et du document, mais pas dans celui de la facture d'un autre bail", async () => {
    const { manager, h, locataire, nom } = await dossier();

    await anonymiser(h, locataire.id);

    const lignes = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    for (const type of ["tenant", "contract", "issue", "document"]) {
      const ligne = lignes.find((l: typeof activityLogs.$inferSelect) => l.entityType === type && l.action === `${type}.test`)!;
      expect(ligne.entityLabel, `libellé ${type}`).not.toContain(nom);
      expect(ligne.details ?? "", `détail ${type}`).not.toContain(nom);
      expect(ligne.entityLabel).toContain("Locataire anonymisé");
    }
    const factureVoisin = lignes.find((l: typeof activityLogs.$inferSelect) => l.entityType === "invoice")!;
    expect(factureVoisin.details).toContain(nom);
    expect(factureVoisin.entityLabel).toContain(nom);
  });

  it("répond 409 TENANT_ALREADY_ANONYMIZED avec son message à une seconde demande", async () => {
    const { h, locataire } = await dossier();
    await anonymiser(h, locataire.id);

    const res = await anonymiser(h, locataire.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_ALREADY_ANONYMIZED");
  });
});

/* ───────────────────────────── Suppression ───────────────────────────── */

describe("DELETE /api/tenants/:id : les refus et leur contenu", () => {
  const supprimer = (h: Record<string, string>, id: string) => request(app).delete(`/api/tenants/${id}`).set(h);

  it("un contrat actif : 409 TENANT_HAS_ACTIVE_CONTRACT et son message", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(bien.id, tenant.id, { status: "ACTIVE" });

    const res = await supprimer(h, tenant.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_HAS_ACTIVE_CONTRACT");
  });

  it("un historique de contrats (même terminé) : 409 TENANT_HAS_CONTRACT_HISTORY et son message", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(bien.id, tenant.id, { status: "ENDED" });

    const res = await supprimer(h, tenant.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_HAS_CONTRACT_HISTORY");
  });

  it("un colocataire d'un bail : 409 TENANT_IS_COTENANT ; un locataire qui ne l'est pas n'est pas refusé parce qu'un autre l'est", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id);
    const titulaire = await createTenant(manager.id);
    const colocataire = await createTenant(manager.id);
    const libre = await createTenant(manager.id);
    const contrat = await createContract(bien.id, titulaire.id);
    await testDb.insert(contractCotenants).values({ contractId: contrat.id, tenantId: colocataire.id });

    const refus = await supprimer(h, colocataire.id);
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe("TENANT_IS_COTENANT");

    expect((await supprimer(h, libre.id)).status).toBe(204);
  });

  it("des signalements d'incident : 409 TENANT_HAS_ISSUES ; ceux d'un autre locataire ne comptent pas", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id);
    const autre = await createTenant(manager.id);
    const contratAutre = await createContract(bien.id, autre.id);
    const avecSignalement = await createTenant(manager.id);
    const libre = await createTenant(manager.id);
    await testDb.insert(issueReports).values({ contractId: contratAutre.id, tenantId: avecSignalement.id, title: "Fuite", description: "x", photoUrl: "p.jpg" });

    const refus = await supprimer(h, avecSignalement.id);
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe("TENANT_HAS_ISSUES");

    expect((await supprimer(h, libre.id)).status).toBe(204);
  });

  it("un locataire sans historique est supprimé (204) SEUL, avec sa pièce et ses documents retirés du stockage, et l'action est tracée", async () => {
    const { manager, h } = await agence();
    const cible = await createTenant(manager.id, { firstName: "Alice", lastName: "Martin", idDocument: "tenants/piece.jpg" });
    const autre = await createTenant(manager.id);
    await testDb.insert(storedDocuments).values({ managerId: manager.id, tenantId: cible.id, title: "Assurance", filePath: "docs/assurance.pdf", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 });

    const res = await supprimer(h, cible.id);

    expect(res.status).toBe(204);
    expect(await testDb.select().from(tenants).where(eq(tenants.id, cible.id))).toHaveLength(0);
    expect(await testDb.select().from(tenants).where(eq(tenants.id, autre.id))).toHaveLength(1);
    const supprimes = vi.mocked(deleteStorageObjectBestEffort).mock.calls.map((a) => a[0]);
    expect(supprimes).toContain("tenants/piece.jpg");
    expect(supprimes).toContain("docs/assurance.pdf");
    const [ligne] = await journal(manager.id, "tenant.delete");
    expect(ligne.entityLabel).toBe("Alice Martin");
    expect(ligne.details).toBe("Locataire supprimé : Alice Martin");
  });

  it("un stockage indisponible ne fait pas échouer une suppression déjà enregistrée", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { idDocument: "tenants/piece.jpg" });
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage indisponible"));

    const res = await supprimer(h, tenant.id);

    expect(res.status).toBe(204);
  });

  it("un bail créé entre le contrôle et l'écriture (violation de clé 23503) répond 409 TENANT_HAS_CONTRACT_HISTORY, pas une panne ; toute autre erreur reste une panne", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id);
    const refuser = (erreur: unknown) => vi.spyOn(db, "delete").mockImplementationOnce((() => ({ where: () => Promise.reject(erreur) })) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    refuser({ code: "23503" });
    const course = await supprimer(h, tenant.id);
    expect(course.status).toBe(409);
    expect(course.body.code).toBe("TENANT_HAS_CONTRACT_HISTORY");

    refuser({ cause: { code: "23503" } });
    expect((await supprimer(h, tenant.id)).status).toBe(409);

    refuser({ code: "23505" });
    expect((await supprimer(h, tenant.id)).status).toBe(500);

    refuser(new Error("base indisponible"));
    expect((await supprimer(h, tenant.id)).status).toBe(500);
    vi.mocked(console.error).mockRestore();
    expect(await testDb.select().from(tenants).where(eq(tenants.id, tenant.id))).toHaveLength(1);
  });
});

/* ───────────────────────────── Pièce d'identité ───────────────────────────── */

describe("GET /api/tenants/:id/id-document-url", () => {
  it("le lien est signé pour 300 secondes, renvoyé dans « url », et la consultation est tracée avec le nom", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { firstName: "Alice", lastName: "Martin", idDocument: "tenants/piece.jpg" });

    const res = await request(app).get(`/api/tenants/${tenant.id}/id-document-url`).set(h);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "http://test.local/signed/piece.pdf" });
    expect(vi.mocked(getSignedUrl)).toHaveBeenCalledWith("tenants/piece.jpg", 300);
    const [ligne] = await journal(manager.id, "tenant.id_document_view");
    expect(ligne.details).toBe("Pièce d'identité de Alice Martin consultée");
  });

  it("une fiche sans pièce : 404 TENANT_NO_ID_DOCUMENT ; la fiche d'une autre agence : 404 TENANT_NOT_FOUND, sans lien signé", async () => {
    const { manager, h } = await agence();
    const { manager: autre } = await agence();
    const sansPiece = await createTenant(manager.id);
    const ailleurs = await createTenant(autre.id, { idDocument: "tenants/secret.jpg" });

    const absente = await request(app).get(`/api/tenants/${sansPiece.id}/id-document-url`).set(h);
    expect(absente.status).toBe(404);
    expect(absente.body.code).toBe("TENANT_NO_ID_DOCUMENT");

    const etrangere = await request(app).get(`/api/tenants/${ailleurs.id}/id-document-url`).set(h);
    expect(etrangere.status).toBe(404);
    expect(etrangere.body.code).toBe("TENANT_NOT_FOUND");
    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────── Accès au portail ───────────────────────────── */

describe("POST /api/tenants/:id/portal-account", () => {
  const MOT_DE_PASSE = "Un-mot-de-passe-solide-2026";
  const creerAcces = (h: Record<string, string>, id: string, password: unknown = MOT_DE_PASSE) => request(app).post(`/api/tenants/${id}/portal-account`).set(h).send({ password });

  it("crée un compte locataire, relié à CETTE fiche seule, au mot de passe haché (coût 10), et trace le geste sans secret", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { firstName: "Alice", lastName: "Martin", email: "alice.portail@test.local" });
    const autre = await createTenant(manager.id);

    const res = await creerAcces(h, tenant.id);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Accès portail créé");
    expect(res.body.email).toBe("alice.portail@test.local");
    const [compte] = await testDb.select().from(users).where(eq(users.email, "alice.portail@test.local"));
    expect(res.body.userId).toBe(compte.id);
    expect(res.body.userId).not.toBe(tenant.id);
    expect(compte.role).toBe("TENANT");
    expect(compte.passwordHash).not.toBe(MOT_DE_PASSE);
    expect(await bcrypt.compare(MOT_DE_PASSE, compte.passwordHash)).toBe(true);
    expect(bcrypt.getRounds(compte.passwordHash)).toBe(10);
    const [fiche] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    const [ficheAutre] = await testDb.select().from(tenants).where(eq(tenants.id, autre.id));
    expect(fiche.userId).toBe(compte.id);
    expect(ficheAutre.userId).toBeNull();
    const [ligne] = await journal(manager.id, "tenant.portal_account");
    expect(ligne.entityType).toBe("tenant");
    expect(ligne.entityId).toBe(tenant.id);
    expect(ligne.details).toBe("Accès au portail créé pour Alice Martin");
    expect(JSON.stringify(ligne)).not.toContain(MOT_DE_PASSE);
  });

  it("réutilise un compte locataire orphelin de même adresse : mot de passe changé, sessions révoquées, relié à cette fiche seule, geste tracé", async () => {
    const { manager, h } = await agence();
    const orphelin = await createPortalUser("TENANT");
    const tenant = await createTenant(manager.id, { firstName: "Alice", lastName: "Martin", email: orphelin.email });
    const autre = await createTenant(manager.id);

    const res = await creerAcces(h, tenant.id);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Accès portail créé");
    expect(res.body.userId).toBe(orphelin.id);
    expect(res.body.email).toBe(orphelin.email);
    const [compte] = await testDb.select().from(users).where(eq(users.id, orphelin.id));
    expect(await bcrypt.compare(MOT_DE_PASSE, compte.passwordHash)).toBe(true);
    expect(compte.passwordHash).not.toBe(orphelin.passwordHash);
    expect(compte.tokenVersion).toBe(orphelin.tokenVersion + 1);
    const [fiche] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    const [ficheAutre] = await testDb.select().from(tenants).where(eq(tenants.id, autre.id));
    expect(fiche.userId).toBe(orphelin.id);
    expect(ficheAutre.userId).toBeNull();
    const [ligne] = await journal(manager.id, "tenant.portal_account");
    expect(ligne.details).toBe("Accès au portail créé pour Alice Martin");
  });

  it("un compte réutilisé ne modifie pas les autres comptes", async () => {
    const { manager, h } = await agence();
    const orphelin = await createPortalUser("TENANT");
    const autreCompte = await createPortalUser("TENANT");
    const tenant = await createTenant(manager.id, { email: orphelin.email });

    await creerAcces(h, tenant.id);

    const [intact] = await testDb.select().from(users).where(eq(users.id, autreCompte.id));
    expect(intact.passwordHash).toBe(autreCompte.passwordHash);
    expect(intact.tokenVersion).toBe(autreCompte.tokenVersion);
  });

  it("un compte qui existe déjà pour cette adresse (gestionnaire, ou locataire déjà rattaché) : 409 ACCOUNT_EMAIL_EXISTS et son message", async () => {
    const { manager, h } = await agence();
    const gestionnaire = await createManager();
    const rattache = await createPortalUser("TENANT");
    const ficheRattachee = await createTenant(manager.id);
    await testDb.update(tenants).set({ userId: rattache.id }).where(eq(tenants.id, ficheRattachee.id));
    const t1 = await createTenant(manager.id, { email: gestionnaire.email });
    const t2 = await createTenant(manager.id, { email: rattache.email });

    for (const tenant of [t1, t2]) {
      const res = await creerAcces(h, tenant.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ACCOUNT_EMAIL_EXISTS");
    }
  });

  it("le corps est validé APRÈS l'appartenance : un corps mal formé visant l'agence voisine répond 404, comme un identifiant inventé", async () => {
    const { h } = await agence();
    const { manager: autre } = await agence();
    const ailleurs = await createTenant(autre.id);

    const res = await creerAcces(h, ailleurs.id, "court");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TENANT_NOT_FOUND");
  });

  it("un mot de passe trop court, ou identique à l'adresse du locataire, est refusé", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { email: "alice.portail@test.local" });

    expect((await creerAcces(h, tenant.id, "court")).status).toBe(400);
    const identique = await creerAcces(h, tenant.id, "alice.portail@test.local");
    expect(identique.status).toBe(400);
    expect(await testDb.select().from(users).where(eq(users.email, "alice.portail@test.local"))).toHaveLength(0);
  });

  it("une fiche anonymisée ne reçoit pas d'accès : 409 TENANT_ANONYMIZED_LOCKED", async () => {
    const { manager, h } = await agence();
    const tenant = await createTenant(manager.id, { anonymizedAt: new Date() });

    const res = await creerAcces(h, tenant.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_ANONYMIZED_LOCKED");
  });
});
