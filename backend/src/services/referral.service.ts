import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { users } from "../db/schema";
import { referralRewardEmail, sendEmail } from "./email.service";

/** Jours offerts au PARRAIN quand son filleul confirme son adresse email. */
export const REFERRAL_REWARD_DAYS = 15;

const TAILLE_CODE = 4; // 4 octets -> 8 caractères hexadécimaux
const TENTATIVES_MAX = 5;

function genererCodeParrainage(): string {
  return crypto.randomBytes(TAILLE_CODE).toString("hex").toUpperCase();
}

/**
 * Code de parrainage du compte, généré au premier appel et persisté pour
 * toujours (voir schema.ts::referralCode). La collision est possible mais
 * improbable (16^8 combinaisons) : quelques tentatives suffisent très
 * largement, et l'unicité reste de toute façon garantie en base par la
 * contrainte UNIQUE — jamais par ce tirage seul.
 */
export async function obtenirOuCreerCodeParrainage(userId: string): Promise<string> {
  const [existant] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
  if (existant?.referralCode) return existant.referralCode;

  for (let tentative = 0; tentative < TENTATIVES_MAX; tentative++) {
    const code = genererCodeParrainage();
    try {
      const [mis] = await db
        .update(users)
        // Ne pose le code QUE s'il est encore NULL : deux requêtes concurrentes
        // (double onglet) sur un compte sans code ne doivent pas en écrire
        // chacune un différent — la seconde retombe sur le SELECT ci-dessous.
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ referralCode: users.referralCode });
      if (mis) return mis.referralCode!;

      // Une autre requête a posé un code entre-temps (concurrence) : c'est
      // celui-là qui fait foi.
      const [actuel] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
      if (actuel?.referralCode) return actuel.referralCode;
    } catch {
      // Collision sur la contrainte UNIQUE (code déjà pris par un autre
      // compte) : on retire simplement un autre tirage.
      continue;
    }
  }
  throw new Error("Impossible de générer un code de parrainage unique après plusieurs tentatives.");
}

/**
 * Accorde au PARRAIN sa récompense quand son filleul confirme son adresse
 * email (voir verifyEmail, auth.controller.ts) — jamais à l'inscription
 * seule, pour qu'un compte jamais confirmé ne rapporte rien.
 *
 * Idempotente (referralRewardGrantedAt sur le FILLEUL) : un filleul ne peut
 * déclencher la récompense de son parrain qu'une seule fois.
 *
 * La récompense prolonge simplement la date qui gouverne déjà l'accès du
 * parrain (trialEndsAt en essai, subscriptionEndsAt en formule payante) —
 * une addition de jours, jamais un appel au moteur de facturation
 * (calculerPeriodeActivation) : ce dernier recalcule des périodes PAYÉES à
 * partir d'un montant réellement encaissé, ce qui n'a aucun sens ici. Un
 * parrain EXPIRED ou CANCELLED ne reçoit rien : il n'a plus d'accès en
 * cours à prolonger, et lui en ouvrir un gratuitement court-circuiterait la
 * facturation plutôt que de la compléter.
 */
export async function accorderRecompenseParrainage(filleul: typeof users.$inferSelect): Promise<void> {
  if (!filleul.referredByUserId || filleul.referralRewardGrantedAt) return;

  const [parrain] = await db.select().from(users).where(eq(users.id, filleul.referredByUserId));
  if (!parrain) return;

  const recompenseMs = REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000;
  let nouvelleDate: Date | null = null;
  if (parrain.subscriptionStatus === "TRIAL" && parrain.trialEndsAt) {
    nouvelleDate = new Date(parrain.trialEndsAt.getTime() + recompenseMs);
    await db.update(users).set({ trialEndsAt: nouvelleDate }).where(eq(users.id, parrain.id));
  } else if (parrain.subscriptionStatus === "ACTIVE" && parrain.subscriptionEndsAt) {
    nouvelleDate = new Date(parrain.subscriptionEndsAt.getTime() + recompenseMs);
    await db.update(users).set({ subscriptionEndsAt: nouvelleDate }).where(eq(users.id, parrain.id));
  }

  // Posé que la récompense ait pu être accordée ou non (parrain EXPIRED/
  // CANCELLED compris) : c'est le filleul qui vient de se confirmer, une
  // seule fois, et cet évènement ne doit jamais se rejouer pour lui.
  await db.update(users).set({ referralRewardGrantedAt: new Date() }).where(eq(users.id, filleul.id));

  if (nouvelleDate && parrain.email) {
    const { subject, html } = referralRewardEmail({
      days: REFERRAL_REWARD_DAYS,
      newEndDate: nouvelleDate,
      frontendUrl: env.frontendUrl,
    });
    await sendEmail(parrain.email, subject, html).catch((err) =>
      console.error("[referral] Échec de l'envoi de la notification de récompense:", err)
    );
  }
}
