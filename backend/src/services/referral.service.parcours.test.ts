import crypto from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import {
  accorderRecompenseParrainage,
  obtenirOuCreerCodeParrainage,
  REFERRAL_REWARD_DAYS,
  trouverParrainParCode,
} from "./referral.service";

/**
 * Parcours du parrainage non couverts par le fichier principal : le code (tirages en collision, deux onglets en même temps),
 * la recherche du parrain à partir d'un code saisi, et le courriel qui prévient le parrain de sa récompense.
 */

const JOUR = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fait tirer à `randomBytes` les octets donnés, dans l'ordre (le code d'un tirage = ces 4 octets en hexadécimal majuscule). */
function tirages(...octets: number[]) {
  const spy = vi.spyOn(crypto, "randomBytes");
  for (const o of octets) spy.mockImplementationOnce((() => Buffer.alloc(4, o)) as never);
  return spy;
}

describe("obtenirOuCreerCodeParrainage : tirages et concurrence", () => {
  it("un code déjà pris par un autre compte est écarté : un nouveau tirage est fait, et l'autre compte garde le sien", async () => {
    const autre = await createManager({ referralCode: "AAAAAAAA" });
    const manager = await createManager();
    const spy = tirages(0xaa, 0xbb);

    const code = await obtenirOuCreerCodeParrainage(manager.id);

    expect(code).toBe("BBBBBBBB");
    expect(spy).toHaveBeenCalledTimes(2);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.referralCode).toBe("BBBBBBBB");
    const [intact] = await testDb.select().from(users).where(eq(users.id, autre.id));
    expect(intact.referralCode).toBe("AAAAAAAA");
  });

  it("après cinq tirages en collision, l'échec est annoncé et aucun code n'est posé", async () => {
    await createManager({ referralCode: "AAAAAAAA" });
    const manager = await createManager();
    const spy = tirages(0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xbb);

    await expect(obtenirOuCreerCodeParrainage(manager.id)).rejects.toThrow(/code de parrainage unique/);

    expect(spy).toHaveBeenCalledTimes(5); // pas un sixième tirage
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.referralCode).toBeNull();
  });

  it("un compte qui a déjà un code le garde : aucun tirage n'est fait", async () => {
    const manager = await createManager({ referralCode: "CAFE1234" });
    const spy = vi.spyOn(crypto, "randomBytes");

    expect(await obtenirOuCreerCodeParrainage(manager.id)).toBe("CAFE1234");
    expect(spy).not.toHaveBeenCalled();
  });

  it("deux onglets qui demandent le code en même temps reçoivent le MÊME code, et c'est celui qui est en base", async () => {
    const manager = await createManager();

    const [a, b] = await Promise.all([obtenirOuCreerCodeParrainage(manager.id), obtenirOuCreerCodeParrainage(manager.id)]);

    expect(a).toBe(b);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.referralCode).toBe(a);
  });

  it("un compte inconnu ne reçoit aucun code : l'échec est annoncé au lieu de renvoyer un code qui n'existe nulle part", async () => {
    await expect(obtenirOuCreerCodeParrainage("compte-inexistant")).rejects.toThrow(/code de parrainage unique/);
  });
});

describe("trouverParrainParCode", () => {
  it("sans code saisi (absent ou vide), il n'y a pas de parrain", async () => {
    await createManager({ referralCode: "ABCD1234" });

    expect(await trouverParrainParCode(undefined)).toBeNull();
    expect(await trouverParrainParCode("")).toBeNull();
  });

  it("retrouve le parrain malgré les majuscules/minuscules et les espaces autour du code saisi", async () => {
    const parrain = await createManager({ referralCode: "ABCD1234" });

    expect(await trouverParrainParCode("ABCD1234")).toBe(parrain.id);
    expect(await trouverParrainParCode("  abcd1234 ")).toBe(parrain.id);
  });

  it("un code inconnu ou mal saisi est ignoré (null), jamais une erreur qui bloquerait l'inscription", async () => {
    await createManager({ referralCode: "ABCD1234" });

    expect(await trouverParrainParCode("ZZZZ0000")).toBeNull();
    expect(await trouverParrainParCode("ABCD123")).toBeNull(); // un caractère manquant
    expect(await trouverParrainParCode("   ")).toBeNull();
  });

  it("un collaborateur invité (rattaché à une équipe) ne peut pas être parrain, même si son compte porte un code", async () => {
    const patron = await createManager();
    await createManager({ teamOwnerId: patron.id, referralCode: "TEAM0001" });

    expect(await trouverParrainParCode("TEAM0001")).toBeNull();
  });

  it("seul un gestionnaire peut être parrain : le code d'un compte d'un autre rôle ne désigne personne", async () => {
    await createManager({ role: "OWNER", referralCode: "PROP0001" });

    expect(await trouverParrainParCode("PROP0001")).toBeNull();
  });
});

describe("accorderRecompenseParrainage : prévenir le parrain", () => {
  let envoi: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  });

  it("le parrain reçoit un courriel à SON adresse, qui annonce les jours offerts et la nouvelle échéance", async () => {
    const fin = new Date("2031-03-10T12:00:00Z");
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: fin });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);

    expect(envoi).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, html] = envoi.mock.calls[0] as unknown as [string, string, string];
    expect(destinataire).toBe(parrain.email);
    expect(sujet).toContain(`+${REFERRAL_REWARD_DAYS} jours offerts`);
    expect(html).toContain(`<strong>${REFERRAL_REWARD_DAYS} jours</strong>`);
    // 10 mars + 15 jours = 25 mars : la date affichée est la NOUVELLE échéance, pas l'ancienne.
    expect(html).toContain("25");
    expect(html).toContain("mars");
    expect(html).not.toContain("10 mars");
  });

  it("le courriel est écrit dans la langue du parrain", async () => {
    const parrain = await createManager({ language: "es" });
    const filleul = await createManager({ referredByUserId: parrain.id });

    await accorderRecompenseParrainage(filleul);

    const [, sujet, html] = envoi.mock.calls[0] as unknown as [string, string, string];
    expect(sujet).not.toContain("offerts");
    expect(html).not.toContain("Nouvelle échéance");
  });

  it("un échec d'envoi n'annule pas la récompense et ne fait pas échouer la confirmation du filleul", async () => {
    const fin = new Date(Date.now() + 10 * JOUR);
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: fin });
    const filleul = await createManager({ referredByUserId: parrain.id });
    envoi.mockRejectedValueOnce(new Error("SMTP indisponible"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(accorderRecompenseParrainage(filleul)).resolves.toBeUndefined();

    expect(erreur).toHaveBeenCalledTimes(1);
    expect(String(erreur.mock.calls[0][0])).toContain("[referral]");
    const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(apres.trialEndsAt!.getTime()).toBe(fin.getTime() + REFERRAL_REWARD_DAYS * JOUR);
  });

  it("aucun courriel quand rien n'a été accordé (parrain expiré, ou plafond atteint)", async () => {
    const expire = await createManager({ subscriptionStatus: "EXPIRED", subscriptionEndsAt: new Date(Date.now() - JOUR), trialEndsAt: null });
    await accorderRecompenseParrainage(await createManager({ referredByUserId: expire.id }));

    expect(envoi).not.toHaveBeenCalled();
  });

  it("un parrain en essai sans date de fin, ou abonné sans date de fin, ne reçoit rien (rien à prolonger) mais le filleul est marqué", async () => {
    const essai = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: null });
    const abonne = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, trialEndsAt: null });
    const filleulEssai = await createManager({ referredByUserId: essai.id });
    const filleulAbonne = await createManager({ referredByUserId: abonne.id });

    await accorderRecompenseParrainage(filleulEssai);
    await accorderRecompenseParrainage(filleulAbonne);

    for (const parrain of [essai, abonne]) {
      const [apres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
      expect(apres.trialEndsAt).toBeNull();
      expect(apres.subscriptionEndsAt).toBeNull();
    }
    for (const f of [filleulEssai, filleulAbonne]) {
      const [apres] = await testDb.select().from(users).where(eq(users.id, f.id));
      expect(apres.referralRewardGrantedAt).not.toBeNull();
    }
    expect(envoi).not.toHaveBeenCalled();
  });

  it("une récompense accordée ne touche que le parrain : ni le filleul, ni un autre compte", async () => {
    const fin = new Date(Date.now() + 10 * JOUR);
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: fin });
    const autre = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: fin });
    const filleul = await createManager({ referredByUserId: parrain.id, subscriptionStatus: "TRIAL", trialEndsAt: fin });

    await accorderRecompenseParrainage(filleul);

    for (const intact of [autre, filleul]) {
      const [apres] = await testDb.select().from(users).where(eq(users.id, intact.id));
      expect(apres.trialEndsAt!.getTime()).toBe(fin.getTime());
    }
  });
});
