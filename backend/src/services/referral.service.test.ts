import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import {
  accorderRecompenseParrainage,
  obtenirOuCreerCodeParrainage,
  REFERRAL_MAX_REWARDED,
  REFERRAL_REWARD_DAYS,
} from "./referral.service";

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

  it("n'accorde qu'une récompense quand deux confirmations arrivent en même temps (double clic, deux onglets)", async () => {
    // Les deux appels reçoivent la même ligne filleul, lue AVANT que l'un ou l'autre ait posé
    // referralRewardGrantedAt : c'est ce que voient deux requêtes verify-email simultanées.
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await Promise.all([accorderRecompenseParrainage(filleul), accorderRecompenseParrainage(filleul)]);

    const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(parrainApres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("n'accorde rien de plus avec une ligne filleul périmée (relue avant la première récompense)", async () => {
    const subscriptionEndsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt, trialEndsAt: null });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);
    await accorderRecompenseParrainage(filleul);

    const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(parrainApres.subscriptionEndsAt!.getTime()).toBe(subscriptionEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("ajoute les jours à la date lue en base, pas à celle lue plus tôt (un renouvellement entre-temps n'est pas écrasé)", async () => {
    const debut = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: debut, trialEndsAt: null });
    const filleul = await createManager({ referredByUserId: parrain.id });

    // Le parrain renouvelle (ex. webhook de paiement) : sa fin d'abonnement avance de 30 jours.
    const renouvele = new Date(debut.getTime() + 30 * 86_400_000);
    await testDb.update(users).set({ subscriptionEndsAt: renouvele }).where(eq(users.id, parrain.id));

    await accorderRecompenseParrainage(filleul);

    const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(apres.subscriptionEndsAt!.getTime()).toBe(renouvele.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  describe("plafond de filleuls récompensés", () => {
    const JOUR = 86_400_000;

    /** `n` filleuls déjà traités (récompense posée) par ce parrain. */
    async function dejaTraites(parrainId: string, n: number) {
      for (let i = 0; i < n; i++) {
        await createManager({ referredByUserId: parrainId, referralRewardGrantedAt: new Date() });
      }
    }

    it("accorde encore la récompense au dernier filleul sous le plafond", async () => {
      const trialEndsAt = new Date(Date.now() + 10 * JOUR);
      const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
      await dejaTraites(parrain.id, REFERRAL_MAX_REWARDED - 1);
      const filleul = await createManager({ referredByUserId: parrain.id });

      await accorderRecompenseParrainage(filleul);

      const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
      expect(apres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * JOUR);
    });

    it("n'accorde plus rien au-delà du plafond, mais marque le filleul pour ne pas rejouer", async () => {
      const trialEndsAt = new Date(Date.now() + 10 * JOUR);
      const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
      await dejaTraites(parrain.id, REFERRAL_MAX_REWARDED);
      const filleul = await createManager({ referredByUserId: parrain.id });

      await accorderRecompenseParrainage(filleul);

      const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
      expect(parrainApres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime());
      const [filleulApres] = await testDb.select().from(users).where(eq(users.id, filleul.id));
      expect(filleulApres.referralRewardGrantedAt).not.toBeNull();
    });

    it("le plafond vaut aussi pour un abonnement payant", async () => {
      const subscriptionEndsAt = new Date(Date.now() + 20 * JOUR);
      const parrain = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt, trialEndsAt: null });
      await dejaTraites(parrain.id, REFERRAL_MAX_REWARDED);
      const filleul = await createManager({ referredByUserId: parrain.id });

      await accorderRecompenseParrainage(filleul);

      const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
      expect(apres.subscriptionEndsAt!.getTime()).toBe(subscriptionEndsAt.getTime());
    });

    it("ne compte que les filleuls de CE parrain", async () => {
      const trialEndsAt = new Date(Date.now() + 10 * JOUR);
      const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
      const autre = await createManager();
      await dejaTraites(autre.id, REFERRAL_MAX_REWARDED + 3);
      const filleul = await createManager({ referredByUserId: parrain.id });

      await accorderRecompenseParrainage(filleul);

      const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
      expect(apres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * JOUR);
    });

    it("ne compte pas un filleul qui n'est pas encore confirmé", async () => {
      const trialEndsAt = new Date(Date.now() + 10 * JOUR);
      const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
      for (let i = 0; i < REFERRAL_MAX_REWARDED + 2; i++) await createManager({ referredByUserId: parrain.id });
      const filleul = await createManager({ referredByUserId: parrain.id });

      await accorderRecompenseParrainage(filleul);

      const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
      expect(apres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * JOUR);
    });
  });

  it("ne fait rien pour un compte sans parrain", async () => {
    const filleul = await createManager({ referredByUserId: null });
    await expect(accorderRecompenseParrainage(filleul)).resolves.toBeUndefined();

    const [apres] = await testDb.select().from(users).where(eq(users.id, filleul.id));
    expect(apres.referralRewardGrantedAt).toBeNull();
  });
});
