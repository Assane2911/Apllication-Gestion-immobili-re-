import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { platformSubscriptions, users } from "../db/schema";
import { initiatePayment, PaymentIntentResult, PaymentMethodKey } from "../services/payment.service";
import { calculerPeriodeActivation } from "../services/subscriptionPeriod.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { computeSubscriptionInfo } from "./auth.controller";

/** Devise de repli, pour une devise utilisateur qui n'est pas tarifée. */
export const DEVISE_PAR_DEFAUT = "EUR";

/**
 * Tarifs des formules, devise par devise, écrits à la main.
 *
 * Pourquoi pas une conversion depuis l'euro : un prix local n'est pas un taux
 * de change mais une décision commerciale. 29 € convertis à la parité fixe
 * donneraient 19 023 FCFA — un montant illisible, et calé sur un pouvoir
 * d'achat qui n'est pas celui du marché visé. Les montants sont donc choisis,
 * arrondis, et respectent tous le même rabais annuel de 20 % que l'interface
 * annonce — invariant verrouillé par un test paramétré
 * (subscription.controller.test.ts) qui échoue si un prix futur le rompt.
 *
 * Les neuf devises proposées par le sélecteur de l'interface
 * (frontend/src/context/currency.ts) sont toutes tarifées : parité pour les
 * marchés à pouvoir d'achat comparable (USD, GBP, CAD, CHF), ajustement à la
 * baisse pour les autres (MAD, STN), au même niveau que le choix déjà fait
 * pour le XOF. Le XAF partage la parité fixe du XOF avec l'euro et le même
 * marché : mêmes montants, délibérément.
 *
 * Attention, tarifer n'est pas encaisser : le paiement par carte refuse toute
 * devise absente de STRIPE_CURRENCIES (voir .env.example et
 * payment.service.ts::indisponibilite), et PayDunya n'encaisse que dans la
 * devise de son compte. Le virement bancaire, lui, reste toujours proposé.
 *
 * Pour changer un prix, il n'y a qu'une ligne à toucher ici : c'est aussi
 * pourquoi les champs monthlyPrice / annualPrice ont disparu du catalogue
 * ci-dessous — deux sources de vérité pour un prix finissent par diverger.
 */
const TARIFS: Record<string, Record<string, { monthly: number; annual: number }>> = {
  STARTER: {
    EUR: { monthly: 9, annual: 86 },
    USD: { monthly: 10, annual: 96 },
    GBP: { monthly: 8, annual: 77 },
    CAD: { monthly: 14, annual: 134 },
    CHF: { monthly: 9, annual: 86 },
    MAD: { monthly: 89, annual: 854 },
    XOF: { monthly: 5000, annual: 48000 },
    XAF: { monthly: 5000, annual: 48000 },
    STN: { monthly: 179, annual: 1718 },
  },
  PRO: {
    EUR: { monthly: 29, annual: 278 },
    USD: { monthly: 32, annual: 307 },
    GBP: { monthly: 25, annual: 240 },
    CAD: { monthly: 44, annual: 422 },
    CHF: { monthly: 29, annual: 278 },
    MAD: { monthly: 289, annual: 2774 },
    XOF: { monthly: 15000, annual: 144000 },
    XAF: { monthly: 15000, annual: 144000 },
    STN: { monthly: 579, annual: 5558 },
  },
  ENTERPRISE: {
    EUR: { monthly: 49, annual: 470 },
    USD: { monthly: 54, annual: 518 },
    GBP: { monthly: 42, annual: 403 },
    CAD: { monthly: 74, annual: 710 },
    CHF: { monthly: 49, annual: 470 },
    MAD: { monthly: 489, annual: 4694 },
    XOF: { monthly: 25000, annual: 240000 },
    XAF: { monthly: 25000, annual: 240000 },
    STN: { monthly: 979, annual: 9398 },
  },
};

/**
 * Les devises réellement tarifées, dans l'ordre du catalogue. Exportée pour
 * que les tests couvrent automatiquement toute devise ajoutée ci-dessus :
 * une nouvelle entrée sans vérification de son rabais annuel passerait
 * sinon inaperçue.
 */
export function devisesTarifees(): string[] {
  return Object.keys(TARIFS.PRO);
}

/**
 * Devise réellement facturée pour une devise demandée : la devise elle-même si
 * elle est tarifée, sinon l'euro. Ce qui est affiché et ce qui est débité
 * viennent ainsi toujours de la même décision — c'est précisément l'écart
 * inverse (prix affichés en euros, compte encaissant en FCFA) qui rendait la
 * chaîne fausse.
 */
export function deviseFacturee(currency?: string | null): string {
  const demandee = (currency ?? "").toUpperCase();
  return TARIFS.PRO[demandee] ? demandee : DEVISE_PAR_DEFAUT;
}

/** Tarif d'un plan dans une devise déjà résolue par deviseFacturee(). */
export function tarifPourDevise(planId: string, currency: string) {
  return TARIFS[planId]?.[currency] ?? null;
}

export const SUBSCRIPTION_PLANS = [
  {
    id: "STARTER",
    name: "Starter",
    description: "Idéal pour les propriétaires indépendants et petites locations.",
    maxProperties: 5,
    features: [
      "Jusqu'à 5 biens immobiliers",
      "Émission automatique des quittances",
      "Portail locataire & déclarations",
      "Rappels par email",
      "Support standard par email",
    ],
  },
  {
    id: "PRO",
    name: "Professionnel",
    popular: true,
    description: "Pour les gestionnaires et agences en pleine croissance.",
    maxProperties: 25,
    features: [
      "Jusqu'à 25 biens immobiliers",
      "Suivi des incidents avec photos",
      "Alertes de fin de bail & renouvellement",
      "Rappels automatiques multi-canaux",
      "Paiements en ligne & PayDunya (Orange Money, Wave...)",
      "Support prioritaire 7j/7",
    ],
  },
  {
    id: "ENTERPRISE",
    name: "Agence & Multi-Comptes",
    description: "Pour les cabinets de gestion immobilière et syndics.",
    maxProperties: "Illimité",
    features: [
      "Tout ce qui est inclus dans Pro",
      "Gestion multi-utilisateurs & collaborateurs",
      "Export comptable avancé (FEC/Excel)",
      "Accompagnement & onboarding dédié",
      "SLA garanti 99.9% et support VIP",
    ],
  },
];

/**
 * Plafond de biens de la formule, ou `null` si illimitée (ENTERPRISE, ou un
 * identifiant de formule inconnu — on ne bloque jamais sur une donnée absente).
 *
 * Pendant l'essai gratuit, l'utilisateur bénéficie des fonctionnalités de la
 * formule Pro (promis dans les CGU) : c'est à l'appelant de résoudre l'id de
 * formule effectif (voir property.controller.ts) avant d'appeler cette
 * fonction, PRO étant alors substitué au plan réellement souscrit (STARTER
 * par défaut à l'inscription).
 */
export function maxPropertiesForPlan(planId: string): number | null {
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
  if (!plan || typeof plan.maxProperties !== "number") return null;
  return plan.maxProperties;
}

/**
 * Retourne la liste des formules SaaS et leurs tarifs.
 *
 * La route est publique : elle ne connaît donc pas l'utilisateur et sa devise
 * arrive en paramètre (`?currency=XOF`). La réponse indique toujours la devise
 * effectivement appliquée, afin que l'interface n'ait jamais à la supposer.
 */
export const getPlans = asyncHandler(async (req: Request, res: Response) => {
  const currency = deviseFacturee(typeof req.query.currency === "string" ? req.query.currency : null);

  res.json(
    SUBSCRIPTION_PLANS.map((plan) => {
      const tarif = tarifPourDevise(plan.id, currency);
      return {
        ...plan,
        currency,
        monthlyPrice: tarif?.monthly ?? 0,
        annualPrice: tarif?.annual ?? 0,
      };
    })
  );
});

/** Retourne l'état complet de l'abonnement et de la période d'essai de l'utilisateur connecté. */
export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== "MANAGER") {
    throw new ApiError(403, "Espace réservé aux gestionnaires");
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
  if (!user) throw new ApiError(404, "Utilisateur introuvable");

  const subscriptionInfo = computeSubscriptionInfo(user);

  const history = await db
    .select()
    .from(platformSubscriptions)
    .where(eq(platformSubscriptions.userId, user.id))
    .orderBy(desc(platformSubscriptions.createdAt));

  res.json({
    subscription: subscriptionInfo,
    userEmail: user.email,
    history,
  });
});

const subscribeSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
  paymentMethod: z.enum(["STRIPE", "PAYDUNYA", "BANK_TRANSFER", "DEMO"]),
  bankReference: z.string().optional(),
});

/**
 * Durée pendant laquelle une réclamation de paiement d'abonnement (voir plus
 * bas) reste opposable à une nouvelle tentative. Même principe et même valeur
 * que DUREE_RECLAMATION_MS dans invoice.controller.ts : largement suffisant
 * pour un appel réseau à un prestataire, tout en évitant qu'un crash entre la
 * pose de la réclamation et sa levée ne bloque le compte indéfiniment.
 */
const DUREE_RECLAMATION_ABONNEMENT_MS = 60_000;

/** Souscrit ou renouvelle un plan d'abonnement SaaS. */
export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== "MANAGER") {
    throw new ApiError(403, "Espace réservé aux gestionnaires");
  }

  const body = subscribeSchema.parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.id, req.user.userId));
  if (!user) throw new ApiError(404, "Utilisateur introuvable");

  const planDef = SUBSCRIPTION_PLANS.find((p) => p.id === body.plan);
  if (!planDef) throw new ApiError(400, "Plan invalide");

  // Le prix suit la devise du gestionnaire, et c'est cette même devise qui est
  // transmise au prestataire : le montant débité ne peut donc plus différer du
  // montant affiché d'un facteur 655.
  const currency = deviseFacturee(user.currency);
  const tarif = tarifPourDevise(body.plan, currency);
  if (!tarif) throw new ApiError(400, "Plan invalide");

  const amount = body.billingCycle === "ANNUAL" ? tarif.annual : tarif.monthly;
  const paymentReferenceId = `sub_${user.id}_${Date.now()}`;

  // Réclamation atomique, AVANT tout appel au prestataire — même principe que
  // payInvoice (voir invoice.controller.ts) : sans elle, un double clic sur
  // "S'abonner", ou deux onglets ouverts sur la même page, atteignaient tous
  // les deux initiatePayment en même temps. Contrairement à une facture, il
  // n'existe pas ici de ligne PENDING préexistante à réclamer : subscribe()
  // en crée une nouvelle à chaque appel. La réclamation porte donc sur le
  // COMPTE lui-même (users.subscriptionPaymentAttemptStartedAt), pour
  // qu'une seule tentative de paiement d'abonnement soit jamais en vol par
  // gestionnaire à la fois — sans quoi le prestataire (Stripe/PayDunya)
  // pouvait être débité deux fois pour un seul clic, et deux enregistrements
  // PAID concurrents pouvaient se marcher dessus sur la date de fin
  // d'abonnement (calculée à partir du même `subscriptionEndsAt` de départ).
  const seuilReclamationPerimee = new Date(Date.now() - DUREE_RECLAMATION_ABONNEMENT_MS);
  const [reclame] = await db
    .update(users)
    .set({ subscriptionPaymentAttemptStartedAt: new Date() })
    .where(
      and(
        eq(users.id, user.id),
        or(
          isNull(users.subscriptionPaymentAttemptStartedAt),
          lt(users.subscriptionPaymentAttemptStartedAt, seuilReclamationPerimee)
        )
      )
    )
    .returning();

  if (!reclame) {
    throw new ApiError(409, "Une demande d'abonnement est déjà en cours pour ce compte. Patientez un instant puis réessayez.");
  }

  let paymentResult: PaymentIntentResult;
  try {
    // Déclenche l'initiation du paiement de l'abonnement
    paymentResult = await initiatePayment({
      method: body.paymentMethod as PaymentMethodKey,
      amount,
      currency,
      invoiceId: paymentReferenceId,
      payerEmail: user.email,
      bankReference: body.bankReference,
      returnPath: "/subscription",
    });
  } finally {
    // Levée inconditionnelle, comme pour payInvoice : que l'appel ait réussi,
    // échoué, ou n'ait même pas eu lieu, la réclamation ne doit jamais
    // survivre à cette tentative.
    await db
      .update(users)
      .set({ subscriptionPaymentAttemptStartedAt: null })
      .where(eq(users.id, user.id));
  }

  // La période ne repart pas de zéro à chaque renouvellement : si le
  // gestionnaire a encore des jours payés devant lui, elle les prolonge au lieu
  // de les effacer (voir calculerPeriode). Renouveler avant l'échéance — ce
  // que l'interface encourage, et le seul moyen d'éviter une coupure — ne coûte
  // donc plus les jours restants.
  //
  // Ce report tel quel n'est correct QUE pour le renouvellement du MÊME plan
  // (même tarif journalier des deux côtés). Changer de plan (upgrade ou
  // downgrade) avec des jours encore payés sur l'ancien exige de reconvertir
  // leur valeur au tarif du nouveau plan (voir calculerJoursCredit) — sans
  // quoi un gestionnaire changeant de plan quelques jours avant son échéance
  // recevait ces jours-là au tarif de l'ANCIEN plan sur le NOUVEAU, moins cher
  // ou plus cher selon le sens du changement.
  const now = new Date();
  const changeDePlan = user.subscriptionPlan !== body.plan;
  const joursRestants = user.subscriptionEndsAt ? (user.subscriptionEndsAt.getTime() - now.getTime()) / 86_400_000 : 0;

  // La période active en cours n'a de valeur connue que via le dernier
  // paiement effectivement réglé : c'est lui qui porte le montant et la
  // périodicité (mensuel/annuel) réellement payés pour l'ancien plan.
  let dernierPaiement: typeof platformSubscriptions.$inferSelect | undefined;
  if (changeDePlan && joursRestants > 0) {
    [dernierPaiement] = await db
      .select()
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.userId, user.id), eq(platformSubscriptions.status, "PAID")))
      .orderBy(desc(platformSubscriptions.createdAt))
      .limit(1);
  }

  // NOTE : ce calcul ne sert de valeur DÉFINITIVE que pour un paiement
  // confirmé tout de suite (isConfirmed ci-dessous, ex. DEMO) — "now" est
  // alors bien l'instant réel d'activation. Pour un paiement asynchrone
  // (virement, PayDunya, Stripe), il n'est stocké sur l'enregistrement PENDING
  // qu'à titre indicatif : activateSubscriptionRecord() refait ce même calcul
  // au moment où l'accès s'ouvre réellement (voir calculerPeriodeActivation).
  const { startDate, endDate } = calculerPeriodeActivation({
    maintenant: now,
    cycle: body.billingCycle,
    changeDePlan,
    finActuelle: user.subscriptionEndsAt,
    nouveauMontant: amount,
    dernierPaiement: dernierPaiement
      ? {
          amount: dernierPaiement.amount,
          startDate: dernierPaiement.startDate,
          billingCycle: dernierPaiement.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
        }
      : null,
  });

  // N'active RÉELLEMENT l'abonnement (droits d'accès) que si le paiement est
  // confirmé (status "PAID" — cas DEMO, simulation sans clé configurée, ou
  // futur webhook PayDunya synchrone). Un virement déclaré (BANK_TRANSFER,
  // toujours "PENDING_VALIDATION") ou un paiement encore en attente d'action
  // (Stripe/PayDunya réels, "REQUIRES_ACTION") ne doit jamais accorder l'accès
  // tant qu'aucune confirmation réelle n'est arrivée — sans quoi n'importe quel
  // compte peut s'auto-déclarer un abonnement gratuit. On enregistre malgré
  // tout l'historique (statut PENDING) pour traçabilité et validation
  // ultérieure, mais sans jamais toucher aux droits d'accès de l'utilisateur.
  const isConfirmed = paymentResult.status === "PAID";

  // Active l'abonnement ET enregistre l'historique de facturation ensemble :
  // sans transaction, un échec du second insert laissait un abonnement actif
  // sans aucune trace d'audit/facturation correspondante.
  const { updatedUser, subscriptionRecord } = await db.transaction(async (tx: Transaction) => {
    const [updatedUser] = isConfirmed
      ? await tx
          .update(users)
          .set({
            subscriptionStatus: "ACTIVE",
            subscriptionPlan: body.plan,
            subscriptionEndsAt: endDate,
            subscriptionPaymentMethod: body.paymentMethod,
          })
          .where(eq(users.id, user.id))
          .returning()
      : await tx.select().from(users).where(eq(users.id, user.id));

    const [subscriptionRecord] = await tx
      .insert(platformSubscriptions)
      .values({
        userId: user.id,
        plan: body.plan,
        amount,
        currency,
        billingCycle: body.billingCycle,
        status: isConfirmed ? "PAID" : "PENDING",
        paymentMethod: body.paymentMethod,
        paymentRef: paymentResult.reference,
        startDate,
        endDate,
      })
      .returning();

    return { updatedUser, subscriptionRecord };
  });

  const subscriptionInfo = computeSubscriptionInfo(updatedUser);

  res.status(200).json({
    success: isConfirmed,
    message: isConfirmed
      ? `Votre abonnement au plan ${planDef.name} a été activé avec succès !`
      : `Paiement enregistré, en attente de confirmation. Votre abonnement au plan ${planDef.name} sera activé dès que le paiement sera validé.`,
    subscription: subscriptionInfo,
    payment: paymentResult,
    record: subscriptionRecord,
  });
});

/** Résiliation du renouvellement d'abonnement. */
export const cancelSubscription = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.role !== "MANAGER") {
    throw new ApiError(403, "Espace réservé aux gestionnaires");
  }

  const [updatedUser] = await db
    .update(users)
    .set({
      subscriptionStatus: "CANCELLED",
    })
    .where(eq(users.id, req.user.userId))
    .returning();

  res.json({
    success: true,
    message: "Le renouvellement automatique de votre abonnement a été annulé.",
    subscription: computeSubscriptionInfo(updatedUser),
  });
});
