import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLogs, contracts, tenants, users } from "../db/schema";
import {
  createContract,
  createManager,
  createProperty,
  createTenant,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { donneesArriveesAEcheance, purgerDonneesDeLaPlateforme } from "./conservation.service";

/**
 * Deux natures de données, deux traitements — c'est tout le principe de ce
 * fichier.
 *
 * Ce qui appartient à LA PLATEFORME (jetons de réinitialisation périmés,
 * journaux d'activité anciens) est purgé automatiquement : personne n'a besoin
 * d'en décider, et les garder n'a aucune utilité.
 *
 * Ce qui appartient aux GESTIONNAIRES (fiches locataires, baux) n'est jamais
 * détruit par la plateforme. Pour ces données, le Gestionnaire est responsable
 * de traitement et le Service sous-traitant : un sous-traitant exécute les
 * instructions du responsable, il ne décide pas seul d'effacer. Et la règle de
 * durée dépend de faits que la plateforme ignore — gestion directe ou
 * déléguée, litige en cours qui suspend l'effacement. Le Service SIGNALE donc
 * les échéances, et le Gestionnaire tranche.
 */
describe("Purge automatique des données de la plateforme", () => {
  it("efface les jetons de réinitialisation et de confirmation périmés", async () => {
    const perime = await createManager({
      resetPasswordTokenHash: "empreinte-perimee",
      resetPasswordExpiresAt: new Date(Date.now() - 3_600_000),
      emailVerificationTokenHash: "empreinte-confirmation",
      emailVerificationExpiresAt: new Date(Date.now() - 3_600_000),
    });

    const resultat = await purgerDonneesDeLaPlateforme();

    const [apres] = await testDb.select().from(users).where(eq(users.id, perime.id));
    expect(apres.resetPasswordTokenHash).toBeNull();
    expect(apres.resetPasswordExpiresAt).toBeNull();
    expect(apres.emailVerificationTokenHash).toBeNull();
    expect(resultat.jetonsEffaces).toBeGreaterThanOrEqual(1);
  });

  it("laisse intact un jeton encore valide", async () => {
    // Contre-épreuve : purger un jeton en cours de validité casserait une
    // réinitialisation légitime entre l'envoi de l'email et le clic.
    const valide = await createManager({
      resetPasswordTokenHash: "empreinte-valide",
      resetPasswordExpiresAt: new Date(Date.now() + 3_600_000),
    });

    await purgerDonneesDeLaPlateforme();

    const [apres] = await testDb.select().from(users).where(eq(users.id, valide.id));
    expect(apres.resetPasswordTokenHash).toBe("empreinte-valide");
  });

  it("efface les entrées de journal de plus d'un an, garde les récentes", async () => {
    const manager = await createManager();
    const entree = (createdAt: Date) => ({
      managerId: manager.id,
      actorLabel: manager.email,
      action: "property.create",
      entityType: "property",
      entityLabel: "Studio",
      createdAt,
    });
    await testDb.insert(activityLogs).values([
      entree(new Date(Date.now() - 400 * 24 * 3_600_000)),
      entree(new Date(Date.now() - 30 * 24 * 3_600_000)),
    ]);

    const resultat = await purgerDonneesDeLaPlateforme();

    const restantes = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(restantes).toHaveLength(1);
    expect(resultat.journauxEffaces).toBe(1);
  });

  it("ne touche à aucune donnée locative", async () => {
    // Le point central : la purge automatique s'arrête à la frontière des
    // données dont le gestionnaire est responsable.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2010, 0, 1),
      endDate: new Date(2011, 0, 1),
      status: "ENDED",
    });

    await purgerDonneesDeLaPlateforme();

    expect(await testDb.select().from(tenants).where(eq(tenants.id, tenant.id))).toHaveLength(1);
    expect(await testDb.select().from(contracts).where(eq(contracts.tenantId, tenant.id))).toHaveLength(1);
  });
});

describe("Signalement des données arrivées à échéance", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 24));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signale une fiche sans aucun bail, ouverte depuis plus de trois mois", async () => {
    // Le référentiel CNIL ramène à trois mois le dossier d'un candidat non
    // retenu : une fiche que rien n'a transformée en bail en relève.
    const manager = await createManager();
    await createTenant(manager.id, {
      firstName: "Candidat",
      lastName: "Ancien",
      createdAt: new Date(2026, 3, 1),
    });
    await createTenant(manager.id, { firstName: "Candidat", lastName: "Recent", createdAt: new Date(2026, 8, 1) });

    const echeances = await donneesArriveesAEcheance(manager.id);

    expect(echeances.fichesSansBail).toHaveLength(1);
    expect(echeances.fichesSansBail[0].lastName).toBe("Ancien");
  });

  it("signale un locataire dont le dernier bail s'est achevé il y a plus de cinq ans", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const ancien = await createTenant(manager.id, { lastName: "Parti" });
    await createContract(property.id, ancien.id, {
      startDate: new Date(2018, 0, 1),
      endDate: new Date(2020, 0, 1),
      status: "ENDED",
    });
    const recent = await createTenant(manager.id, { lastName: "Recent" });
    await createContract(property.id, recent.id, {
      startDate: new Date(2024, 0, 1),
      endDate: new Date(2025, 0, 1),
      status: "ENDED",
    });

    const echeances = await donneesArriveesAEcheance(manager.id);

    expect(echeances.bauxClosDepuisLongtemps.map((t) => t.lastName)).toEqual(["Parti"]);
  });

  it("ne signale pas un locataire déjà anonymisé, dont il ne reste rien à effacer", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { anonymizedAt: new Date(2026, 0, 1) });
    await createContract(property.id, tenant.id, {
      startDate: new Date(2018, 0, 1),
      endDate: new Date(2020, 0, 1),
      status: "ENDED",
    });

    const echeances = await donneesArriveesAEcheance(manager.id);

    expect(echeances.bauxClosDepuisLongtemps).toHaveLength(0);
  });

  it("ne signale jamais un locataire dont un bail est encore en cours", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2015, 0, 1),
      endDate: new Date(2030, 0, 1),
      status: "ACTIVE",
    });

    const echeances = await donneesArriveesAEcheance(manager.id);

    expect(echeances.bauxClosDepuisLongtemps).toHaveLength(0);
    expect(echeances.fichesSansBail).toHaveLength(0);
  });

  it("ne mélange jamais les échéances de deux agences", async () => {
    const manager = await createManager();
    const autre = await createManager();
    await createTenant(autre.id, { lastName: "AutreAgence", createdAt: new Date(2026, 3, 1) });

    const echeances = await donneesArriveesAEcheance(manager.id);

    expect(echeances.fichesSansBail).toHaveLength(0);
    expect(echeances.total).toBe(0);
  });

  it("ne supprime rien : signaler n'est pas effacer", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { createdAt: new Date(2026, 3, 1) });

    await donneesArriveesAEcheance(manager.id);

    const [intact] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(intact).toBeDefined();
    expect(intact.anonymizedAt).toBeNull();
    expect(await testDb.select().from(tenants).where(isNull(tenants.anonymizedAt))).toHaveLength(1);
  });
});
