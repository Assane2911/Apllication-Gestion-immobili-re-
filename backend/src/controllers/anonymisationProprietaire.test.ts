import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, owners, properties, users } from "../db/schema";
import {
  authHeader,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Pendant de anonymisationLocataire.test.ts, côté propriétaire : `deleteOwner`
 * refuse — à juste titre — de supprimer un propriétaire associé à un ou
 * plusieurs biens (les comptes-rendus de gestion et reversements doivent
 * rester traçables), ce qui ne laissait aucune issue au propriétaire qui
 * demande l'effacement de ses données tant qu'un bien lui reste associé.
 *
 * L'anonymisation est cette issue : les données qui l'IDENTIFIENT
 * disparaissent (civilité, nom, raison sociale, email, téléphone, adresse,
 * IBAN/BIC, notes, compte d'accès), les biens et l'historique de gestion
 * restent, rattachés à une fiche devenue anonyme.
 */
describe("Anonymisation d'un propriétaire", () => {
  async function proprietaireAvecBien() {
    const manager = await createManager();
    const owner = await createOwner(manager.id, {
      companyName: "SCI Les Palmiers",
      address: "12 rue de la Paix, Dakar",
      iban: "FR7630006000011234567890189",
      bic: "AGRIFRPP",
      notes: "Préfère être contacté par email",
    });
    const property = await createProperty(manager.id, { ownerId: owner.id });
    return { manager, owner, property };
  }

  it("efface les données identifiantes et conserve le bien associé", async () => {
    const { manager, owner, property } = await proprietaireAvecBien();

    const res = await request(app)
      .post(`/api/owners/${owner.id}/anonymiser`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);

    const [apres] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(apres.firstName).toBe("Propriétaire");
    expect(apres.lastName).toBe("anonymisé");
    expect(apres.companyName).toBeNull();
    expect(apres.phone).toBe("");
    expect(apres.address).toBeNull();
    expect(apres.iban).toBeNull();
    expect(apres.bic).toBeNull();
    expect(apres.notes).toBeNull();
    expect(apres.anonymizedAt).not.toBeNull();
    // Même domaine réservé (RFC 2606) que anonymiserTenant, garanti sans
    // existence : aucun envoi ne peut plus atteindre qui que ce soit.
    expect(apres.email).toMatch(/@supprime\.invalid$/);
    expect(apres.email).not.toBe(owner.email);

    // Le bien associé — et donc l'historique de gestion qui s'y rattache —
    // doit survivre, c'est tout l'intérêt de l'anonymisation par rapport à
    // une suppression que deleteOwner aurait de toute façon refusée.
    const [bienApres] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(bienApres).toBeDefined();
    expect(bienApres.ownerId).toBe(owner.id);
  });

  it("efface le nom réel du propriétaire des entrées passées du journal d'activité, sans toucher au reste du texte", async () => {
    const { manager, owner } = await proprietaireAvecBien();
    const nomReel = `${owner.firstName} ${owner.lastName}`;

    await testDb.insert(activityLogs).values([
      {
        managerId: manager.id,
        actorLabel: `Gestionnaire (${manager.email})`,
        action: "owner.create",
        entityType: "owner",
        entityId: owner.id,
        entityLabel: nomReel,
        details: `Propriétaire ajouté : ${nomReel} (${owner.email})`,
      },
      {
        managerId: manager.id,
        actorLabel: `Gestionnaire (${manager.email})`,
        action: "owner.update",
        entityType: "owner",
        entityId: owner.id,
        entityLabel: nomReel,
        details: `Propriétaire modifié : ${nomReel}`,
      },
    ]);

    await request(app).post(`/api/owners/${owner.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    const entrees: (typeof activityLogs.$inferSelect)[] = await testDb
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.managerId, manager.id));
    for (const entree of entrees) {
      expect(entree.entityLabel).not.toContain(nomReel);
      if (entree.details) expect(entree.details).not.toContain(nomReel);
    }
    const entreeAnonymisation = entrees.find((e) => e.action === "owner.anonymize");
    expect(entreeAnonymisation).toBeDefined();
    expect(entreeAnonymisation?.entityLabel).not.toContain(nomReel);
    expect(entreeAnonymisation?.details).not.toContain(nomReel);
  });

  it("supprime le compte d'accès au portail, qui portait lui aussi une adresse email", async () => {
    const { manager, owner } = await proprietaireAvecBien();
    const comptePortail = await createOwnerPortalUser(owner);

    await request(app).post(`/api/owners/${owner.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    const restant = await testDb.select().from(users).where(eq(users.id, comptePortail.id));
    expect(restant).toHaveLength(0);
    const [apres] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(apres.userId).toBeNull();
  });

  it("refuse une seconde anonymisation, qui n'aurait plus rien à effacer", async () => {
    const { manager, owner } = await proprietaireAvecBien();
    await request(app).post(`/api/owners/${owner.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    const res = await request(app)
      .post(`/api/owners/${owner.id}/anonymiser`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });

  it("refuse d'anonymiser le propriétaire d'une autre agence", async () => {
    const { owner } = await proprietaireAvecBien();
    const autreManager = await createManager();

    const res = await request(app)
      .post(`/api/owners/${owner.id}/anonymiser`)
      .set(authHeader(tokenFor(autreManager)));

    expect(res.status).toBe(404);
    const [intact] = await testDb.select().from(owners).where(eq(owners.id, owner.id));
    expect(intact.anonymizedAt).toBeNull();
  });

  it("reste disponible même sans aucun bien associé", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    const res = await request(app)
      .post(`/api/owners/${owner.id}/anonymiser`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
  });
});
