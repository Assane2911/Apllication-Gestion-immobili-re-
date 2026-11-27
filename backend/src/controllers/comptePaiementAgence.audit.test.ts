import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { activityLogs, agencyPaymentAccounts } from "../db/schema";
import { authHeader, createManager, tokenCollaborateur, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de comptePaiementAgence.controller.ts : les bornes de la validation des identifiants, l'accès réservé au
 * propriétaire sur CHAQUE geste d'écriture, et ce que le journal d'activité retient — sans jamais un identifiant.
 */
const URL = "/api/agency/payment-account";
const CLE = "ab".repeat(32);
const AGENCE = { masterKey: "agence-master-key-1", privateKey: "agence-private-key-1", token: "agence-token-1234", mode: "live", currency: "xof" };

const cleOriginale = env.payments.keysEncryptionKey;
beforeEach(() => {
  env.payments.keysEncryptionKey = CLE;
});
afterEach(() => {
  env.payments.keysEncryptionKey = cleOriginale;
});

const enregistrer = (token: string, corps: Record<string, unknown>) => request(app).put(URL).set(authHeader(token)).send(corps);

async function comptes() {
  return testDb.select().from(agencyPaymentAccounts);
}
async function journal(action: string, managerId: string) {
  return testDb
    .select()
    .from(activityLogs)
    .where(and(eq(activityLogs.action, action), eq(activityLogs.managerId, managerId)));
}
async function toutLeJournal(managerId: string) {
  return testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));
}

describe("enregistrement : bornes de la validation", () => {
  it.each([
    ["clé principale de 7 caractères", { masterKey: "1234567" }],
    ["clé privée de 7 caractères", { privateKey: "1234567" }],
    ["jeton de 7 caractères", { token: "1234567" }],
    ["clé principale de 201 caractères", { masterKey: "k".repeat(201) }],
    ["clé privée de 201 caractères", { privateKey: "k".repeat(201) }],
    ["jeton de 201 caractères", { token: "k".repeat(201) }],
    ["clé principale avec une espace au milieu", { masterKey: "agence master-key" }],
    ["jeton avec un retour à la ligne", { token: "agence-token\n1234" }],
    ["clé privée vide", { privateKey: "" }],
    ["clé principale absente", { masterKey: undefined }],
    ["devise de 2 lettres", { currency: "XO" }],
    ["devise de 4 lettres", { currency: "XOFF" }],
    ["devise vide", { currency: "" }],
    ["mode inconnu", { mode: "sandbox" }],
    ["mode absent", { mode: undefined }],
    ["activation en texte", { enabled: "false" }],
  ])("refuse %s : 400, rien d'enregistré, rien de journalisé", async (_nom, ecart) => {
    const manager = await createManager();
    const res = await enregistrer(tokenFor(manager), { ...AGENCE, ...ecart });

    expect(res.status).toBe(400);
    expect(await comptes()).toHaveLength(0);
    expect(await toutLeJournal(manager.id)).toHaveLength(0);
  });

  it("accepte les valeurs limites : 8 caractères pile et 200 caractères pile", async () => {
    const manager = await createManager();
    const res = await enregistrer(tokenFor(manager), { ...AGENCE, masterKey: "12345678", privateKey: "p".repeat(200), token: "t".repeat(200) });
    expect(res.status).toBe(200);
    expect(await comptes()).toHaveLength(1);
  });

  it("retire les espaces autour des identifiants : le jeton se termine par ses vrais quatre derniers caractères", async () => {
    const manager = await createManager();
    const res = await enregistrer(tokenFor(manager), { ...AGENCE, token: "   agence-token-9876  " });
    expect(res.status).toBe(200);
    expect(res.body.tokenLast4).toBe("9876");
    const [ligne] = await comptes();
    expect(ligne.tokenLast4).toBe("9876");
  });

  it("met la devise en majuscules et la renvoie ainsi", async () => {
    const manager = await createManager();
    const res = await enregistrer(tokenFor(manager), { ...AGENCE, currency: " eur " });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("EUR");
  });

  it("sans `enabled`, le compte est actif ; avec `enabled: false`, il est enregistré mais suspendu", async () => {
    const a = await createManager();
    const actif = await enregistrer(tokenFor(a), AGENCE);
    expect(actif.body.enabled).toBe(true);

    const b = await createManager();
    const suspendu = await enregistrer(tokenFor(b), { ...AGENCE, enabled: false });
    expect(suspendu.status).toBe(200);
    expect(suspendu.body.enabled).toBe(false);
    expect(suspendu.body.configure).toBe(true);
  });

  it("répond avec le résumé du compte et `disponible: true`, sans aucun identifiant", async () => {
    const manager = await createManager();
    const res = await enregistrer(tokenFor(manager), AGENCE);

    expect(res.body).toEqual({ configure: true, enabled: true, mode: "live", currency: "XOF", tokenLast4: "1234", disponible: true });
  });

  it("sans clé de chiffrement : 503, rien d'enregistré et rien de journalisé", async () => {
    env.payments.keysEncryptionKey = "";
    const manager = await createManager();
    const res = await enregistrer(tokenFor(manager), AGENCE);

    expect(res.status).toBe(503);
    expect(await comptes()).toHaveLength(0);
    expect(await toutLeJournal(manager.id)).toHaveLength(0);
  });
});

describe("journal d'activité : jamais un identifiant", () => {
  it("l'enregistrement est tracé avec le mode, la devise et la fin du jeton, sans aucun identifiant", async () => {
    const manager = await createManager();
    await enregistrer(tokenFor(manager), AGENCE);

    const [trace] = await journal("agency.payment_account_set", manager.id);
    expect(trace).toBeDefined();
    expect(trace.entityType).toBe("agency");
    expect(trace.entityId).toBe(manager.id);
    expect(trace.entityLabel).toBe("Compte PayDunya");
    expect(trace.details).toContain("mode live");
    expect(trace.details).toContain("devise XOF");
    expect(trace.details).toContain("…1234");

    const tout = JSON.stringify(await toutLeJournal(manager.id));
    for (const secret of [AGENCE.masterKey, AGENCE.privateKey, AGENCE.token]) expect(tout).not.toContain(secret);
  });

  it("suspendre et réactiver sont tracés chacun sous son action", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await enregistrer(token, AGENCE);

    const suspendu = await request(app).patch(URL).set(authHeader(token)).send({ enabled: false });
    expect(suspendu.status).toBe(200);
    expect(suspendu.body.enabled).toBe(false);
    expect((await journal("agency.payment_account_disabled", manager.id))[0].details).toBe("Paiement du loyer en ligne suspendu.");
    expect(await journal("agency.payment_account_enabled", manager.id)).toHaveLength(0);

    const reactive = await request(app).patch(URL).set(authHeader(token)).send({ enabled: true });
    expect(reactive.status).toBe(200);
    expect(reactive.body.enabled).toBe(true);
    expect((await journal("agency.payment_account_enabled", manager.id))[0].details).toBe("Paiement du loyer en ligne activé.");
    expect(await journal("agency.payment_account_disabled", manager.id)).toHaveLength(1);
  });

  it("la suppression est tracée", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await enregistrer(token, AGENCE);

    const res = await request(app).delete(URL).set(authHeader(token));
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    const [trace] = await journal("agency.payment_account_removed", manager.id);
    expect(trace).toBeDefined();
    expect(trace.entityId).toBe(manager.id);
  });
});

describe("basculer le compte", () => {
  it.each([[{}], [{ enabled: "true" }], [{ enabled: 1 }], [{ enabled: null }]])("refuse le corps %j (400) sans rien changer", async (corps) => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await enregistrer(token, AGENCE);

    const res = await request(app).patch(URL).set(authHeader(token)).send(corps);
    expect(res.status).toBe(400);
    const [ligne] = await comptes();
    expect(ligne.enabled).toBe(true);
    expect(await journal("agency.payment_account_disabled", manager.id)).toHaveLength(0);
    expect(await journal("agency.payment_account_enabled", manager.id)).toHaveLength(0);
  });

  it("sans compte : 404 AGENCY_PAYMENT_NOT_FOUND, et rien n'est journalisé", async () => {
    const manager = await createManager();
    const res = await request(app).patch(URL).set(authHeader(tokenFor(manager))).send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("AGENCY_PAYMENT_NOT_FOUND");
    expect(await toutLeJournal(manager.id)).toHaveLength(0);
    expect(await comptes()).toHaveLength(0);
  });

  it("la réponse dit si le chiffrement est disponible : vrai avec la clé, faux si la clé a disparu depuis l'enregistrement", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await enregistrer(token, AGENCE);

    const avecCle = await request(app).patch(URL).set(authHeader(token)).send({ enabled: false });
    expect(avecCle.body.disponible).toBe(true);

    env.payments.keysEncryptionKey = "";
    const sansCle = await request(app).patch(URL).set(authHeader(token)).send({ enabled: true });
    expect(sansCle.status).toBe(200);
    expect(sansCle.body.disponible).toBe(false);
  });

  it("suspendre ne touche ni aux identifiants chiffrés ni au mode, à la devise et à la fin du jeton", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await enregistrer(token, AGENCE);
    const [avant] = await comptes();

    await request(app).patch(URL).set(authHeader(token)).send({ enabled: false });
    const [apres] = await comptes();
    expect({ ...apres, enabled: avant.enabled, updatedAt: avant.updatedAt }).toEqual(avant);
    expect(apres.enabled).toBe(false);
  });
});

describe("accès : le propriétaire écrit, le collaborateur lit au plus", () => {
  it.each([
    ["PUT", (t: string) => request(app).put(URL).set(authHeader(t)).send(AGENCE)],
    ["PATCH", (t: string) => request(app).patch(URL).set(authHeader(t)).send({ enabled: false })],
    ["DELETE", (t: string) => request(app).delete(URL).set(authHeader(t))],
  ])("%s est refusé à un collaborateur (403 AGENCY_PAYMENT_OWNER_ONLY) et ne change rien", async (_verbe, appeler) => {
    const manager = await createManager();
    await enregistrer(tokenFor(manager), AGENCE);
    const [avant] = await comptes();
    const journalAvant = (await toutLeJournal(manager.id)).length;

    const res = await appeler(await tokenCollaborateur(manager));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AGENCY_PAYMENT_OWNER_ONLY");

    const lignes = await comptes();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toEqual(avant);
    expect((await toutLeJournal(manager.id)).length).toBe(journalAvant);
  });

  it.each([
    ["GET", () => request(app).get(URL)],
    ["PUT", () => request(app).put(URL).send(AGENCE)],
    ["PATCH", () => request(app).patch(URL).send({ enabled: false })],
    ["DELETE", () => request(app).delete(URL)],
  ])("%s exige une connexion (401)", async (_verbe, appeler) => {
    expect((await appeler()).status).toBe(401);
  });

  it("la lecture reste ouverte à un collaborateur, avec le seul résumé : jamais un identifiant", async () => {
    const manager = await createManager();
    await enregistrer(tokenFor(manager), AGENCE);

    const res = await request(app).get(URL).set(authHeader(await tokenCollaborateur(manager)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configure: true, enabled: true, mode: "live", currency: "XOF", tokenLast4: "1234", disponible: true });
  });

  it("un compte d'agence sans compte de paiement : résumé vide (mode test, XOF), et `disponible` selon la clé de chiffrement", async () => {
    const manager = await createManager();
    const avecCle = await request(app).get(URL).set(authHeader(tokenFor(manager)));
    expect(avecCle.body).toEqual({ configure: false, enabled: false, mode: "test", currency: "XOF", tokenLast4: "", disponible: true });

    env.payments.keysEncryptionKey = "";
    const sansCle = await request(app).get(URL).set(authHeader(tokenFor(manager)));
    expect(sansCle.body.disponible).toBe(false);
  });

  it("supprimer deux fois de suite reste sans erreur (204), et ne touche pas le compte d'une autre agence", async () => {
    const a = await createManager();
    const b = await createManager();
    await enregistrer(tokenFor(a), AGENCE);
    await enregistrer(tokenFor(b), AGENCE);

    expect((await request(app).delete(URL).set(authHeader(tokenFor(a)))).status).toBe(204);
    expect((await request(app).delete(URL).set(authHeader(tokenFor(a)))).status).toBe(204);

    const restants = await comptes();
    expect(restants).toHaveLength(1);
    expect(restants[0].managerId).toBe(b.id);
  });
});
