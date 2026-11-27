import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contractGuarantors, formalNotices } from "../db/schema";
import * as emailService from "../services/email.service";
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

/**
 * Audit par sabotage de formalNotice.controller.ts : l'accès (propriétaire de l'agence, collaborateur, autre agence, sans
 * connexion), la validation de l'émission, ce que la réponse et le journal d'activité retiennent, et le courrier lui-même.
 */
const JOUR = 86_400_000;
const ilYa = (jours: number) => new Date(Date.now() - jours * JOUR);

afterEach(() => {
  vi.restoreAllMocks();
});

async function agence(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager(overrides);
  const property = await createProperty(manager.id, { title: "Appartement Plateau", address: "12 rue Carnot, Dakar" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop", email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) });
  await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, amount: 650, status: "LATE", dueDate: ilYa(40) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const emettre = (h: Record<string, string>, contractId: string, body?: object) => {
  const r = request(app).post(`/api/contracts/${contractId}/formal-notices`).set(h);
  return body === undefined ? r : r.send(body);
};
const liste = (h: Record<string, string>, contractId: string) => request(app).get(`/api/contracts/${contractId}/formal-notices`).set(h);
const document = (h: Record<string, string>, noticeId: string) => request(app).get(`/api/documents/formal-notice/${noticeId}`).set(h);
const jetonCollaborateur = async (managerId: string, teamRole = "AGENT") =>
  authHeader(tokenFor({ id: managerId, role: "MANAGER" }, null, null, (await createTeamMember(managerId, { teamRole })).id));

describe("émission : validation du corps", () => {
  it.each([[1], [60]])("accepte un délai de %i jour(s) pile", async (jours) => {
    const { contract, h } = await agence();
    const res = await emettre(h, contract.id, { deadlineDays: jours });
    expect(res.status).toBe(201);
    expect(res.body.deadlineDays).toBe(jours);
  });

  it("accepte un délai en texte numérique (« 15 ») et l'enregistre en nombre", async () => {
    const { contract, h } = await agence();
    const res = await emettre(h, contract.id, { deadlineDays: "15" });
    expect(res.status).toBe(201);
    expect(res.body.deadlineDays).toBe(15);
  });

  it.each([[0], [-1], [61], [7.5], ["abc"], [null]])("refuse le délai %j (400), sans rien écrire", async (jours) => {
    const { contract, h } = await agence();
    const res = await emettre(h, contract.id, { deadlineDays: jours });
    expect(res.status).toBe(400);
    expect(await testDb.select().from(formalNotices)).toHaveLength(0);
  });

  it.each([[{ sendEmail: "true" }], [{ sendEmail: 1 }], [{ notifyGuarantors: "oui" }], [{ notifyGuarantors: 1 }]])(
    "refuse le corps %j : les envois sont des booléens stricts (400)",
    async (corps) => {
      const { contract, h } = await agence();
      const envoi = vi.spyOn(emailService, "sendEmail");
      const res = await emettre(h, contract.id, corps);
      expect(res.status).toBe(400);
      expect(envoi).not.toHaveBeenCalled();
      expect(await testDb.select().from(formalNotices)).toHaveLength(0);
    }
  );

  it("sans corps du tout : délai par défaut du pays (8 jours hors Sénégal), aucun envoi", async () => {
    const { contract, h } = await agence({ country: "FR" });
    const envoi = vi.spyOn(emailService, "sendEmail");
    const res = await emettre(h, contract.id);

    expect(res.status).toBe(201);
    expect(res.body.deadlineDays).toBe(8);
    expect(res.body.emailEnvoye).toBe(false);
    expect(envoi).not.toHaveBeenCalled();
  });

  it("le délai par défaut est celui du pays de l'agence : 30 jours au Sénégal, 8 en France, un délai choisi l'emporte", async () => {
    const sn = await agence({ country: "SN" });
    expect((await emettre(sn.h, sn.contract.id, {})).body.deadlineDays).toBe(30);

    const fr = await agence({ country: "FR" });
    expect((await emettre(fr.h, fr.contract.id, {})).body.deadlineDays).toBe(8);

    const choisi = await agence({ country: "SN" });
    expect((await emettre(choisi.h, choisi.contract.id, { deadlineDays: 5 })).body.deadlineDays).toBe(5);
  });

  it("les garants ne sont prévenus que sur demande : sendEmail seul n'écrit qu'au locataire", async () => {
    const { contract, h } = await agence();
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Moussa", lastName: "Sow", phone: "+221770000000", email: "garant@test.local" });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ success: true } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });
    expect(res.status).toBe(201);
    expect(res.body.garantsPrevenus).toBe(0);
    expect(envoi.mock.calls.map((c) => c[0])).toEqual(["awa@test.local"]);
  });

  it("un corps mal formé visé sur le bail d'une AUTRE agence répond 404, pas 400 : rien ne révèle que le bail existe", async () => {
    const { contract } = await agence();
    const intrus = authHeader(tokenFor(await createManager()));

    const res = await emettre(intrus, contract.id, { deadlineDays: 999 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });
});

describe("accès aux baux", () => {
  it("un bail inexistant répond 404 CONTRACT_NOT_FOUND, à l'émission comme à la liste", async () => {
    const { h } = await agence();
    const e = await emettre(h, "bail-inconnu", {});
    expect(e.status).toBe(404);
    expect(e.body.code).toBe("CONTRACT_NOT_FOUND");
    const l = await liste(h, "bail-inconnu");
    expect(l.status).toBe(404);
    expect(l.body.code).toBe("CONTRACT_NOT_FOUND");
  });

  it("la liste d'un bail d'une autre agence répond 404, comme un bail inventé", async () => {
    const { contract } = await agence();
    const res = await liste(authHeader(tokenFor(await createManager())), contract.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });

  it.each([
    ["GET /contracts/formal-notices-due", () => request(app).get("/api/contracts/formal-notices-due")],
    ["GET /contracts/:id/formal-notices", () => request(app).get("/api/contracts/x/formal-notices")],
    ["POST /contracts/:id/formal-notices", () => request(app).post("/api/contracts/x/formal-notices").send({})],
    ["GET /documents/formal-notice/:id", () => request(app).get("/api/documents/formal-notice/x")],
  ])("%s exige une connexion (401)", async (_nom, appeler) => {
    expect((await appeler()).status).toBe(401);
  });

  it("la liste d'un bail est vide tant qu'aucune mise en demeure n'a été émise", async () => {
    const { contract, h } = await agence();
    const res = await liste(h, contract.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("la liste va de la plus récente à la plus ancienne, chacune avec sa référence et sans l'instantané des factures", async () => {
    const { contract, h } = await agence();
    const premiere = await emettre(h, contract.id, { deadlineDays: 10 });
    await testDb.update(formalNotices).set({ createdAt: ilYa(3) });
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, amount: 300, status: "LATE", dueDate: ilYa(35) });
    const seconde = await emettre(h, contract.id, { deadlineDays: 20 });
    expect(seconde.status).toBe(201);

    const res = await liste(h, contract.id);
    expect(res.status).toBe(200);
    expect(res.body.map((n: { id: string }) => n.id)).toEqual([seconde.body.id, premiere.body.id]);
    for (const n of res.body) {
      expect(n.reference).toMatch(/^MED-\d{4}-[A-Z0-9]{6}$/);
      expect(n.invoicesSnapshot).toBeUndefined();
      expect(Array.isArray(n.invoices)).toBe(true);
    }
    expect(res.body[0].reference).toBe(seconde.body.reference);
  });

  it("la liste ne mêle pas les mises en demeure de deux baux de la même agence", async () => {
    const { manager, contract, h } = await agence();
    const autreBien = await createProperty(manager.id);
    const autreLocataire = await createTenant(manager.id);
    const autreBail = await createContract(autreBien.id, autreLocataire.id, { status: "ACTIVE" });
    await createInvoice(autreBail.id, { status: "LATE", dueDate: ilYa(40) });
    const a = await emettre(h, contract.id);
    const b = await emettre(h, autreBail.id);

    expect((await liste(h, contract.id)).body.map((n: { id: string }) => n.id)).toEqual([a.body.id]);
    expect((await liste(h, autreBail.id)).body.map((n: { id: string }) => n.id)).toEqual([b.body.id]);
  });

  it("un collaborateur de l'agence émet, lit la liste et voit les baux à mettre en demeure du propriétaire", async () => {
    const { manager, contract } = await agence();
    const collab = await jetonCollaborateur(manager.id);

    const due = await request(app).get("/api/contracts/formal-notices-due").set(collab);
    expect(due.status).toBe(200);
    expect(due.body).toHaveLength(1);

    expect((await emettre(collab, contract.id)).status).toBe(201);
    expect((await liste(collab, contract.id)).body).toHaveLength(1);
  });

  it("les baux à mettre en demeure d'une agence ne sont jamais ceux d'une autre", async () => {
    await agence();
    const autre = authHeader(tokenFor(await createManager()));
    const res = await request(app).get("/api/contracts/formal-notices-due").set(autre);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("émission : ce que la réponse et la base retiennent", () => {
  it("renvoie 201 avec la référence, le total, les compteurs d'envoi, sans l'instantané des factures", async () => {
    const { contract, h } = await agence();
    const res = await emettre(h, contract.id, { deadlineDays: 12 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalDue: 650, deadlineDays: 12, emailEnvoye: false, colocatairesPrevenus: 0, garantsPrevenus: 0 });
    expect(res.body.reference).toMatch(/^MED-\d{4}-[A-Z0-9]{6}$/);
    expect(res.body.invoicesSnapshot).toBeUndefined();
    expect(res.body.contractId).toBe(contract.id);
  });

  it("garde l'auteur : le propriétaire pour lui-même, le collaborateur sous SON identité, toujours sous l'agence du propriétaire", async () => {
    const { manager, contract, h } = await agence();
    const proprio = await emettre(h, contract.id);
    const [a] = await testDb.select().from(formalNotices).where(eq(formalNotices.id, proprio.body.id));
    expect(a.createdBy).toBe(manager.id);
    expect(a.managerId).toBe(manager.id);

    await testDb.update(formalNotices).set({ createdAt: ilYa(3) });
    const collaborateur = await createTeamMember(manager.id, { teamRole: "AGENT" });
    const jeton = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id));
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, amount: 100, status: "LATE", dueDate: ilYa(35) });
    const parCollab = await emettre(jeton, contract.id);
    expect(parCollab.status).toBe(201);
    const [b] = await testDb.select().from(formalNotices).where(eq(formalNotices.id, parCollab.body.id));
    expect(b.createdBy).toBe(collaborateur.id);
    expect(b.managerId).toBe(manager.id);
  });
});

describe("journal d'activité", () => {
  const trace = async (managerId: string) => {
    const lignes = await testDb
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.action, "contract.formal_notice"), eq(activityLogs.managerId, managerId)));
    expect(lignes).toHaveLength(1);
    return lignes[0];
  };

  it("nomme le bail, le locataire, la référence, le montant et le délai", async () => {
    const { manager, contract, h } = await agence();
    const res = await emettre(h, contract.id, { deadlineDays: 12 });
    const t = await trace(manager.id);

    expect(t.entityType).toBe("contract");
    expect(t.entityId).toBe(contract.id);
    expect(t.entityLabel).toBe("Appartement Plateau — Awa Diop");
    expect(t.details).toContain(`Mise en demeure ${res.body.reference} émise`);
    expect(t.details).toMatch(/650[\s ]?€/);
    expect(t.details).toContain("à régler sous 12 jour(s)");
    expect(t.details).toContain("sans envoi par email");
    expect(t.details?.endsWith(".")).toBe(true);
  });

  it("courrier envoyé : « envoyée par email », avec les garants en copie quand il y en a", async () => {
    const { manager, contract, h } = await agence();
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Moussa", lastName: "Sow", phone: "+221770000000", email: "garant@test.local" });
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ success: true } as never);

    const res = await emettre(h, contract.id, { sendEmail: true, notifyGuarantors: true });
    expect(res.status).toBe(201);
    expect(res.body.emailEnvoye).toBe(true);
    expect(res.body.garantsPrevenus).toBe(1);

    const t = await trace(manager.id);
    expect(t.details).toContain(", envoyée par email");
    expect(t.details).toContain(", 1 garant(s) en copie.");
    expect(t.details).not.toContain("sans envoi");
  });

  it("courrier demandé mais non parti : le journal le dit (« email NON parti ») et la réponse aussi", async () => {
    const { manager, contract, h } = await agence();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ error: "SMTP indisponible" } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });
    expect(res.status).toBe(201);
    expect(res.body.emailEnvoye).toBe(false);
    expect(res.body.emailSentAt).toBeNull();

    const t = await trace(manager.id);
    expect(t.details).toContain(", email NON parti");
    expect(t.details).not.toContain("envoyée par email");
  });

  it("un refus (rien n'est dû) ne laisse aucune trace", async () => {
    const { manager, h } = await agence();
    const autreBien = await createProperty(manager.id);
    const locataire = await createTenant(manager.id);
    const sansImpaye = await createContract(autreBien.id, locataire.id, { status: "ACTIVE" });

    const res = await emettre(h, sansImpaye.id);
    expect(res.status).toBe(409);
    const lignes = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "contract.formal_notice"));
    expect(lignes).toHaveLength(0);
  });
});

describe("le courrier", () => {
  it("un numéro de mise en demeure inconnu répond 404 FORMAL_NOTICE_NOT_FOUND", async () => {
    const { h } = await agence();
    const res = await document(h, "mise-en-demeure-inconnue");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FORMAL_NOTICE_NOT_FOUND");
  });

  it("une autre agence reçoit exactement la même réponse qu'un numéro inventé : rien ne révèle l'existence du courrier", async () => {
    const { contract, h } = await agence();
    const { body: notice } = await emettre(h, contract.id);
    const intrus = authHeader(tokenFor(await createManager()));

    const inventee = await document(intrus, "mise-en-demeure-inconnue");
    const reelle = await document(intrus, notice.id);
    expect(reelle.status).toBe(404);
    expect(reelle.body).toEqual(inventee.body);
    expect(reelle.body.code).toBe("FORMAL_NOTICE_NOT_FOUND");
  });

  it("s'ouvre pour le gestionnaire et pour son collaborateur, en HTML UTF-8", async () => {
    const { manager, contract, h } = await agence();
    const { body: notice } = await emettre(h, contract.id, { deadlineDays: 8 });

    const proprio = await document(h, notice.id);
    expect(proprio.status).toBe(200);
    expect(proprio.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(proprio.text).toContain("MISE EN DEMEURE DE PAYER");

    const collab = await document(await jetonCollaborateur(manager.id, "READ_ONLY"), notice.id);
    expect(collab.status).toBe(200);
    expect(collab.text).toBe(proprio.text);
  });
});
