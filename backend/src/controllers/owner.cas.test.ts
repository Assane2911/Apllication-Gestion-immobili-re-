import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings, invoicePayments, ownerMessages, owners, users } from "../db/schema";
import * as emailService from "../services/email.service";
import { ownerInvitationEmail } from "../services/email.service";
import * as storageService from "../services/storage.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  createTenant,
  tokenFor,
  tokenProprietaire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Cas limites des propriétaires (owner.controller.ts), trouvés en sabotant le contrôleur : chaque test ci-dessous
 * échoue si la ligne qu'il garde est modifiée, alors que les tests existants passaient tous.
 */

let suppression: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  suppression = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
  vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

const corps = (extra: Record<string, unknown> = {}) => ({
  firstName: "Fatou",
  lastName: "Diop",
  phone: "+33 6 12 34 56 78",
  email: `fatou-${Math.random().toString(36).slice(2)}@test.local`,
  ...extra,
});

async function journal(managerId: string, action: string) {
  return testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));
}

describe("Propriétaires — limites du schéma", () => {
  it.each([
    ["prénom de 101 caractères", { firstName: "a".repeat(101) }],
    ["nom de 101 caractères", { lastName: "a".repeat(101) }],
    ["prénom vide", { firstName: "" }],
    ["raison sociale de 201 caractères", { companyName: "a".repeat(201) }],
    ["adresse de 301 caractères", { address: "a".repeat(301) }],
    ["notes de 5 001 caractères", { notes: "a".repeat(5001) }],
    ["taux de commission négatif", { managementFeeRate: -1 }],
    ["taux de commission de 100,5", { managementFeeRate: 100.5 }],
    ["téléphone invalide", { phone: "abc" }],
    ["langue inconnue", { language: "xx" }],
    ["civilité inconnue", { civility: "Zz" }],
    ["e-mail de plus de 254 caractères", { email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com` }],
  ])("refuse à la création : %s", async (_nom, extra) => {
    const manager = await createManager();

    const res = await request(app).post("/api/owners").set(authHeader(tokenFor(manager))).send(corps(extra));

    expect(res.status).toBe(400);
    expect(await testDb.select().from(owners).where(eq(owners.managerId, manager.id))).toHaveLength(0);
  });

  it("refuse les mêmes valeurs à la modification, sans rien écrire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { firstName: "Awa" });
    const h = authHeader(tokenFor(manager));

    for (const extra of [{ firstName: "a".repeat(101) }, { notes: "a".repeat(5001) }, { managementFeeRate: 100.5 }, { language: "xx" }]) {
      const res = await request(app).put(`/api/owners/${owner.id}`).set(h).send(extra);
      expect(res.status).toBe(400);
    }
    const [apres] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(apres.firstName).toBe("Awa");
  });

  it("accepte les bornes : 100 caractères, taux de 0 et de 100, civilité nulle", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));

    const a = await request(app).post("/api/owners").set(h).send(corps({ firstName: "a".repeat(100), managementFeeRate: 0, civility: null }));
    const b = await request(app).post("/api/owners").set(h).send(corps({ managementFeeRate: 100 }));

    expect(a.status).toBe(201);
    expect(a.body.managementFeeRate).toBe(0);
    expect(a.body.civility).toBeNull();
    expect(b.status).toBe(201);
    expect(b.body.managementFeeRate).toBe(100);
  });

  it("efface la civilité quand la modification envoie null", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { civility: "MME" });

    const res = await request(app).put(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager))).send({ civility: null });

    expect(res.status).toBe(200);
    expect(res.body.civility).toBeNull();
  });

  it("enregistre le téléphone au format international sans espaces, et l'e-mail en minuscules", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/owners")
      .set(authHeader(tokenFor(manager)))
      .send(corps({ phone: "+33 6 12 34 56 78", email: "Fatou.Diop@Test.LOCAL" }));

    expect(res.status).toBe(201);
    expect(res.body.phone).toBe("+33612345678");
    expect(res.body.email).toBe("fatou.diop@test.local");
  });
});

describe("Propriétaires — création", () => {
  it("accepte un second propriétaire d'une même agence quand son e-mail est différent", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));

    const premier = await request(app).post("/api/owners").set(h).send(corps({ email: "un@test.local" }));
    const second = await request(app).post("/api/owners").set(h).send(corps({ email: "deux@test.local" }));
    const doublon = await request(app).post("/api/owners").set(h).send(corps({ email: "UN@test.local" }));

    expect(premier.status).toBe(201);
    expect(second.status).toBe(201);
    expect(doublon.status).toBe(409);
    expect(doublon.body.code).toBe("OWNER_EMAIL_EXISTS");
  });

  it("donne à la fiche la langue de l'interface du gestionnaire, sauf si une langue est saisie", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));

    const parDefaut = await request(app).post("/api/owners").set(h).send(corps());
    const interface_pt = await request(app).post("/api/owners").set(h).set("Accept-Language", "pt").send(corps());
    const saisie = await request(app).post("/api/owners").set(h).set("Accept-Language", "pt").send(corps({ language: "en" }));

    expect(parDefaut.body.language).toBe("fr");
    expect(interface_pt.body.language).toBe("pt");
    expect(saisie.body.language).toBe("en");
  });

  it("écrit une entrée au journal : action, libellé, nom et e-mail", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/owners")
      .set(authHeader(tokenFor(manager)))
      .send(corps({ firstName: "Awa", lastName: "Sow", email: "awa.sow@test.local" }));

    const [ligne] = await journal(manager.id, "owner.create");
    expect(ligne.entityType).toBe("owner");
    expect(ligne.entityId).toBe(res.body.id);
    expect(ligne.entityLabel).toBe("Awa Sow");
    expect(ligne.details).toBe("Propriétaire ajouté : Awa Sow (awa.sow@test.local)");
  });
});

describe("Propriétaires — liste et fiche", () => {
  it("liste du plus récent au plus ancien, page par page, et ne compte que les propriétaires de l'agence", async () => {
    const manager = await createManager();
    const autre = await createManager();
    const h = authHeader(tokenFor(manager));
    const ancien = await createOwner(manager.id, { firstName: "Ancien", createdAt: new Date(2026, 0, 1) });
    const milieu = await createOwner(manager.id, { firstName: "Milieu", createdAt: new Date(2026, 1, 1) });
    const recent = await createOwner(manager.id, { firstName: "Recent", createdAt: new Date(2026, 2, 1) });
    await createOwner(autre.id);
    await createOwner(autre.id);

    const tout = await request(app).get("/api/owners").set(h);
    const page1 = await request(app).get("/api/owners?page=1&pageSize=1").set(h);
    const page2 = await request(app).get("/api/owners?page=2&pageSize=1").set(h);
    const deux = await request(app).get("/api/owners?pageSize=2").set(h);

    expect(tout.body.items.map((o: { id: string }) => o.id)).toEqual([recent.id, milieu.id, ancien.id]);
    expect(tout.body.total).toBe(3);
    expect(page1.body.items.map((o: { id: string }) => o.id)).toEqual([recent.id]);
    expect(page2.body.items.map((o: { id: string }) => o.id)).toEqual([milieu.id]);
    expect(page2.body.total).toBe(3);
    expect(deux.body.items).toHaveLength(2);
  });

  it("la fiche d'un propriétaire ne montre que ses propres biens", async () => {
    const manager = await createManager();
    const a = await createOwner(manager.id);
    const b = await createOwner(manager.id);
    const bienA = await createProperty(manager.id, { ownerId: a.id, title: "Villa A" });
    await createProperty(manager.id, { ownerId: b.id, title: "Villa B" });
    await createProperty(manager.id, { title: "Sans propriétaire" });

    const res = await request(app).get(`/api/owners/${a.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.properties.map((p: { id: string }) => p.id)).toEqual([bienA.id]);
  });
});

describe("Propriétaires — modification", () => {
  it("refuse la fiche d'une autre agence et n'y écrit rien", async () => {
    const manager = await createManager();
    const intrus = await createManager();
    const owner = await createOwner(manager.id, { firstName: "Awa" });

    const res = await request(app).put(`/api/owners/${owner.id}`).set(authHeader(tokenFor(intrus))).send({ firstName: "Piraté" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("OWNER_NOT_FOUND");
    const [apres] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(apres.firstName).toBe("Awa");
  });

  it("ne modifie que la fiche visée, pas les autres propriétaires", async () => {
    const manager = await createManager();
    const cible = await createOwner(manager.id, { firstName: "Cible" });
    const autre = await createOwner(manager.id, { firstName: "Autre", notes: "à garder" });

    const res = await request(app).put(`/api/owners/${cible.id}`).set(authHeader(tokenFor(manager))).send({ firstName: "Modifié", notes: "nouvelle note" });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(owners).where(eq(owners.id, autre.id));
    expect(apres.firstName).toBe("Autre");
    expect(apres.notes).toBe("à garder");
  });

  it("écrit une entrée au journal : action, libellé et détail", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { firstName: "Awa", lastName: "Sow" });

    await request(app).put(`/api/owners/${owner.id}`).set(authHeader(tokenFor(manager))).send({ notes: "x" });

    const [ligne] = await journal(manager.id, "owner.update");
    expect(ligne.entityType).toBe("owner");
    expect(ligne.entityId).toBe(owner.id);
    expect(ligne.entityLabel).toBe("Awa Sow");
    expect(ligne.details).toBe("Propriétaire modifié : Awa Sow");
  });
});

describe("Propriétaires — suppression", () => {
  it("supprime un propriétaire sans bien même quand un AUTRE propriétaire en a, et efface ses seuls vocaux", async () => {
    const manager = await createManager();
    const cible = await createOwner(manager.id, { firstName: "Awa", lastName: "Sow" });
    const autre = await createOwner(manager.id);
    await createProperty(manager.id, { ownerId: autre.id });
    const compteCible = await createOwnerPortalUser(cible);
    const compteAutre = await createOwnerPortalUser(autre);
    const message = (ownerId: string, senderId: string, audioPath: string | null) => ({
      ownerId, managerId: manager.id, senderId, senderRole: "OWNER" as const, content: "x", audioPath,
    });
    await testDb.insert(ownerMessages).values([
      message(cible.id, compteCible.id, "owner-messages/cible-1.webm"),
      message(cible.id, compteCible.id, null),
      message(autre.id, compteAutre.id, "owner-messages/autre-1.webm"),
    ]);

    const res = await request(app).delete(`/api/owners/${cible.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(await testDb.select().from(owners).where(eq(owners.id, cible.id))).toHaveLength(0);
    expect((suppression.mock.calls as unknown[][]).map((c) => c[0])).toEqual(["owner-messages/cible-1.webm"]);
    const [ligne] = await journal(manager.id, "owner.delete");
    expect(ligne.entityLabel).toBe("Awa Sow");
    expect(ligne.details).toBe("Propriétaire supprimé : Awa Sow");
  });
});

describe("Propriétaires — anonymisation", () => {
  const entree = (managerId: string, entityId: string, entityType: string, label: string, details: string) => ({
    managerId, actorLabel: "agence", action: "owner.create", entityType, entityId, entityLabel: label, details,
  });

  it("n'efface que la fiche visée : sa civilité, son compte, sa discussion et son journal ; ses vocaux partent du stockage ; les autres fiches restent entières", async () => {
    const manager = await createManager();
    const cible = await createOwner(manager.id, { civility: "M", firstName: "Awa", lastName: "Sow", email: "awa.sow@test.local" });
    const autre = await createOwner(manager.id, { civility: "MME", firstName: "Bintou", lastName: "Fall", email: "bintou@test.local" });
    const compteCible = await createOwnerPortalUser(cible);
    const compteAutre = await createOwnerPortalUser(autre);
    const message = (ownerId: string, senderId: string, audioPath: string | null) => ({
      ownerId, managerId: manager.id, senderId, senderRole: "OWNER" as const, content: "bonjour", audioPath,
    });
    await testDb.insert(ownerMessages).values([
      message(cible.id, compteCible.id, "owner-messages/cible.webm"),
      message(cible.id, compteCible.id, null),
      message(autre.id, compteAutre.id, "owner-messages/autre.webm"),
    ]);
    await testDb.insert(activityLogs).values([
      entree(manager.id, cible.id, "owner", "Awa Sow", "Propriétaire ajouté : Awa Sow (awa.sow@test.local)"),
      entree(manager.id, autre.id, "owner", "Bintou Fall", "Propriétaire ajouté : Bintou Fall (bintou@test.local)"),
      entree(manager.id, cible.id, "property", "Awa Sow", "Bien lié à Awa Sow"),
    ]);

    const res = await request(app).post(`/api/owners/${cible.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("Les données identifiantes de ce propriétaire ont été effacées.");

    const [fiche] = await testDb.select().from(owners).where(eq(owners.id, cible.id));
    expect(fiche.civility).toBeNull();
    expect(fiche.email).toBe(`anonyme-${cible.id}@supprime.invalid`);
    expect(fiche.userId).toBeNull();
    const [intacte] = await testDb.select().from(owners).where(eq(owners.id, autre.id));
    expect(intacte.firstName).toBe("Bintou");
    expect(intacte.civility).toBe("MME");
    expect(intacte.email).toBe("bintou@test.local");
    expect(intacte.userId).toBe(compteAutre.id);
    expect(intacte.anonymizedAt).toBeNull();

    expect(await testDb.select().from(users).where(eq(users.id, compteCible.id))).toHaveLength(0);
    expect(await testDb.select().from(users).where(eq(users.id, compteAutre.id))).toHaveLength(1);

    expect(await testDb.select().from(ownerMessages).where(eq(ownerMessages.ownerId, cible.id))).toHaveLength(0);
    expect(await testDb.select().from(ownerMessages).where(eq(ownerMessages.ownerId, autre.id))).toHaveLength(1);
    expect((suppression.mock.calls as unknown[][]).map((c) => c[0])).toEqual(["owner-messages/cible.webm"]);

    const lignes: (typeof activityLogs.$inferSelect)[] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    const deLaCible = lignes.find((l) => l.entityId === cible.id && l.entityType === "owner" && l.action === "owner.create")!;
    expect(deLaCible.entityLabel).toBe("Propriétaire anonymisé");
    expect(deLaCible.details).not.toContain("Awa");
    expect(deLaCible.details).not.toContain("awa.sow@test.local");
    const deLAutre = lignes.find((l) => l.entityId === autre.id)!;
    expect(deLAutre.details).toBe("Propriétaire ajouté : Bintou Fall (bintou@test.local)");
    const dUneAutreEntite = lignes.find((l) => l.entityType === "property")!;
    expect(dUneAutreEntite.entityLabel).toBe("Awa Sow");
    expect(dUneAutreEntite.details).toBe("Bien lié à Awa Sow");
  });

  it("donne une adresse différente à chaque fiche anonymisée", async () => {
    const manager = await createManager();
    const a = await createOwner(manager.id);
    const b = await createOwner(manager.id);
    const h = authHeader(tokenFor(manager));

    await request(app).post(`/api/owners/${a.id}/anonymiser`).set(h);
    await request(app).post(`/api/owners/${b.id}/anonymiser`).set(h);

    const [fa] = await testDb.select().from(owners).where(eq(owners.id, a.id));
    const [fb] = await testDb.select().from(owners).where(eq(owners.id, b.id));
    expect(fa.email).not.toBe(fb.email);
  });
});

describe("Propriétaires — invitation au portail", () => {
  it("renvoie une invitation restée sans échéance enregistrée", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const compte = await createOwnerPortalUser(owner);
    await testDb.update(users).set({ resetPasswordTokenHash: "ancien-hash", resetPasswordExpiresAt: null }).where(eq(users.id, compte.id));

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(users).where(eq(users.id, compte.id));
    expect(apres.resetPasswordTokenHash).not.toBe("ancien-hash");
    expect(apres.resetPasswordExpiresAt).not.toBeNull();
  });

  it("ne réutilise qu'un compte orphelin : ni les autres comptes, ni les autres fiches ne bougent", async () => {
    const manager = await createManager();
    const autreAgence = await createManager();
    const owner = await createOwner(manager.id, { email: "orphelin@test.local" });
    const autreFiche = await createOwner(autreAgence.id);
    const compteAutreFiche = await createOwnerPortalUser(autreFiche);
    const [orphelin] = await testDb
      .insert(users)
      .values({ email: "orphelin@test.local", passwordHash: "x", role: "OWNER", tokenVersion: 3 })
      .returning();

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(orphelin.id);
    const [apres] = await testDb.select().from(users).where(eq(users.id, orphelin.id));
    expect(apres.tokenVersion).toBe(4);
    expect(apres.resetPasswordTokenHash).not.toBeNull();
    const [fiche] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(fiche.userId).toBe(orphelin.id);

    const [autreCompte] = await testDb.select().from(users).where(eq(users.id, compteAutreFiche.id));
    expect(autreCompte.tokenVersion).toBe(0);
    expect(autreCompte.resetPasswordTokenHash).toBeNull();
    const [autreFicheApres] = await testDb.select().from(owners).where(eq(owners.id, autreFiche.id));
    expect(autreFicheApres.userId).toBe(compteAutreFiche.id);
    const [gestionnaire] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(gestionnaire.tokenVersion).toBe(manager.tokenVersion);
  });

  it("écrit l'e-mail avec le nom de l'agence du gestionnaire, la civilité et sa langue, puis la ligne du journal", async () => {
    const manager = await createManager();
    const autreAgence = await createManager();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port" });
    await testDb.insert(agencySettings).values({ userId: autreAgence.id, agencyName: "Agence du Rival" });
    const owner = await createOwner(manager.id, { civility: "MME", firstName: "Awa", lastName: "Sow", email: "awa.invite@test.local" });

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager))).set("Accept-Language", "en");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Invitation envoyée");
    const envoi = vi.mocked(emailService.sendEmail).mock.calls[0];
    const [compte] = await testDb.select().from(users).where(eq(users.email, "awa.invite@test.local"));
    expect(res.body.userId).toBe(compte.id);
    expect(envoi[0]).toBe("awa.invite@test.local");
    const attendu = ownerInvitationEmail({ ownerName: "Madame Awa Sow", agencyName: "Agence du Port", inviteUrl: "https://x.test", langue: "en" });
    expect(envoi[1]).toBe(attendu.subject);
    expect(envoi[1]).toContain("Agence du Port");
    expect(envoi[2]).toContain("Madame Awa Sow");
    expect(envoi[2]).not.toContain("Agence du Rival");
    expect(envoi[1]).not.toBe(ownerInvitationEmail({ ownerName: "x", agencyName: "Agence du Port", inviteUrl: "x", langue: "fr" }).subject);

    const [ligne] = await journal(manager.id, "owner.invite");
    expect(ligne.entityLabel).toBe("Awa Sow");
    expect(ligne.details).toBe("Invitation envoyée au propriétaire : Awa Sow (awa.invite@test.local)");
  });

  it("l'échec de l'envoi de l'e-mail ne fait pas échouer l'invitation ; le mot de passe n'est jamais une valeur connue", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { email: "echec@test.local" });
    vi.mocked(emailService.sendEmail).mockRejectedValue(new Error("SMTP indisponible"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await request(app).post(`/api/owners/${owner.id}/invite`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const [compte] = await testDb.select().from(users).where(eq(users.email, "echec@test.local"));
    expect(compte).toBeDefined();
    for (const candidat of ["motdepasse", "password", "Password123!", "12345678"]) {
      expect(await bcrypt.compare(candidat, compte.passwordHash)).toBe(false);
    }
  });
});

describe("Propriétaires — export des données", () => {
  it("remet un fichier JSON indenté, en pièce jointe", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { firstName: "Awa", lastName: "Sow" });

    const res = await request(app).get(`/api/owners/${owner.id}/export`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="/);
    expect(res.text.startsWith('{\n  "')).toBe(true);
    expect(JSON.parse(res.text).proprietaire).toBeDefined();
  });

  it("refuse l'export d'un propriétaire d'une autre agence", async () => {
    const manager = await createManager();
    const intrus = await createManager();
    const owner = await createOwner(manager.id);

    const res = await request(app).get(`/api/owners/${owner.id}/export`).set(authHeader(tokenFor(intrus)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/owners/mine/agenda — paramètre days", () => {
  it("refuse une durée décimale ou au-delà du plafond, accepte le plafond", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const jeton = await tokenProprietaire(owner);
    const lire = (query: string) => request(app).get(`/api/owners/mine/agenda${query}`).set(authHeader(jeton));

    expect((await lire("?days=7.5")).status).toBe(400);
    expect((await lire("?days=367")).status).toBe(400);
    expect((await lire("?days=366")).status).toBe(200);
  });
});

describe("GET /api/owners/mine/dashboard — mois, devises et historique", () => {
  // 23 novembre 2026 : « ce mois-ci » est novembre ; l'historique couvre de juin à novembre (six mois, le mois en cours compris).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 10, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  async function monde() {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { civility: "MME", firstName: "Awa", lastName: "Sow", managementFeeRate: 12 });
    const bien = await createProperty(manager.id, { ownerId: owner.id, title: "Villa A", address: "1 rue A", currency: "EUR" });
    const locataire = await createTenant(manager.id);
    const bail = await createContract(bien.id, locataire.id, { startDate: new Date(2025, 0, 1), endDate: new Date(2027, 11, 31) });
    const jeton = await tokenProprietaire(owner);
    const lire = () => request(app).get("/api/owners/mine/dashboard").set(authHeader(jeton));
    return { manager, owner, bien, locataire, bail, lire };
  }
  const payee = (contractId: string, mois: number, paidAt: Date, amount = 100, extra: Record<string, unknown> = {}) =>
    createInvoice(contractId, { periodMonth: mois, periodYear: 2026, amount, status: "PAID", paidAt, ...extra });

  it("sans aucune facture : le nom avec civilité, le taux, la ligne du bien à zéro, aucun total", async () => {
    const { bien, lire } = await monde();

    const res = await lire();

    expect(res.status).toBe(200);
    expect(res.body.ownerName).toBe("Madame Awa Sow");
    expect(res.body.managementFeeRate).toBe(12);
    expect(res.body.properties).toEqual([{ propertyId: bien.id, title: "Villa A", address: "1 rue A", currency: "EUR", collected: 0, pending: 0 }]);
    expect(res.body.collectedThisMonthByCurrency).toEqual({});
    expect(res.body.pendingThisMonthByCurrency).toEqual({});
    expect(res.body.revenueByMonth).toEqual({});
  });

  it("l'historique remonte à six mois, le 1er juin compris, et affiche les mois sur deux chiffres", async () => {
    const { bail, lire } = await monde();
    await payee(bail.id, 6, new Date(2026, 5, 1, 0, 0, 0), 100);
    await payee(bail.id, 5, new Date(2026, 4, 31, 23, 59, 59), 900);

    const res = await lire();

    expect(res.body.revenueByMonth).toEqual({ "2026-06": { EUR: 100 } });
  });

  it("additionne les encaissements d'un même mois, par devise, sans écraser le mois", async () => {
    const { bien, bail, lire } = await monde();
    await payee(bail.id, 10, new Date(2026, 9, 3), 100);
    await payee(bail.id, 11, new Date(2026, 9, 20), 250);
    await payee(bail.id, 9, new Date(2026, 9, 25), 40, { currency: "XOF" });

    const res = await lire();

    expect(res.body.revenueByMonth).toEqual({ "2026-10": { EUR: 350, XOF: 40 } });
    expect(res.body.collectedThisMonthByCurrency).toEqual({});
    expect(res.body.properties.find((p: { propertyId: string }) => p.propertyId === bien.id).collected).toBe(0);
  });

  it("le perçu du mois s'additionne par bien et par devise, avec une ligne par couple bien-devise", async () => {
    const { bien, bail, lire } = await monde();
    await payee(bail.id, 11, new Date(2026, 10, 2), 100);
    await payee(bail.id, 10, new Date(2026, 10, 9), 250);
    await payee(bail.id, 9, new Date(2026, 10, 12), 5000, { currency: "XOF" });
    await payee(bail.id, 8, new Date(2026, 9, 12), 777);

    const res = await lire();

    expect(res.body.collectedThisMonthByCurrency).toEqual({ EUR: 350, XOF: 5000 });
    expect(res.body.properties).toHaveLength(2);
    const eur = res.body.properties.find((p: { currency: string }) => p.currency === "EUR");
    const xof = res.body.properties.find((p: { currency: string }) => p.currency === "XOF");
    expect(eur).toMatchObject({ propertyId: bien.id, collected: 350 });
    expect(xof).toMatchObject({ propertyId: bien.id, collected: 5000 });
    expect(res.body.revenueByMonth["2026-10"]).toEqual({ EUR: 777 });
    expect(res.body.revenueByMonth["2026-11"]).toEqual({ EUR: 350, XOF: 5000 });
  });

  it("l'en-attente ne compte que les loyers du mois en cours, en attente ou en retard, annulés exclus, et additionne les biens", async () => {
    const { manager, owner, bail, lire } = await monde();
    const bien2 = await createProperty(manager.id, { ownerId: owner.id, title: "Villa B", currency: "EUR" });
    const bail2 = await createContract(bien2.id, (await createTenant(manager.id)).id, { startDate: new Date(2025, 0, 1), endDate: new Date(2027, 11, 31) });
    await createInvoice(bail.id, { periodMonth: 11, periodYear: 2026, amount: 300, status: "PENDING" });
    await createInvoice(bail2.id, { periodMonth: 11, periodYear: 2026, amount: 200, status: "LATE" });
    await createInvoice(bail.id, { periodMonth: 10, periodYear: 2026, amount: 111, status: "PENDING" });
    await createInvoice(bail.id, { periodMonth: 11, periodYear: 2025, amount: 222, status: "PENDING" });
    await createInvoice(bail2.id, { periodMonth: 10, periodYear: 2026, amount: 333, status: "CANCELLED" });

    const res = await lire();

    expect(res.body.pendingThisMonthByCurrency).toEqual({ EUR: 500 });
    const lignes = Object.fromEntries(res.body.properties.map((p: { title: string; pending: number }) => [p.title, p.pending]));
    expect(lignes).toEqual({ "Villa A": 300, "Villa B": 200 });
    expect(res.body.collectedThisMonthByCurrency).toEqual({});
  });

  it("un loyer dont la devise est vide est compté en euros, pour l'attente comme pour le perçu et l'historique", async () => {
    const { bail, lire } = await monde();
    await createInvoice(bail.id, { periodMonth: 11, periodYear: 2026, amount: 300, status: "PENDING", currency: "" });
    await payee(bail.id, 10, new Date(2026, 10, 4), 150, { currency: "" });

    const res = await lire();

    expect(res.body.pendingThisMonthByCurrency).toEqual({ EUR: 300 });
    expect(res.body.collectedThisMonthByCurrency).toEqual({ EUR: 150 });
    expect(res.body.revenueByMonth).toEqual({ "2026-11": { EUR: 150 } });
    expect(res.body.properties).toHaveLength(1);
  });

  it("un règlement partiel compte à sa date ; ceux de plus de six mois n'apparaissent pas", async () => {
    const { bail, lire } = await monde();
    const facture = await createInvoice(bail.id, { periodMonth: 11, periodYear: 2026, amount: 100, status: "PENDING", amountPaid: 40 });
    await testDb.insert(invoicePayments).values([
      { invoiceId: facture.id, amount: 20, paidAt: new Date(2026, 2, 10), paymentMethod: "CASH" },
      { invoiceId: facture.id, amount: 20, paidAt: new Date(2026, 10, 5), paymentMethod: "CASH" },
    ]);

    const res = await lire();

    expect(res.body.revenueByMonth).toEqual({ "2026-11": { EUR: 20 } });
    expect(res.body.collectedThisMonthByCurrency).toEqual({ EUR: 20 });
    expect(res.body.pendingThisMonthByCurrency).toEqual({ EUR: 60 });
  });
});
