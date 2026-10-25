import crypto from "crypto";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db, Transaction } from "../db/client";
import { users } from "../db/schema";
import { langueOuDefaut } from "../utils/langue";
import { referralRewardEmail, sendEmail } from "./email.service";

/** Jours offerts au PARRAIN quand son filleul confirme son adresse email. */
export const REFERRAL_REWARD_DAYS = 15;

/**
 * Nombre maximal de filleuls qui rapportent des jours à un même parrain (soit 150 jours au plus).
 * Sans plafond, des comptes ouverts avec de fausses adresses (alias d'une même boîte mail, du type
 * nom+1@gmail.com) suffisaient à s'offrir des mois d'abonnement en série. Au-delà, un filleul est
 * inscrit normalement mais ne rapporte plus rien.
 */
export const REFERRAL_MAX_REWARDED = 10;

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
 * Parrain désigné par un code saisi à l'inscription (par email ou avec Google), ou `null`. Seul un compte gestionnaire
 * PROPRIÉTAIRE (teamOwnerId NULL) peut être parrain — un collaborateur invité n'a pas de code qui lui soit propre.
 * Un code introuvable ou mal saisi est ignoré en silence plutôt que de bloquer l'inscription : ce n'est qu'une
 * attribution de récompense.
 */
export async function trouverParrainParCode(code: string | undefined): Promise<string | null> {
  if (!code) return null;
  const [parrain] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.referralCode, code.trim().toUpperCase()), eq(users.role, "MANAGER"), isNull(users.teamOwnerId)));
  return parrain?.id ?? null;
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
  if (!filleul.referredByUserId) return;
  const parrainId = filleul.referredByUserId;

  // Les jours sont ajoutés par la base, à la date qu'elle contient AU MOMENT
  // de l'écriture, et seulement si le statut est encore celui qu'on a lu : lire
  // la date, y ajouter 15 jours ici puis la réécrire écrasait un renouvellement
  // enregistré dans l'intervalle (webhook de paiement, prolongation par
  // l'administration).
  const joursOfferts = sql`interval '1 day' * ${REFERRAL_REWARD_DAYS}`;

  const issue = await db.transaction(async (tx: Transaction) => {
    // Le parrain est verrouillé pour toute la décision : deux filleuls qui se confirment ensemble
    // comptent leurs prédécesseurs l'un après l'autre, et ne passent pas tous deux sous le plafond.
    await tx.execute(sql`SELECT id FROM users WHERE id = ${parrainId} FOR UPDATE`);
    const [parrain] = await tx.select().from(users).where(eq(users.id, parrainId));

    // Réclamation ATOMIQUE de la récompense, avant toute écriture chez le parrain.
    // `filleul` vient d'une lecture antérieure : deux confirmations simultanées
    // (double clic sur le lien, deux onglets) la voient toutes deux sans
    // referralRewardGrantedAt, et la vérifier sur cet objet les laissait passer
    // ensemble — le parrain recevait alors 30 jours au lieu de 15. Seule la
    // requête qui pose la date en base (WHERE referral_reward_granted_at IS NULL)
    // continue ; l'autre s'arrête ici.
    //
    // La date est posée que la récompense puisse être accordée ou non (parrain
    // EXPIRED/CANCELLED, plafond atteint compris) : c'est le filleul qui vient
    // de se confirmer, une seule fois, et cet évènement ne doit jamais se
    // rejouer pour lui.
    const [reclame] = await tx
      .update(users)
      .set({ referralRewardGrantedAt: new Date() })
      .where(and(eq(users.id, filleul.id), isNull(users.referralRewardGrantedAt)))
      .returning({ id: users.id });
    if (!reclame || !parrain) return null;

    // Plafond : les AUTRES filleuls déjà traités par ce parrain (y compris ceux qui n'ont rien
    // rapporté parce que le parrain était alors expiré — l'écart est négligeable et la règle reste
    // simple à expliquer).
    const [{ traites }] = await tx
      .select({ traites: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.referredByUserId, parrainId), isNotNull(users.referralRewardGrantedAt), ne(users.id, filleul.id)));
    if (traites >= REFERRAL_MAX_REWARDED) return null;

    let nouvelleDate: Date | null = null;
    if (parrain.subscriptionStatus === "TRIAL" && parrain.trialEndsAt) {
      const [maj] = await tx
        .update(users)
        .set({ trialEndsAt: sql`${users.trialEndsAt} + ${joursOfferts}` })
        .where(and(eq(users.id, parrain.id), eq(users.subscriptionStatus, "TRIAL"), isNotNull(users.trialEndsAt)))
        .returning({ trialEndsAt: users.trialEndsAt });
      nouvelleDate = maj?.trialEndsAt ?? null;
    } else if (parrain.subscriptionStatus === "ACTIVE" && parrain.subscriptionEndsAt) {
      const [maj] = await tx
        .update(users)
        .set({ subscriptionEndsAt: sql`${users.subscriptionEndsAt} + ${joursOfferts}` })
        .where(and(eq(users.id, parrain.id), eq(users.subscriptionStatus, "ACTIVE"), isNotNull(users.subscriptionEndsAt)))
        .returning({ subscriptionEndsAt: users.subscriptionEndsAt });
      nouvelleDate = maj?.subscriptionEndsAt ?? null;
    }
    return nouvelleDate ? { parrain, nouvelleDate } : null;
  });

  if (issue && issue.parrain.email) {
    const { subject, html } = referralRewardEmail({
      days: REFERRAL_REWARD_DAYS,
      newEndDate: issue.nouvelleDate,
      frontendUrl: env.frontendUrl,
      langue: langueOuDefaut(issue.parrain.language),
    });
    await sendEmail(issue.parrain.email, subject, html).catch((err) =>
      console.error("[referral] Échec de l'envoi de la notification de récompense:", err)
    );
  }
}
