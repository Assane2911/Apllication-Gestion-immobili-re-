import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformSubscriptions, users } from "../db/schema";
import { createManager, createPlatformSubscription } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { activateSubscriptionRecord } from "./subscriptionActivation.service";

const JOUR = 24 * 60 * 60 * 1000;

/**
 * Enveloppe récursivement un query builder Drizzle (select().from().where()…)
 * pour retarder de `ms` la PROPAGATION du résultat final, sans changer ce que
 * chaque étape renvoie — sert à élargir artificiellement une fenêtre de
 * course entre deux appels concurrents dans les tests. Nécessaire car le
 * builder retourné par `.select(...)` seul n'a pas encore de `.then` : seule
 * la chaîne complète, une fois `.from()`/`.where()` appliqués, en devient
 * une — d'où le besoin d'intercepter récursivement chaque étape plutôt que le
 * seul objet immédiatement renvoyé par le premier appel.
 */
function retarderResultat<T>(valeur: T, ms: number): T {
  if (!valeur || (typeof valeur !== "object" && typeof valeur !== "function")) return valeur;
  return new Proxy(valeur as object, {
    get(cible, prop, recepteur) {
      const original = Reflect.get(cible, prop, recepteur);
      if (prop === "then" && typeof original === "function") {
        return (onFulfilled?: unknown, onRejected?: unknown) =>
          (original as Function).call(
            cible,
            async (v: unknown) => {
              await new Promise((resolve) => setTimeout(resolve, ms));
              return typeof onFulfilled === "function" ? (onFulfilled as (x: unknown) => unknown)(v) : v;
            },
            onRejected
          );
      }
      if (typeof original === "function") {
        return (...args: unknown[]) => retarderResultat(original.apply(cible, args), ms);
      }
      return original;
    },
  }) as T;
}

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

  // Régression : ce recalcul ignorait entièrement la proratisation
  // (calculerJoursCredit) ajoutée dans subscribe() lors d'un changement de
  // plan — il ne consultait ni record.plan, ni record.amount, ni le dernier
  // paiement réglé, se contentant de reporter le temps restant à sa valeur
  // NOMINALE PLEINE sur le nouveau plan. Cette fonction étant le SEUL chemin
  // réellement emprunté pour tout paiement confirmé de façon asynchrone
  // (virement bancaire, PayDunya, Stripe), un changement de plan payé par
  // l'un de ces moyens recevait donc le défaut que la proratisation était
  // censée corriger.
  it("reconvertit la valeur restante de l'ancien plan lors d'un changement de plan confirmé en différé", async () => {
    const finEnCours = new Date(Date.now() + 10 * JOUR);
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "STARTER",
      subscriptionEndsAt: finEnCours,
    });
    // Dernier paiement réellement réglé sur l'ancien plan : STARTER, 9 €,
    // cycle mensuel de 30 jours.
    await createPlatformSubscription(manager.id, {
      status: "PAID",
      plan: "STARTER",
      amount: 9,
      billingCycle: "MONTHLY",
      startDate: new Date(finEnCours.getTime() - 30 * JOUR),
      endDate: finEnCours,
    });
    // Upgrade vers PRO (29 €), payé par virement — confirmation différée.
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      amount: 29,
      billingCycle: "MONTHLY",
      paymentMethod: "BANK_TRANSFER",
    });

    const updated = await activateSubscriptionRecord(record.id, testDb);

    const joursCouverts = (updated!.endDate.getTime() - Date.now()) / JOUR;

    // Attendu : un cycle PRO plein (~30 j) + le crédit reconverti
    // ((9×(10/30))/(29/30) ≈ 3,1 j) ≈ 33 j. Sans le correctif : les 10 jours
    // restants reportés tels quels + un cycle PRO plein ≈ 40 jours.
    expect(joursCouverts).toBeGreaterThan(31);
    expect(joursCouverts).toBeLessThan(36);
  });

  // Régression : la transition PENDING → PAID n'était conditionnée à AUCUN
  // état courant (UPDATE ... WHERE id = ?, sans clause sur le statut). Deux
  // appels concurrents à cette fonction — rejeu de webhook PayDunya/Stripe
  // (les deux prestataires documentent eux-mêmes rejouer leurs événements),
  // ou un double clic administrateur sur "confirmer le virement" — pouvaient
  // tous deux dépasser le contrôle "déjà PAID ?" avant que l'un des deux
  // n'ait committé, puis exécuter chacun sa propre écriture : le second,
  // relisant alors un compte DÉJÀ activé par le premier, calculait sa propre
  // extension par-dessus celle du premier au lieu de la remplacer par un
  // no-op — l'abonnement se retrouvait crédité deux fois pour un seul
  // paiement réellement encaissé.
  it("n'active pas deux fois le même paiement lors d'appels concurrents (rejeu de webhook, double clic admin)", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL" });
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      amount: 29,
      billingCycle: "MONTHLY",
      paymentMethod: "PAYDUNYA",
    });

    // Retarde la PROPAGATION (pas l'exécution SQL elle-même) du tout premier
    // SELECT rencontré, pour laisser le temps au second appel concurrent de
    // terminer entièrement son activation avant que le premier ne reprenne —
    // élargit artificiellement la fenêtre de course, sans changer ce que
    // chaque lecture renvoie.
    const originalSelect = testDb.select.bind(testDb);
    let premierAppel = true;
    const spy = vi.spyOn(testDb, "select").mockImplementation((...args: unknown[]) => {
      const builder = (originalSelect as (...a: unknown[]) => any)(...args);
      if (premierAppel) {
        premierAppel = false;
        return retarderResultat(builder, 30);
      }
      return builder;
    });

    const [r1, r2] = await Promise.all([
      activateSubscriptionRecord(record.id, testDb),
      activateSubscriptionRecord(record.id, testDb),
    ]);
    spy.mockRestore();

    expect(r1?.status).toBe("PAID");
    expect(r2?.status).toBe("PAID");
    // Les deux appels doivent converger vers LE MÊME résultat : un seul a
    // réellement appliqué la transition, l'autre s'est aligné dessus.
    expect(r1?.endDate.getTime()).toBe(r2?.endDate.getTime());

    const [compteFinal] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compteFinal.subscriptionEndsAt!.getTime()).toBe(r1!.endDate.getTime());
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
