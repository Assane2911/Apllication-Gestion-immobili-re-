import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { suggestions } from "../db/schema";
import { authHeader, createManager, createOwner, createOwnerPortalUser, createTeamMember, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/**
 * Les suggestions recopient l'adresse e-mail de leur auteur (`authorLabel`), pour rester lisibles quand le compte disparaît.
 * Une suppression de compte « définitive » ne doit donc pas les laisser derrière elle : l'adresse y resterait indéfiniment,
 * sans compte pour en demander l'effacement.
 */
async function suggerer(auteur: { id: string; email: string; role: "MANAGER" | "TENANT" | "OWNER" }, message: string) {
  const [ligne] = await testDb
    .insert(suggestions)
    .values({ authorId: auteur.id, authorLabel: auteur.email, authorRole: auteur.role, message })
    .returning();
  return ligne;
}

const supprimerMonCompte = (manager: { id: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" }) =>
  request(app).delete("/api/auth/account").set(authHeader(tokenFor(manager))).send({ password: "Password123!" });

const existe = async (id: string) => (await testDb.select().from(suggestions).where(eq(suggestions.id, id))).length === 1;

describe("suppression d'une agence — suggestions de ses auteurs", () => {
  it("efface les suggestions du gestionnaire supprimé : son adresse n'y survit pas", async () => {
    const manager = await createManager();
    const sienne = await suggerer(manager, "Ajouter un export Excel");

    const res = await supprimerMonCompte(manager);

    expect(res.status).toBe(204);
    expect(await existe(sienne.id)).toBe(false);
    const restantes = await testDb.select().from(suggestions);
    expect(restantes.some((s: { authorLabel: string }) => s.authorLabel === manager.email)).toBe(false);
  });

  it("efface aussi celles des comptes qui partent avec l'agence : collaborateur, locataire et propriétaire portail", async () => {
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    const locataire = await createTenant(manager.id);
    const compteLocataire = await createTenantPortalUser(locataire);
    const proprietaire = await createOwner(manager.id);
    const compteProprietaire = await createOwnerPortalUser(proprietaire);
    const lignes = [
      await suggerer(collaborateur, "Du collaborateur"),
      await suggerer(compteLocataire, "Du locataire"),
      await suggerer(compteProprietaire, "Du propriétaire"),
    ];

    await supprimerMonCompte(manager);

    for (const ligne of lignes) expect(await existe(ligne.id)).toBe(false);
  });

  it("garde les suggestions des autres agences, y compris celles de leurs locataires", async () => {
    const cible = await createManager();
    const autre = await createManager();
    const sienneAutre = await suggerer(autre, "D'une autre agence");
    const locataireAutre = await createTenant(autre.id);
    const compteAutre = await createTenantPortalUser(locataireAutre);
    const duLocataireAutre = await suggerer(compteAutre, "D'un locataire d'une autre agence");
    await supprimerMonCompte(cible);

    expect(await existe(sienneAutre.id)).toBe(true);
    expect(await existe(duLocataireAutre.id)).toBe(true);
  });
});
