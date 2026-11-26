import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import * as paymentService from "../services/payment.service";
import { authHeader, createManager, createProperty, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Souscrire à une formule dont le plafond de biens est dépassé. Le plafond (Starter 5 / Pro 25 / Entreprise illimité) n'était vérifié
 * qu'à la CRÉATION d'un bien : un gestionnaire qui avait ajouté 12 biens pendant l'essai (formule effective Pro) souscrivait à Starter
 * pour 9 € et gardait ses 12 biens. La souscription est désormais refusée AVANT tout paiement, avec une proposition de formule
 * supérieure ; rien n'est retiré au gestionnaire.
 *
 * Exception : renouveler la formule qu'on a déjà payée — un abonné d'avant ce contrôle ne se voit pas refuser le paiement de ce qu'il
 * utilise déjà (la page Abonnement lui signale le dépassement).
 */
const JOUR = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

async function ajouterBiens(managerId: string, nombre: number) {
  for (let i = 0; i < nombre; i++) await createProperty(managerId, { title: `Bien ${i + 1}` });
}

const souscrire = (manager: Awaited<ReturnType<typeof createManager>>, plan: string, billingCycle = "MONTHLY") =>
  request(app).post("/api/subscription/subscribe").set(authHeader(tokenFor(manager))).send({ plan, billingCycle, paymentMethod: "DEMO" });

const abonne = (plan: "STARTER" | "PRO" | "ENTERPRISE", statut: "ACTIVE" | "CANCELLED" = "ACTIVE") =>
  createManager({ subscriptionStatus: statut, subscriptionPlan: plan, trialEndsAt: null, subscriptionEndsAt: new Date(Date.now() + 20 * JOUR) });

describe("souscrire à une formule trop petite pour ses biens : refusé avant tout paiement", () => {
  it("pendant l'essai, 6 biens et la formule Starter (5 biens) : 409 avec le nombre, le plafond et la formule, sans paiement ni trace", async () => {
    const manager = await createManager(); // essai en cours, formule par défaut : Starter
    await ajouterBiens(manager.id, 6);
    const paiement = vi.spyOn(paymentService, "initiatePayment");

    const res = await souscrire(manager, "STARTER");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_TOO_SMALL_FOR_PROPERTIES");
    expect(res.body.params).toEqual({ count: 6, max: 5, plan: "Starter" });
    expect(res.body.error).toBe(
      "Vous gérez 6 biens, et la formule Starter en autorise 5. Choisissez une formule supérieure, ou réduisez votre nombre de biens avant de souscrire."
    );
    expect(paiement).not.toHaveBeenCalled();
    expect(await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, manager.id))).toEqual([]);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres).toMatchObject({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER", subscriptionEndsAt: null });
    expect(apres.subscriptionPaymentAttemptStartedAt).toBeNull(); // la réclamation de paiement n'a même pas été posée
  });

  it("le plafond lui-même passe (5 biens en Starter), un bien de plus est refusé", async () => {
    const manager = await createManager();
    await ajouterBiens(manager.id, 5);
    const paiement = vi.spyOn(paymentService, "initiatePayment");

    expect((await souscrire(manager, "STARTER")).status).toBe(200);
    expect(paiement).toHaveBeenCalledTimes(1);

    const autre = await createManager();
    await ajouterBiens(autre.id, 6);
    expect((await souscrire(autre, "STARTER")).status).toBe(409);
  });

  it("le cycle annuel est refusé de la même façon", async () => {
    const manager = await createManager();
    await ajouterBiens(manager.id, 6);

    const res = await souscrire(manager, "STARTER", "ANNUAL");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_TOO_SMALL_FOR_PROPERTIES");
  });

  it("les formules supérieures restent ouvertes : 6 biens → Pro (25) et Entreprise (illimité)", async () => {
    const manager = await createManager();
    await ajouterBiens(manager.id, 6);

    expect((await souscrire(manager, "PRO")).status).toBe(200);
    const autre = await createManager();
    await ajouterBiens(autre.id, 6);
    expect((await souscrire(autre, "ENTERPRISE")).status).toBe(200);
  });

  it("Pro refuse 26 biens et le dit avec son nom et son plafond ; Entreprise (illimité) les accepte", async () => {
    const manager = await createManager();
    await ajouterBiens(manager.id, 26);

    const refus = await souscrire(manager, "PRO");

    expect(refus.status).toBe(409);
    expect(refus.body.params).toEqual({ count: 26, max: 25, plan: "Professionnel" });
    expect((await souscrire(manager, "ENTERPRISE")).status).toBe(200);
  });

  it("seuls les biens du gestionnaire comptent, pas ceux des autres agences", async () => {
    const manager = await createManager();
    const autre = await createManager();
    await ajouterBiens(manager.id, 2);
    await ajouterBiens(autre.id, 10);

    expect((await souscrire(manager, "STARTER")).status).toBe(200);
  });

  it("un compte dont l'essai est terminé (aucun abonnement payé) est refusé comme un compte en essai", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: new Date(Date.now() - 2 * JOUR) });
    await ajouterBiens(manager.id, 6);

    const res = await souscrire(manager, "STARTER");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_TOO_SMALL_FOR_PROPERTIES");
  });

  it("un abonné Pro avec 8 biens qui passe à Starter est refusé (changement de formule) ; avec 3 biens, il passe", async () => {
    const trop = await abonne("PRO");
    await ajouterBiens(trop.id, 8);
    const refus = await souscrire(trop, "STARTER");
    expect(refus.status).toBe(409);
    expect(refus.body.params).toEqual({ count: 8, max: 5, plan: "Starter" });

    const peu = await abonne("PRO");
    await ajouterBiens(peu.id, 3);
    expect((await souscrire(peu, "STARTER")).status).toBe(200);
  });
});

describe("renouveler la formule qu'on a déjà payée : jamais refusé", () => {
  it.each([
    ["actif", "ACTIVE"],
    ["résilié (accès jusqu'à l'échéance)", "CANCELLED"],
  ] as const)("un abonné Starter %s avec 8 biens (d'avant ce contrôle) renouvelle Starter", async (_nom, statut) => {
    const manager = await abonne("STARTER", statut);
    await ajouterBiens(manager.id, 8);

    const res = await souscrire(manager, "STARTER");

    expect(res.status).toBe(200);
  });
});
