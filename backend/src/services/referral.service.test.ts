import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { accorderRecompenseParrainage, obtenirOuCreerCodeParrainage, REFERRAL_REWARD_DAYS } from "./referral.service";

describe("obtenirOuCreerCodeParrainage", () => {
  it("génère et persiste un code pour un compte qui n'en a pas", async () => {
    const manager = await createManager();
    const code = await obtenirOuCreerCodeParrainage(manager.id);

    expect(code).toMatch(/^[0-9A-F]{8}$/);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.referralCode).toBe(code);
  });

  it("renvoie le même code à un second appel, sans le régénérer", async () => {
    const manager = await createManager();
    const premier = await obtenirOuCreerCodeParrainage(manager.id);
    const second = await obtenirOuCreerCodeParrainage(manager.id);

    expect(second).toBe(premier);
  });
});

describe("accorderRecompenseParrainage", () => {
  it("prolonge l'essai du parrain de REFERRAL_REWARD_DAYS jours", async () => {
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);

    const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(apres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("prolonge l'abonnement payant du parrain s'il est ACTIVE", async () => {
    const subscriptionEndsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt, trialEndsAt: null });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);

    const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(apres.subscriptionEndsAt!.getTime()).toBe(subscriptionEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("n'accorde rien à un parrain EXPIRED ou CANCELLED, mais marque quand même le filleul", async () => {
    const subscriptionEndsAt = new Date(Date.now() - 86_400_000);
    const parrain = await createManager({ subscriptionStatus: "EXPIRED", subscriptionEndsAt, trialEndsAt: null });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);

    const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(parrainApres.subscriptionEndsAt!.getTime()).toBe(subscriptionEndsAt.getTime());

    const [filleulApres] = await testDb.select().from(users).where(eq(users.id, filleul.id));
    expect(filleulApres.referralRewardGrantedAt).not.toBeNull();
  });

  it("n'accorde la récompense qu'une seule fois pour un même filleul (idempotence)", async () => {
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);
    const [filleulApresPremier] = await testDb.select().from(users).where(eq(users.id, filleul.id));

    // Deuxième appel avec la ligne filleul désormais marquée (comme le
    // ferait un second passage accidentel dans verifyEmail).
    await accorderRecompenseParrainage(filleulApresPremier);

    const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(parrainApres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("ne fait rien pour un compte sans parrain", async () => {
    const filleul = await createManager({ referredByUserId: null });
    await expect(accorderRecompenseParrainage(filleul)).resolves.toBeUndefined();

    const [apres] = await testDb.select().from(users).where(eq(users.id, filleul.id));
    expect(apres.referralRewardGrantedAt).toBeNull();
  });
});
