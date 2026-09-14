import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { invoiceStatusEnum } from "../db/schema";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { initiatePayment, PaymentIntentResult, PaymentMethodKey } from "../services/payment.service";
import { sendPaymentReceiptEmail } from "../services/receipt.service";
import { runRentDueReminders, sendSingleInvoiceReminder } from "../services/reminder.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

function isInvoiceStatus(value: unknown): value is (typeof invoiceStatusEnum.enumValues)[number] {
  return typeof value === "string" && (invoiceStatusEnum.enumValues as readonly string[]).includes(value);
}

/**
 * Express (via `qs`) transforme un paramètre de requête répété en tableau :
 * `?contractId=a&contractId=b` donne `req.query.contractId === ["a", "b"]`.
 * `String(...)` sur ce tableau ne plantait pas — il produisait juste
 * `"a,b"`, une valeur qui ne correspond à aucun contrat réel. La requête
 * semblait donc réussir (200) mais renvoyait silencieusement une liste
 * vide, au lieu d'un 400 signalant clairement une requête mal formée.
 */
const listInvoicesQuerySchema = z.object({
  contractId: z.string().min(1).optional(),
});

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const { contractId } = listInvoicesQuerySchema.parse(req.query);
  const { status } = req.query;

  const conditions = [eq(properties.managerId, req.user!.userId)];
  if (contractId) conditions.push(eq(invoices.contractId, contractId));
  if (isInvoiceStatus(status)) conditions.push(eq(invoices.status, status));
  const whereClause = and(...conditions);

  type InvoiceRow = {
    invoice: typeof invoices.$inferSelect;
    contract: typeof contracts.$inferSelect;
    tenant: typeof tenants.$inferSelect;
    property: typeof properties.$inferSelect;
  };

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause)
      .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause),
  ]);

  res.json(
    buildPaginatedResult(
      rows.map((r: InvoiceRow) => ({
        ...r.invoice,
        contract: { ...r.contract, tenant: r.tenant, property: r.property },
      })),
      count,
      pagination
    )
  );
});

/** Le gestionnaire marque manuellement une facture comme réglée (ex: espèces). */
const markPaidSchema = z.object({
  paymentMethod: z.enum(["STRIPE", "PAYDUNYA", "BANK_TRANSFER", "DEMO"]).default("BANK_TRANSFER"),
  paymentRef: z.string().optional(),
});

/**
 * États depuis lesquels une facture peut encore changer.
 *
 * PAYÉE et ANNULÉE sont TERMINAUX. Rien ne l'imposait jusqu'ici, et cela
 * coûtait trois choses :
 *
 *  - une facture réellement réglée pouvait être annulée tout en conservant son
 *    paidAt et sa référence de paiement : le loyer disparaissait des
 *    encaissements alors que l'argent avait été perçu ;
 *  - une facture déjà réglée en ligne pouvait être re-marquée « payée à la
 *    main », ce qui remplaçait la référence Stripe ou PayDunya par
 *    `manuel_<horodatage>` — le lien avec le paiement réel était perdu, et le
 *    locataire recevait une SECONDE quittance pour le même loyer ;
 *  - une facture annulée pouvait être ressuscitée en « payée ».
 *
 * Corriger une erreur sur une facture réglée relève d'un avoir ou d'un
 * remboursement, pas d'une réécriture silencieuse de l'historique.
 */
export const ETATS_MODIFIABLES = ["PENDING", "LATE"] as const;

/**
 * Durée pendant laquelle une réclamation de paiement (voir payInvoice) reste
 * opposable à une nouvelle tentative. Ce n'est pas le temps qu'on ACCORDE au
 * prestataire — la réclamation est levée juste après son appel, succès ou
 * échec — mais un filet de rattrapage si le processus s'arrête net entre les
 * deux (crash, redéploiement) : sans lui, une facture resterait bloquée pour
 * toujours après un incident, à l'opposé du principe du projet qui préfère
 * refuser une tentative concurrente plutôt qu'interdire un nouvel essai
 * légitime. Largement suffisant pour un appel réseau à un prestataire.
 */
const DUREE_RECLAMATION_MS = 60_000;

/**
 * Refuse une facture déjà dans un état terminal, avec un message qui dit
 * laquelle des deux situations s'applique.
 */
function assertFactureModifiable(
  facture: typeof invoices.$inferSelect,
  operation: "regler" | "annuler"
): void {
  if (facture.status === "PAID") {
    throw new ApiError(
      409,
      operation === "regler"
        ? "Cette facture est déjà réglée."
        : "Une facture réglée ne peut pas être annulée. Passez par un avoir ou un remboursement."
    );
  }
  if (facture.status === "CANCELLED") {
    throw new ApiError(409, "Cette facture a été annulée : elle ne peut plus être modifiée.");
  }
}

async function assertInvoiceOwnership(invoiceId: string, managerId: string) {
  const [row] = await db
    .select({ invoice: invoices, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(invoices.id, invoiceId));
  if (!row || row.property.managerId !== managerId) throw new ApiError(404, "Facture introuvable");
  return row.invoice;
}

export const markInvoicePaid = asyncHandler(async (req: Request, res: Response) => {
  const body = markPaidSchema.parse(req.body);
  const invoice = await assertInvoiceOwnership(req.params.id, req.user!.userId);

  assertFactureModifiable(invoice, "regler");

  // L'écriture est CONDITIONNÉE à l'état lu : la vérification ci-dessus et la
  // mise à jour ne sont pas atomiques à elles deux, et deux clics simultanés
  // pourraient toutes deux la franchir. En exigeant l'état dans le WHERE, une
  // seule des deux écritures aboutit — la seconde ne renvoie aucune ligne.
  const [updated] = await db
    .update(invoices)
    .set({
      status: "PAID",
      paidAt: new Date(),
      paymentMethod: body.paymentMethod,
      paymentRef: body.paymentRef ?? `manuel_${Date.now()}`,
    })
    .where(and(eq(invoices.id, req.params.id), inArray(invoices.status, [...ETATS_MODIFIABLES])))
    .returning();

  if (!updated) {
    throw new ApiError(409, "Cette facture a changé d'état entre-temps. Rechargez la page.");
  }

  // Envoi de la quittance PDF par email au locataire — ne doit jamais faire
  // échouer la réponse si l'email ne part pas (SMTP non configuré, etc.).
  await sendPaymentReceiptEmail(updated.id).catch((err) =>
    console.error("[invoice] Échec de l'envoi automatique de la quittance:", err)
  );

  const [row] = await db
    .select({ contract: contracts, tenant: tenants, property: properties })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.id, updated.contractId));
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "invoice.mark_paid",
    entityType: "invoice",
    entityId: updated.id,
    entityLabel: row ? `${row.tenant.firstName} ${row.tenant.lastName} — ${row.property.title}` : "Facture",
    details: `Facture ${updated.periodMonth}/${updated.periodYear} marquée réglée (${updated.amount} ${updated.currency ?? "EUR"})`,
  });

  res.json(updated);
});

export const cancelInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await assertInvoiceOwnership(req.params.id, req.user!.userId);

  // Annuler une facture déjà annulée n'est pas une erreur : un double clic ne
  // doit pas produire un message d'échec. On renvoie la facture telle quelle,
  // sans réécrire ni journaliser une seconde fois.
  if (invoice.status === "CANCELLED") {
    return res.json(invoice);
  }

  assertFactureModifiable(invoice, "annuler");

  const [updated] = await db
    .update(invoices)
    .set({ status: "CANCELLED" })
    .where(and(eq(invoices.id, req.params.id), inArray(invoices.status, [...ETATS_MODIFIABLES])))
    .returning();

  if (!updated) {
    throw new ApiError(409, "Cette facture a changé d'état entre-temps. Rechargez la page.");
  }

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "invoice.cancel",
    entityType: "invoice",
    entityId: updated.id,
    entityLabel: `Facture ${updated.periodMonth}/${updated.periodYear}`,
    details: `Facture ${updated.periodMonth}/${updated.periodYear} annulée`,
  });

  res.json(updated);
});

/** Factures du locataire connecté (portail locataire). */
export const myInvoices = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const rows = await db
    .select({ invoice: invoices, contract: contracts, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, req.user.tenantId))
    .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth));

  res.json(
    rows.map(
      (r: {
        invoice: typeof invoices.$inferSelect;
        contract: typeof contracts.$inferSelect;
        property: typeof properties.$inferSelect;
      }) => ({ ...r.invoice, contract: { ...r.contract, property: r.property } })
    )
  );
});

const paySchema = z.object({
  method: z.enum(["STRIPE", "PAYDUNYA", "BANK_TRANSFER", "DEMO"]),
  bankReference: z.string().optional(),
});

/** Le locataire connecté initie le paiement d'une de ses factures. */
export const payInvoice = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const body = paySchema.parse(req.body);

  const [row] = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(invoices.id, req.params.id));

  if (!row) throw new ApiError(404, "Facture introuvable");
  if (row.contract.tenantId !== req.user.tenantId) throw new ApiError(403, "Accès refusé");
  if (row.invoice.status === "PAID") throw new ApiError(409, "Cette facture est déjà réglée");
  if (row.invoice.status === "CANCELLED") throw new ApiError(400, "Cette facture a été annulée");

  // Réclamation atomique, AVANT tout appel au prestataire. Stripe se protège
  // lui-même via un Idempotency-Key (voir initiateStripePayment) ; l'API
  // PayDunya n'a rien d'équivalent, donc deux clics simultanés sur "Payer"
  // atteignaient tous les deux initiatePayment et créaient deux factures
  // PayDunya distinctes pour un seul loyer — seule l'écriture FINALE ci-dessous
  // était protégée, trop tard pour empêcher le second appel réseau. Une seule
  // des deux requêtes concurrentes peut poser cette marque ; l'autre est
  // refusée ici, avant d'avoir contacté qui que ce soit.
  const seuilReclamationPerimee = new Date(Date.now() - DUREE_RECLAMATION_MS);
  const [reclamee] = await db
    .update(invoices)
    .set({ paymentAttemptStartedAt: new Date() })
    .where(
      and(
        eq(invoices.id, row.invoice.id),
        inArray(invoices.status, [...ETATS_MODIFIABLES]),
        or(isNull(invoices.paymentAttemptStartedAt), lt(invoices.paymentAttemptStartedAt, seuilReclamationPerimee))
      )
    )
    .returning();

  if (!reclamee) {
    throw new ApiError(409, "Un paiement est déjà en cours pour cette facture. Patientez un instant puis réessayez.");
  }

  let result: PaymentIntentResult;
  try {
    result = await initiatePayment({
      method: body.method as PaymentMethodKey,
      amount: row.invoice.amount,
      // Chaque facture porte sa devise (invoices.currency) : un loyer saisi en
      // EUR ne doit pas partir vers un prestataire qui encaisse en FCFA.
      currency: row.invoice.currency,
      invoiceId: row.invoice.id,
      payerEmail: row.tenant.email,
      bankReference: body.bankReference,
      returnPath: "/portail/paiements",
    });
  } finally {
    // Levée inconditionnelle : que l'appel ait réussi, échoué, ou n'ait même
    // pas eu lieu (exception avant le fetch), la réclamation ne doit jamais
    // survivre à cette tentative. C'est l'écriture ci-dessous (conditionnée à
    // l'état) qui protège le résultat, pas cette marque — elle ne fait que
    // fermer la fenêtre du prochain appel réseau.
    await db.update(invoices).set({ paymentAttemptStartedAt: null }).where(eq(invoices.id, row.invoice.id));
  }

  // Même précaution que pour le règlement manuel : la facture a pu être réglée
  // pendant l'appel au prestataire (un webhook arrive vite). Sans cette
  // condition, on écraserait la référence du paiement réellement encaissé par
  // celle d'une session qui, elle, n'a rien encaissé.
  const [updated] = await db
    .update(invoices)
    .set({
      paymentMethod: result.method,
      paymentRef: result.reference,
      ...(result.status === "PAID" ? { status: "PAID" as const, paidAt: new Date() } : {}),
    })
    .where(and(eq(invoices.id, row.invoice.id), inArray(invoices.status, [...ETATS_MODIFIABLES])))
    .returning();

  if (!updated) {
    throw new ApiError(409, "Cette facture vient d'être réglée. Rechargez la page.");
  }

  if (updated.status === "PAID") {
    await sendPaymentReceiptEmail(updated.id).catch((err) =>
      console.error("[invoice] Échec de l'envoi automatique de la quittance:", err)
    );
  }

  res.json({ invoice: updated, payment: result });
});

/** Déclenchement manuel des avis d'échéance du 1er du mois par le gestionnaire. */
export const sendMonthlyReminders = asyncHandler(async (req: Request, res: Response) => {
  const result = await runRentDueReminders(req.user!.userId);
  res.json({
    success: true,
    message: `${result.sent} avis d'échéance envoyé(s) avec succès aux locataires.`,
    sent: result.sent,
    details: result.details,
  });
});

/** Envoi d'un rappel individuel pour une facture impayée. */
export const sendInvoiceReminder = asyncHandler(async (req: Request, res: Response) => {
  const result = await sendSingleInvoiceReminder(req.params.id, req.user!.userId);
  res.json({
    message: `Rappel d'échéance envoyé à ${result.tenantName} (${result.tenantEmail}).`,
    ...result,
  });
});

