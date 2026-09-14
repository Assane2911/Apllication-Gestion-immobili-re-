import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformSubscriptions, users } from "../db/schema";
import { createManager, createPlatformSubscription } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { activateSubscriptionRecord } from "./subscriptionActivation.service";

const JOUR = 24 * 60 * 60 * 1000;

describe("activateSubscriptionRecord", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("regroupe ses deux écritures dans UNE transaction", async () => {
    // Régression : la fonction écrit l'historique de facturation PUIS les
    // droits d'accès du compte. Sans transaction, l'échec de la seconde
    // laissait un client qui a payé, dont l'historique le confirme, mais dont
    // l'accès reste fermé — et qui ne peut pas repayer, l'enregistrement étant
    // déjà PAID. Les trois appelants (webhooks Stripe et PayDunya, validation
    // d'un virement) n'en ouvraient aucune.
    const manager = await createManager({ subscriptionStatus: "TRIAL" });
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      paymentMethod: "BANK_TRANSFER",
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const espion = vi.spyOn(testDb, "transaction");

    // Appel SANS client : c'est le cas des trois appelants réels.
    await activateSubscriptionRecord(record.id);

    expect(espion).toHaveBeenCalledTimes(1);

    // Et les deux écritures ont bien abouti.
    const [apres] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(apres.status).toBe("PAID");

    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("ACTIVE");
  });

  it("rejoint la transaction de l'appelant au lieu d'en imbriquer une seconde", async () => {
    // subscribe() et les tests existants passent leur propre client : la
    // fonction ne doit pas ouvrir une transaction dans une transaction.
    const manager = await createManager({ subscriptionStatus: "TRIAL" });
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "STARTER",
      paymentMethod: "BANK_TRANSFER",
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const espion = vi.spyOn(testDb, "transaction");

    await activateSubscriptionRecord(record.id, testDb);

    expect(espion).not.toHaveBeenCalled();

    const [apres] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(apres.status).toBe("PAID");
  });

  it("bascule l'enregistrement en PAID et débloque l'accès du compte correspondant", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL" });
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      paymentMethod: "BANK_TRANSFER",
      endDate,
    });

    const updated = await activateSubscriptionRecord(record.id, testDb);

    expect(updated?.status).toBe("PAID");

    const [updatedUser] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedUser.subscriptionStatus).toBe("ACTIVE");
    expect(updatedUser.subscriptionPlan).toBe("PRO");
    expect(updatedUser.subscriptionPaymentMethod).toBe("BANK_TRANSFER");

    // La fin des droits vient du RECALCUL fait ici, pas de la date figée à la
    // demande : un mois plein à partir de l'ouverture de l'accès, et non les
    // 30 jours qu'annonçait l'enregistrement (voir le test suivant).
    expect(updatedUser.subscriptionEndsAt!.getTime()).toBe(updated!.endDate.getTime());
    expect(updatedUser.subscriptionEndsAt!.getTime()).toBeGreaterThan(endDate.getTime() - JOUR);
  });

  // Régression. La période était figée au moment de la DEMANDE, alors que
  // l'accès ne s'ouvre qu'à la validation du virement par un administrateur.
  // Entre les deux il s'écoule souvent plusieurs jours : le client payait un
  // mois et en recevait trois semaines.
  it("ne fait pas courir l'abonnement pendant l'attente de validation du virement", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL" });

    // Virement déclaré il y a 12 jours, validé seulement aujourd'hui.
    const demande = new Date(Date.now() - 12 * JOUR);
    const finAnnoncee = new Date(demande.getTime() + 30 * JOUR);
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      paymentMethod: "BANK_TRANSFER",
      startDate: demande,
      endDate: finAnnoncee,
    });

    const updated = await activateSubscriptionRecord(record.id, testDb);

    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const joursCouverts = (compte.subscriptionEndsAt!.getTime() - Date.now()) / JOUR;

    // Un mois entier à partir d'aujourd'hui — pas les 18 jours qui restaient.
    expect(joursCouverts).toBeGreaterThan(27);
    expect(joursCouverts).toBeLessThan(32);

    // L'historique de facturation porte les dates corrigées, sans quoi il
    // continuerait d'annoncer une période que le compte n'a pas eue.
    expect(updated!.startDate.getTime()).toBeGreaterThan(demande.getTime());
    expect(updated!.endDate.getTime()).toBe(compte.subscriptionEndsAt!.getTime());
  });

  it("reporte les droits déjà payés quand le virement anticipe l'échéance", async () => {
    // Le gestionnaire a réglé d'avance : il lui reste 20 jours au moment où
    // l'administrateur valide. Ils doivent s'ajouter, pas disparaître.
    const finEnCours = new Date(Date.now() + 20 * JOUR);
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
      subscriptionEndsAt: finEnCours,
    });
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      paymentMethod: "BANK_TRANSFER",
    });

    await activateSubscriptionRecord(record.id, testDb);

    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const joursCouverts = (compte.subscriptionEndsAt!.getTime() - Date.now()) / JOUR;
    expect(joursCouverts).toBeGreaterThan(45);
  });

  it("est idempotent : un enregistrement déjà PAID n'est pas retraité", async () => {
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "STARTER",
    });
    const record = await createPlatformSubscription(manager.id, { status: "PAID", plan: "STARTER" });

    const result = await activateSubscriptionRecord(record.id, testDb);

    expect(result?.id).toBe(record.id);
    expect(result?.status).toBe("PAID");
    // Le compte n'a pas été retouché par un second appel (pas de double
    // notification/traitement) : son plan reste tel qu'avant l'appel.
    const [unchangedUser] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(unchangedUser.subscriptionPlan).toBe("STARTER");
  });

  it("renvoie null si l'enregistrement n'existe pas", async () => {
    const result = await activateSubscriptionRecord("inexistant-id", testDb);
    expect(result).toBeNull();
  });

  it("ne modifie que le compte associé, pas les autres gestionnaires", async () => {
    const managerA = await createManager({ subscriptionStatus: "TRIAL" });
    const managerB = await createManager({ subscriptionStatus: "TRIAL" });
    const record = await createPlatformSubscription(managerA.id, { status: "PENDING", plan: "ENTERPRISE" });

    await activateSubscriptionRecord(record.id, testDb);

    const [updatedB] = await testDb.select().from(users).where(eq(users.id, managerB.id));
    expect(updatedB.subscriptionStatus).toBe("TRIAL");
  });
});
