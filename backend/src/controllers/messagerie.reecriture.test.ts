import { sql } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

/**
 * Le fil est relu en continu (rafraîchissement automatique) : ouvrir ou rafraîchir une conversation ne doit réécrire QUE les messages
 * qui passent de « non lu » à « lu ». PostgreSQL crée une nouvelle version de ligne à chaque UPDATE, même quand la valeur ne change pas :
 * sans ce filtre, chaque rafraîchissement réécrivait tous les messages déjà lus du fil (base alourdie, journal d'écriture gonflé).
 * `xmin` est le numéro de la transaction qui a écrit la version courante d'une ligne : il ne change que si la ligne est réécrite.
 */
async function bail() {
  const gestionnaire = await createManager({ subscriptionPlan: "PRO" });
  const property = await createProperty(gestionnaire.id);
  const tenant = await createTenant(gestionnaire.id);
  const contract = await createContract(property.id, tenant.id);
  const portail = await createTenantPortalUser(tenant);
  return { contract, tokenManager: tokenFor(gestionnaire), tokenTenant: tokenFor(portail, tenant.id), url: `/api/messages/${contract.id}` };
}

const versions = async (): Promise<Record<string, string>> => {
  const res = await testDb.execute(sql`SELECT id, xmin::text AS v FROM messages ORDER BY id`);
  const lignes = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<{ id: string; v: string }>;
  return Object.fromEntries(lignes.map((l) => [l.id, l.v]));
};

describe("lecture d'un fil : seuls les messages non lus sont réécrits", () => {
  it("un rafraîchissement sans nouveauté ne réécrit aucune ligne", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    for (const t of ["un", "deux", "trois"]) await request(app).post(url).set(authHeader(tokenManager)).send({ content: t });
    await request(app).post(url).set(authHeader(tokenTenant)).send({ content: "réponse" });

    // Première ouverture par le locataire : les 3 messages de l'agence passent à « lu ».
    await request(app).get(url).set(authHeader(tokenTenant));
    const apres = await versions();

    // Rafraîchissements suivants, des deux côtés : rien de nouveau à marquer, donc aucune ligne réécrite.
    await request(app).get(url).set(authHeader(tokenTenant));
    await request(app).get(url).set(authHeader(tokenTenant));
    expect(await versions()).toEqual(apres);
  });

  it("marque toujours les nouveaux messages comme lus, et seulement eux", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    await request(app).post(url).set(authHeader(tokenManager)).send({ content: "ancien" });
    await request(app).get(url).set(authHeader(tokenTenant));
    const avant = await versions();

    await request(app).post(url).set(authHeader(tokenManager)).send({ content: "nouveau" });
    const res = await request(app).get(url).set(authHeader(tokenTenant));

    const lus = Object.fromEntries(res.body.messages.map((m: { content: string; isRead: boolean }) => [m.content, m.isRead]));
    expect(lus.ancien).toBe(true);
    const apresOuverture = await testDb.execute(sql`SELECT content, is_read FROM messages ORDER BY created_at`);
    const lignes = (Array.isArray(apresOuverture) ? apresOuverture : (apresOuverture as { rows: unknown[] }).rows) as Array<{ content: string; is_read: boolean }>;
    expect(lignes.every((l) => l.is_read)).toBe(true);

    const maintenant = await versions();
    const reecrites = Object.keys(maintenant).filter((id) => avant[id] !== undefined && maintenant[id] !== avant[id]);
    expect(reecrites).toHaveLength(0); // l'ancien message n'a pas été touché ; le nouveau est une ligne nouvelle
  });

  it("ne touche pas aux messages que l'on a soi-même écrits", async () => {
    const { url, tokenManager, tokenTenant } = await bail();
    await request(app).post(url).set(authHeader(tokenTenant)).send({ content: "de moi" });
    const avant = await versions();

    await request(app).get(url).set(authHeader(tokenTenant));

    expect(await versions()).toEqual(avant);
    // Et pour le gestionnaire, le message du locataire reste « non lu » jusqu'à ce qu'il l'ouvre.
    const lignes = await testDb.execute(sql`SELECT is_read FROM messages`);
    const rows = (Array.isArray(lignes) ? lignes : (lignes as { rows: unknown[] }).rows) as Array<{ is_read: boolean }>;
    expect(rows.map((l) => l.is_read)).toEqual([false]);
    await request(app).get(url).set(authHeader(tokenManager));
  });
});
