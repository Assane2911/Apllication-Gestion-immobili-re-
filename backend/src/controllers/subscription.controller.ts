import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { platformSubscriptions, users } from "../db/schema";
import { initiatePayment, PaymentMethodKey } from "../services/payment.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { computeSubscriptionInfo } from "./auth.controller";

export const SUBSCRIPTION_PLANS = [
  {
    id: "STARTER",
    name: "Starter",
    description: "Idéal pour les propriétaires indépendants et petites locations.",
    monthlyPrice: 19,
    annualPrice: 180, // ~15€/mois
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
    monthlyPrice: 49,
    annualPrice: 468, // ~39€/mois
    maxProperties: "Illimité",
    features: [
      "Nombre de biens illimité",
      "Suivi des incidents avec photos",
      "Alertes de fin de bail & renouvellement",
      "Rappels automatiques multi-canaux",
      "Paiements en ligne & Mobile Money",
      "Support prioritaire 7j/7",
    ],
  },
  {
    id: "ENTERPRISE",
    name: "Agence & Multi-Comptes",
    description: "Pour les cabinets de gestion immobilière et syndics.",
    monthlyPrice: 99,
    annualPrice: 948, // ~79€/mois
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
  paymentMethod: z.enum(["STRIPE", "MOBILE_MONEY", "BANK_TRANSFER", "DEMO"]),
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
  });

  const now = new Date();
  const endDate = new Date(now);
  if (body.billingCycle === "ANNUAL") {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  // Active l'abonnement pour le gestionnaire
  const [updatedUser] = await db
    .update(users)
    .set({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: body.plan,
      subscriptionEndsAt: endDate,
      subscriptionPaymentMethod: body.paymentMethod,
    })
    .where(eq(users.id, user.id))
    .returning();

  // Enregistre l'historique de facturation de la plateforme
  const [subscriptionRecord] = await db
    .insert(platformSubscriptions)
    .values({
      userId: user.id,
      plan: body.plan,
      amount,
      billingCycle: body.billingCycle,
      status: paymentResult.status === "PAID" ? "PAID" : "PENDING",
      paymentMethod: body.paymentMethod,
      paymentRef: paymentResult.reference,
      startDate: now,
      endDate,
    })
    .returning();

  const subscriptionInfo = computeSubscriptionInfo(updatedUser);

  res.status(200).json({
    success: true,
    message: `Votre abonnement au plan ${planDef.name} a été activé avec succès !`,
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
