import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { owners, tenants, users } from "../db/schema";
import {
  authHeader,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const existe = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id))).length === 1;

/** Suppression à la demande du gestionnaire (même service que la suppression par l'administration). */
function supprimerMonCompte(manager: { id: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" }) {
  return request(app).delete("/api/auth/account").set(authHeader(tokenFor(manager))).send({ password: "Password123!" });
}

/**
 * Supprimer une agence efface aussi les comptes de connexion « portail » qu'elle seule rattachait : l'adresse e-mail et
 * l'empreinte du mot de passe d'un locataire ou d'un propriétaire ne servent plus à rien une fois leurs fiches parties, et
 * plus personne ne pourrait en demander l'effacement (la suppression d'un compte est réservée aux gestionnaires).
 */
describe("suppression d'une agence — comptes portail orphelins", () => {
  it("efface les comptes locataire et propriétaire que l'agence était seule à rattacher", async () => {
    const manager = await createManager();
    const locataire = await createTenant(manager.id);
    const comptes = await createTenantPortalUser(locataire);
    const proprietaire = await createOwner(manager.id);
    const comptesProprietaire = await createOwnerPortalUser(proprietaire);

    const res = await supprimerMonCompte(manager);

    expect(res.status).toBe(204);
    expect(await existe(manager.id)).toBe(false);
    expect(await existe(comptes.id)).toBe(false);
    expect(await existe(comptesProprietaire.id)).toBe(false);
  });

  it("garde les comptes d'une autre agence, et les fiches sans accès portail ne créent rien à effacer", async () => {
    const cible = await createManager();
    const autre = await createManager();
    await createTenant(cible.id); // pas d'accès portail
    const locataireAutre = await createTenant(autre.id);
    const compteAutre = await createTenantPortalUser(locataireAutre);

    const res = await supprimerMonCompte(cible);

    expect(res.status).toBe(204);
    expect(await existe(compteAutre.id)).toBe(true);
    expect(await existe(autre.id)).toBe(true);
    expect((await testDb.select().from(tenants).where(eq(tenants.id, locataireAutre.id)))[0].userId).toBe(compteAutre.id);
  });

  it("garde un compte qu'une fiche d'une autre agence rattache encore", async () => {
    const cible = await createManager();
    const autre = await createManager();
    const locataire = await createTenant(cible.id);
    const compte = await createTenantPortalUser(locataire);
    // Le même compte est aussi rattaché à une fiche propriétaire d'une autre agence : il ne doit pas disparaître.
    const proprietaireAutre = await createOwner(autre.id);
    await testDb.update(owners).set({ userId: compte.id }).where(eq(owners.id, proprietaireAutre.id));

    const res = await supprimerMonCompte(cible);

    expect(res.status).toBe(204);
    expect(await existe(compte.id)).toBe(true);
    expect((await testDb.select().from(owners).where(eq(owners.id, proprietaireAutre.id)))[0].userId).toBe(compte.id);
  });

  it("n'efface jamais un compte d'un autre rôle, même rattaché à une fiche de l'agence supprimée", async () => {
    const cible = await createManager();
    const autre = await createManager();
    const proprietaire = await createOwner(cible.id);
    // Cas contre nature, mais la base le permet : un gestionnaire pointé par une fiche propriétaire.
    await testDb.update(owners).set({ userId: autre.id }).where(eq(owners.id, proprietaire.id));

    const res = await supprimerMonCompte(cible);

    expect(res.status).toBe(204);
    expect(await existe(autre.id)).toBe(true);
  });

  it("supporte un grand portefeuille : plus de 1 000 comptes portail à effacer, par lots", async () => {
    const manager = await createManager();
    const identifiants: string[] = [];
    for (let i = 0; i < 1005; i++) {
      const [compte] = await testDb
        .insert(users)
        .values({ email: `lot-${i}@test.local`, passwordHash: "x", role: "TENANT" })
        .returning();
      await testDb.insert(tenants).values({
        managerId: manager.id,
        firstName: "A",
        lastName: `B${i}`,
        email: `lot-${i}@test.local`,
        phone: "+221770000000",
        userId: compte.id,
      });
      identifiants.push(compte.id);
    }

    const res = await supprimerMonCompte(manager);

    expect(res.status).toBe(204);
    const restants = await testDb.select({ id: users.id }).from(users).where(eq(users.role, "TENANT"));
    expect(restants.filter((r: { id: string }) => identifiants.includes(r.id))).toHaveLength(0);
  }, 60_000);
});
