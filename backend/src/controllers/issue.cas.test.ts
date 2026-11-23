import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { activityLogs, agencySettings, contractStatusEnum, contracts, issueReports } from "../db/schema";
import * as emailService from "../services/email.service";
import { issueStatusUpdateEmail } from "../services/email.service";
import { oublierAdressesDeReponse } from "../services/reponseAgence.service";
import * as storageService from "../services/storage.service";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  createVendor,
  fakeJpegBuffer,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Cas limites des signalements d'incidents (issue.controller.ts), trouvés en sabotant le contrôleur : chaque test ci-dessous
 * échoue si la ligne qu'il garde est modifiée, alors que les tests existants passaient tous.
 */

let envoi: ReturnType<typeof vi.spyOn>;
let signe: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  oublierAdressesDeReponse();
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  signe = vi
    .spyOn(storageService, "getSignedUrls")
    .mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://signed.test/${c}`] as const)));
});
afterEach(() => vi.restoreAllMocks());

async function monde(tenantExtra: Record<string, unknown> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Baobab" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa.sow@test.local", ...tenantExtra });
  const contract = await createContract(property.id, tenant.id);
  const vendor = await createVendor(manager.id, { name: "Plomberie Diop" });
  const h = authHeader(tokenFor(manager));
  const issue = async (extra: Partial<typeof issueReports.$inferInsert> = {}) => {
    const [ligne] = await testDb
      .insert(issueReports)
      .values({ contractId: contract.id, tenantId: tenant.id, title: "Fuite", description: "Fuite sous l'évier", photoUrl: "issues/p.jpg", ...extra })
      .returning();
    return ligne;
  };
  const jeton = async () => authHeader(await tokenLocataire(tenant.id));
  return { manager, property, tenant, contract, vendor, h, issue, jeton };
}

const journal = (managerId: string) =>
  testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, "issue.update_status")));

describe("Incidents — liste du gestionnaire", () => {
  it("ignore un statut inconnu dans la requête au lieu d'échouer", async () => {
    const { h, issue } = await monde();
    await issue();

    const res = await request(app).get("/api/issues?status=BIDON").set(h);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("liste du plus récent au plus ancien, page par page, et le total suit le filtre de statut", async () => {
    const { h, issue } = await monde();
    const ancien = await issue({ title: "Ancien", status: "OPEN", createdAt: new Date(2026, 0, 1) });
    const milieu = await issue({ title: "Milieu", status: "OPEN", createdAt: new Date(2026, 1, 1) });
    const recent = await issue({ title: "Récent", status: "RESOLVED", createdAt: new Date(2026, 2, 1) });
    const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

    const tout = await request(app).get("/api/issues").set(h);
    const page2 = await request(app).get("/api/issues?page=2&pageSize=1").set(h);
    const deux = await request(app).get("/api/issues?pageSize=2").set(h);
    const ouverts = await request(app).get("/api/issues?status=OPEN").set(h);

    expect(ids(tout)).toEqual([recent.id, milieu.id, ancien.id]);
    expect(tout.body.total).toBe(3);
    expect(ids(page2)).toEqual([milieu.id]);
    expect(page2.body.total).toBe(3);
    expect(deux.body.items).toHaveLength(2);
    expect(ids(ouverts)).toEqual([milieu.id, ancien.id]);
    expect(ouverts.body.total).toBe(2);
  });
});

describe("Incidents — signature des photos", () => {
  it("laisse telles quelles les URL complètes (majuscules comprises), écarte les entrées vides et ne touche pas un champ illisible", async () => {
    const { h, issue } = await monde();
    await issue({ title: "Mixte", photoUrl: "HTTPS://cdn.test/A.jpg", additionalPhotos: JSON.stringify(["https://cdn.test/b.jpg", "issues/c.jpg", ""]) });
    await issue({ title: "Sans supplémentaires", photoUrl: "issues/e.jpg", additionalPhotos: null });
    await issue({ title: "Objet", photoUrl: "http://cdn.test/o.jpg", additionalPhotos: '{"a":1}' });
    await issue({ title: "Illisible", photoUrl: "http://cdn.test/i.jpg", additionalPhotos: "pas du json" });

    const res = await request(app).get("/api/issues").set(h);

    expect(res.status).toBe(200);
    const parTitre = Object.fromEntries(res.body.items.map((i: { title: string }) => [i.title, i]));
    expect(parTitre["Mixte"].photoUrl).toBe("HTTPS://cdn.test/A.jpg");
    expect(JSON.parse(parTitre["Mixte"].additionalPhotos)).toEqual(["https://cdn.test/b.jpg", "https://signed.test/issues/c.jpg"]);
    expect(parTitre["Sans supplémentaires"].photoUrl).toBe("https://signed.test/issues/e.jpg");
    expect(parTitre["Sans supplémentaires"].additionalPhotos).toBeNull();
    expect(parTitre["Objet"].additionalPhotos).toBe('{"a":1}');
    expect(parTitre["Illisible"].additionalPhotos).toBe("pas du json");
    // Seuls les chemins du stockage sont signés : jamais une URL complète.
    expect(signe).toHaveBeenCalledTimes(1);
    expect([...signe.mock.calls[0][0]].sort()).toEqual(["issues/c.jpg", "issues/e.jpg"]);
  });
});

describe("Incidents — liste du locataire", () => {
  it("liste du plus récent au plus ancien", async () => {
    const { issue, jeton } = await monde();
    const ancien = await issue({ title: "Ancien", createdAt: new Date(2026, 0, 1) });
    const recent = await issue({ title: "Récent", createdAt: new Date(2026, 5, 1) });

    const res = await request(app).get("/api/issues/mine").set(await jeton());

    expect(res.body.map((i: { id: string }) => i.id)).toEqual([recent.id, ancien.id]);
  });
});

describe("PUT /api/issues/:id/status — validation", () => {
  it("refuse un prestataire vide et une planification sans prestataire (avec son code)", async () => {
    const { h, issue } = await monde();
    const incident = await issue();

    const vide = await request(app).put(`/api/issues/${incident.id}/status`).set(h).send({ status: "OPEN", vendorId: "" });
    const sansPrestataire = await request(app)
      .put(`/api/issues/${incident.id}/status`)
      .set(h)
      .send({ status: "OPEN", scheduledAt: new Date(2026, 11, 1, 9).toISOString() });

    expect(vide.status).toBe(400);
    expect(sansPrestataire.status).toBe(400);
    expect(sansPrestataire.body.code).toBe("ISSUE_SCHEDULE_NEEDS_VENDOR");
  });
});

describe("PUT /api/issues/:id/status — ce qui change vraiment", () => {
  const RDV = new Date(2026, 10, 25, 10, 0, 0);

  async function incidentPlanifie() {
    const m = await monde();
    const incident = await m.issue({ vendorId: m.vendor.id, scheduledAt: RDV, status: "OPEN" });
    const maj = (corps: Record<string, unknown>) => request(app).put(`/api/issues/${incident.id}/status`).set(m.h).send(corps);
    return { ...m, incident, maj };
  }

  it("un enregistrement identique ne réécrit rien, ne journalise rien et renvoie le prestataire et la photo signée", async () => {
    const { manager, vendor, incident, maj } = await incidentPlanifie();

    const res = await maj({ status: "OPEN", managerNote: "", vendorId: vendor.id, scheduledAt: RDV.toISOString() });

    expect(res.status).toBe(200);
    expect(envoi).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toHaveLength(0);
    expect(res.body.vendor.id).toBe(vendor.id);
    expect(res.body.vendor.name).toBe("Plomberie Diop");
    expect(res.body.photoUrl).toBe("https://signed.test/issues/p.jpg");
    const [apres] = await testDb.select().from(issueReports).where(eq(issueReports.id, incident.id));
    expect(apres.managerNote).toBeNull();
  });

  it("une heure différente le même jour est un vrai changement : écrite, journalisée, le locataire est prévenu", async () => {
    const { manager, vendor, incident, maj } = await incidentPlanifie();
    const apresMidi = new Date(2026, 10, 25, 15, 30, 0);

    const res = await maj({ status: "OPEN", vendorId: vendor.id, scheduledAt: apresMidi.toISOString() });

    expect(res.status).toBe(200);
    expect(envoi).toHaveBeenCalledTimes(1);
    expect(await journal(manager.id)).toHaveLength(1);
    const [apres] = await testDb.select().from(issueReports).where(eq(issueReports.id, incident.id));
    expect(apres.scheduledAt?.getTime()).toBe(apresMidi.getTime());
  });

  it("ne modifie que l'incident visé", async () => {
    const { h, issue } = await monde();
    const cible = await issue({ title: "Cible", status: "OPEN" });
    const autre = await issue({ title: "Autre", status: "OPEN", managerNote: "à garder" });

    const res = await request(app).put(`/api/issues/${cible.id}/status`).set(h).send({ status: "RESOLVED", managerNote: "réglé" });

    expect(res.status).toBe(200);
    const [intact] = await testDb.select().from(issueReports).where(eq(issueReports.id, autre.id));
    expect(intact.status).toBe("OPEN");
    expect(intact.managerNote).toBe("à garder");
  });

  it("la réponse porte la photo signée, et le journal dit l'action, l'entité, le libellé et le détail", async () => {
    const { manager, h, issue } = await monde();
    const incident = await issue({ title: "Fuite cuisine" });

    const res = await request(app).put(`/api/issues/${incident.id}/status`).set(h).send({ status: "IN_PROGRESS" });

    expect(res.body.photoUrl).toBe("https://signed.test/issues/p.jpg");
    const [ligne] = await journal(manager.id);
    expect(ligne.entityType).toBe("issue");
    expect(ligne.entityId).toBe(incident.id);
    expect(ligne.entityLabel).toBe("Fuite cuisine");
    expect(ligne.details).toBe("Statut de l'incident « Fuite cuisine » changé en IN_PROGRESS");
  });
});

describe("PUT /api/issues/:id/status — e-mail au locataire", () => {
  it("un changement de statut seul prévient le locataire", async () => {
    const { h, issue } = await monde();
    const incident = await issue({ status: "OPEN" });

    await request(app).put(`/api/issues/${incident.id}/status`).set(h).send({ status: "RESOLVED" });

    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][0]).toBe("awa.sow@test.local");
  });

  it("écrit l'e-mail complet : nom, incident, bien, statut, note, rendez-vous, langue du locataire, réponse à l'agence", async () => {
    const { manager, vendor, h, issue } = await monde({ language: "pt" });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port", email: "agence@test.local" });
    const incident = await issue({ title: "Fuite cuisine", status: "OPEN" });
    const rdv = new Date(2026, 10, 25, 10, 0, 0);

    const res = await request(app)
      .put(`/api/issues/${incident.id}/status`)
      .set(h)
      .send({ status: "IN_PROGRESS", managerNote: "Le plombier passe mercredi", vendorId: vendor.id, scheduledAt: rdv.toISOString() });

    expect(res.status).toBe(200);
    const attendu = issueStatusUpdateEmail({
      tenantName: "Awa Sow",
      issueTitle: "Fuite cuisine",
      propertyTitle: "Villa Baobab",
      status: "IN_PROGRESS",
      managerNote: "Le plombier passe mercredi",
      scheduledAt: rdv,
      frontendUrl: env.frontendUrl,
      langue: "pt",
    });
    expect(envoi).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, html, , options] = envoi.mock.calls[0];
    expect(destinataire).toBe("awa.sow@test.local");
    expect(sujet).toBe(attendu.subject);
    expect(html).toBe(attendu.html);
    expect(options).toEqual({ replyTo: "agence@test.local" });
    expect(html).not.toBe(issueStatusUpdateEmail({ tenantName: "Awa Sow", issueTitle: "Fuite cuisine", propertyTitle: "Villa Baobab", status: "IN_PROGRESS", managerNote: "Le plombier passe mercredi", scheduledAt: rdv, frontendUrl: env.frontendUrl, langue: "fr" }).html);
  });

  it("l'échec de l'envoi ne fait pas échouer la mise à jour", async () => {
    const { h, issue } = await monde();
    const incident = await issue({ status: "OPEN" });
    envoi.mockRejectedValue(new Error("SMTP indisponible"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await request(app).put(`/api/issues/${incident.id}/status`).set(h).send({ status: "RESOLVED" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
  });
});

describe("POST /api/issues — création", () => {
  const photo = () => ({ buffer: fakeJpegBuffer("photo"), options: { filename: "p.jpg", contentType: "image/jpeg" } });
  const creer = async (m: Awaited<ReturnType<typeof monde>>, champs: Record<string, string>, fichier: { buffer: Buffer; options: { filename: string; contentType: string } } = photo()) => {
    let req = request(app).post("/api/issues").set(await m.jeton());
    for (const [nom, valeur] of Object.entries({ contractId: m.contract.id, title: "Fuite", description: "Fuite sous l'évier", ...champs })) req = req.field(nom, valeur);
    return req.attach("photo", fichier.buffer, fichier.options);
  };

  it.each(contractStatusEnum.enumValues.filter((s) => s !== "ACTIVE"))("refuse un signalement sur un bail au statut %s", async (statut) => {
    const m = await monde();
    await testDb.update(contracts).set({ status: statut }).where(eq(contracts.id, m.contract.id));

    const res = await creer(m, {});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ISSUE_CONTRACT_NOT_ACTIVE");
  });

  it.each([
    ["titre d'un caractère", { title: "a" }],
    ["description d'un caractère", { description: "a" }],
    ["description d'un caractère entourée d'espaces", { description: "  a  " }],
    ["identifiant de bail vide", { contractId: "" }],
  ])("refuse : %s", async (_nom, champs) => {
    const m = await monde();

    const res = await creer(m, champs);

    expect(res.status).toBe(400);
  });

  it("refuse un fichier dont le contenu n'est pas celui du type annoncé, sans rien téléverser", async () => {
    const m = await monde();
    const upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("issues/n.jpg");

    const res = await creer(m, {}, { buffer: Buffer.from("ceci n'est pas une image"), options: { filename: "p.jpg", contentType: "image/jpeg" } });

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("dépose la photo dans le dossier des incidents", async () => {
    const m = await monde();
    const upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("issues/n.jpg");

    const res = await creer(m, {});

    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toBe("issues");
  });
});

describe("POST /api/issues/:id/photo — ajout", () => {
  const ajouter = (id: string, entete: Record<string, string>, octets: Buffer | null = fakeJpegBuffer("autre")) => {
    const req = request(app).post(`/api/issues/${id}/photo`).set(entete);
    return octets ? req.attach("photo", octets, { filename: "b.jpg", contentType: "image/jpeg" }) : req;
  };

  it("refuse une requête sans fichier, avec son code", async () => {
    const m = await monde();
    const incident = await m.issue();

    const res = await ajouter(incident.id, await m.jeton(), null);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ISSUE_PHOTO_REQUIRED");
  });

  it("refuse un contenu qui n'est pas celui du type annoncé, sans rien téléverser", async () => {
    const m = await monde();
    const incident = await m.issue();
    const upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("issues/n.jpg");

    const res = await ajouter(incident.id, await m.jeton(), Buffer.from("ceci n'est pas une image"));

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("ajoute les photos à la suite, dans le dossier des incidents, met à jour la date, signe la réponse et ne touche pas les autres incidents", async () => {
    const m = await monde();
    const incident = await m.issue({ updatedAt: new Date("2025-01-01T00:00:00Z") });
    const autre = await m.issue({ title: "Autre", additionalPhotos: null });
    const upload = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValueOnce("issues/p1.jpg").mockResolvedValueOnce("issues/p2.jpg");
    const jeton = await m.jeton();

    const premiere = await ajouter(incident.id, jeton);
    const seconde = await ajouter(incident.id, jeton);

    expect(premiere.status).toBe(200);
    expect(seconde.status).toBe(200);
    expect(upload.mock.calls.map((c) => c[1])).toEqual(["issues", "issues"]);
    const [apres] = await testDb.select().from(issueReports).where(eq(issueReports.id, incident.id));
    expect(JSON.parse(apres.additionalPhotos!)).toEqual(["issues/p1.jpg", "issues/p2.jpg"]);
    expect(apres.updatedAt.getTime()).toBeGreaterThan(new Date("2025-06-01T00:00:00Z").getTime());
    expect(seconde.body.photoUrl).toBe("https://signed.test/issues/p.jpg");
    expect(JSON.parse(seconde.body.additionalPhotos)).toEqual(["https://signed.test/issues/p1.jpg", "https://signed.test/issues/p2.jpg"]);
    const [intact] = await testDb.select().from(issueReports).where(eq(issueReports.id, autre.id));
    expect(intact.additionalPhotos).toBeNull();
  });
});
