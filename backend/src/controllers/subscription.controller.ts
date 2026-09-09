import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { platformSubscriptions, users } from "../db/schema";
import { initiatePayment, PaymentMethodKey } from "../services/payment.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { computeSubscriptionInfo } from "./auth.controller";

export const SUBSCRIPTION_PLANS = [
  {
    id: "STARTER",
    name: "Starter",
    description: "Idéal pour les propriétaires indépendants et petites locations.",
    monthlyPrice: 9,
    annualPrice: 86, // ~7€/mois
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
    monthlyPrice: 29,
    annualPrice: 278, // ~23€/mois
    maxProperties: "Illimité",
    features: [
      "Nombre de biens illimité",
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
    monthlyPrice: 49,
    annualPrice: 470, // ~39€/mois
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

/** Retourne la liste des formules SaaS et leurs tarifs. */
export const getPlans = asyncHandler(async (_req: Request, res: Response) => {
  res.json(SUBSCRIPTION_PLANS);
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

  const amount = body.billingCycle === "ANNUAL" ? planDef.annualPrice : planDef.monthlyPrice;
  const paymentReferenceId = `sub_${user.id}_${Date.now()}`;

  // Déclenche l'initiation du paiement de l'abonnement
  const paymentResult = await initiatePayment({
    method: body.paymentMethod as PaymentMethodKey,
    amount,
    invoiceId: paymentReferenceId,
    payerEmail: user.email,
    bankReference: body.bankReference,
    returnPath: "/subscription",
  });

  const now = new Date();
  const endDate = new Date(now);
  if (body.billingCycle === "ANNUAL") {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

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
        billingCycle: body.billingCycle,
        status: isConfirmed ? "PAID" : "PENDING",
        paymentMethod: body.paymentMethod,
        paymentRef: paymentResult.reference,
        startDate: now,
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
