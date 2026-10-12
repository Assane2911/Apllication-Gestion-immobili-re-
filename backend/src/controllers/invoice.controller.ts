import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { invoiceStatusEnum } from "../db/schema";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { contracts, invoicePayments, invoices, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { initiatePayment, PaymentIntentResult, PaymentMethodKey } from "../services/payment.service";
import { sendPartialPaymentReceiptEmail, sendPaymentReceiptEmail } from "../services/receipt.service";
import { runRentDueReminders, sendSingleInvoiceReminder } from "../services/reminder.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership, chargerLocataireDuCompte, estLocataireDuBail } from "../utils/authorization";
import { bauxDuLocataire } from "../services/colocation.service";
import { resoudreDateEncaissement } from "../utils/dateEncaissement";
import { libelleMoyenPaiement } from "../utils/moyenPaiement";
import { solderEnLigne } from "../services/paiementEnLigne.service";
import { arrondir, montantRegle, resteDu } from "../utils/montants";

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
        montantRegle: montantRegle(r.invoice),
        resteDu: resteDu(r.invoice),
        contract: { ...r.contract, tenant: r.tenant, property: r.property },
      })),
      count,
      pagination
    )
  );
});

/** Le gestionnaire marque manuellement une facture comme réglée (ex: espèces). */
/**
 * Moyens que le gestionnaire peut enregistrer À LA MAIN. STRIPE, PAYDUNYA et
 * DEMO ne viennent que de leur prestataire (ou du mode démonstration) : les
 * saisir à la main ferait passer un encaissement non vérifié pour un paiement
 * en ligne.
 */
export const MOYENS_SAISIS_A_LA_MAIN = ["BANK_TRANSFER", "CASH", "CHEQUE", "MOBILE_MONEY"] as const;

const markPaidSchema = z.object({
  paymentMethod: z.enum(MOYENS_SAISIS_A_LA_MAIN).default("BANK_TRANSFER"),
  paymentRef: z.string().trim().max(200).optional(),
  // Montant encaissé. Absent : le reste dû (règle la facture). Inférieur au
  // reste dû : paiement PARTIEL, la facture reste en attente.
  amount: z.number().finite().positive().optional(),
  // Date réelle de l'encaissement (« AAAA-MM-JJ »), voir utils/dateEncaissement.ts.
  paidAt: z.string().max(40).nullish(),
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
  assertOwnership(row, (r) => r.property.managerId, managerId, "Facture introuvable");
  return row.invoice;
}

export const markInvoicePaid = asyncHandler(async (req: Request, res: Response) => {
  const body = markPaidSchema.parse(req.body);
  const invoice = await assertInvoiceOwnership(req.params.id, req.user!.userId);

  assertFactureModifiable(invoice, "regler");

  const maintenant = new Date();
  const encaisseLe = resoudreDateEncaissement(body.paidAt, maintenant, invoice.dueDate);

  // Lecture et écriture dans UNE transaction, la ligne verrouillée : deux
  // enregistrements simultanés (deux clics, deux onglets) ne peuvent ni dépasser
  // le montant de la facture ni la solder deux fois. Le second attend le
  // premier, puis relit l'état à jour.
  const resultat = await db.transaction(async (tx) => {
    const [courante] = await tx.select().from(invoices).where(eq(invoices.id, req.params.id)).for("update");
    if (!courante || !(ETATS_MODIFIABLES as readonly string[]).includes(courante.status)) {
      throw new ApiError(409, "Cette facture a changé d'état entre-temps. Rechargez la page.");
    }

    const reste = resteDu(courante);
    // Sans montant : le reste dû, c'est-à-dire le comportement d'avant pour une
    // facture sans paiement antérieur.
    const montant = body.amount === undefined ? reste : arrondir(body.amount);
    if (montant <= 0) throw new ApiError(400, "Le montant du paiement doit être supérieur à zéro.");
    if (montant > reste) {
      throw new ApiError(400, `Le montant dépasse le reste dû (${reste} ${courante.currency ?? "EUR"}).`);
    }

    const dejaRegle = arrondir(courante.amountPaid + montant);
    const solde = arrondir(courante.amount - dejaRegle) <= 0;
    const reference = body.paymentRef || `manuel_${Date.now()}`;

    const [paiement] = await tx
      .insert(invoicePayments)
      .values({
        invoiceId: courante.id,
        amount: montant,
        paidAt: encaisseLe,
        paymentMethod: body.paymentMethod,
        paymentRef: reference,
      })
      .returning();

    // Tant que la facture n'est pas soldée, elle garde son état (en attente ou
    // en retard) : seul le cumul avance. Soldée, elle devient PAYÉE, datée du
    // DERNIER paiement, avec le moyen et la référence de ce dernier.
    const [misAJour] = await tx
      .update(invoices)
      .set(
        solde
          ? { status: "PAID", amountPaid: arrondir(courante.amount), paidAt: encaisseLe, paymentMethod: body.paymentMethod, paymentRef: reference }
          : { amountPaid: dejaRegle }
      )
      .where(eq(invoices.id, courante.id))
      .returning();

    return { facture: misAJour, paiementId: paiement.id, montant, solde, reste: solde ? 0 : arrondir(courante.amount - dejaRegle) };
  });

  const updated = resultat.facture;

  // Quittance PDF par email : seulement quand le loyer est SOLDÉ. Une quittance
  // atteste le paiement intégral ; pour un paiement partiel, c'est un simple
  // reçu (envoyé séparément, voir plus bas). Ne doit jamais faire échouer la
  // réponse si l'email ne part pas (SMTP non configuré, etc.).
  if (resultat.solde) {
    await sendPaymentReceiptEmail(updated.id).catch((err) =>
      console.error("[invoice] Échec de l'envoi automatique de la quittance:", err)
    );
  } else {
    // Paiement partiel : un REÇU (pas une quittance) avec le reste dû.
    await sendPartialPaymentReceiptEmail(updated.id, resultat.paiementId).catch((err) =>
      console.error("[invoice] Échec de l'envoi du reçu de paiement partiel:", err)
    );
  }

  const [row] = await db
    .select({ contract: contracts, tenant: tenants, property: properties })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.id, updated.contractId));
  const devise = updated.currency ?? "EUR";
  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "invoice.mark_paid",
    entityType: "invoice",
    entityId: updated.id,
    entityLabel: row ? `${row.tenant.firstName} ${row.tenant.lastName} — ${row.property.title}` : "Facture",
    details:
      (resultat.solde
        ? `Facture ${updated.periodMonth}/${updated.periodYear} marquée réglée (${updated.amount} ${devise}, `
        : `Paiement partiel de ${resultat.montant} ${devise} sur la facture ${updated.periodMonth}/${updated.periodYear} (reste ${resultat.reste} ${devise}, `) +
      `${libelleMoyenPaiement(body.paymentMethod)}` +
      // Une date d'encaissement différente d'aujourd'hui est la donnée qui
      // déplace le loyer dans les bilans : elle doit apparaître au journal.
      `${encaisseLe.toISOString().slice(0, 10) !== maintenant.toISOString().slice(0, 10) ? `, ${resultat.solde ? "encaissée" : "encaissé"} le ${encaisseLe.toISOString().slice(0, 10)}` : ""})`,
  });

  res.json({ ...updated, montantEnregistre: resultat.montant, resteDu: resultat.reste, solde: resultat.solde });
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

  // Une facture sur laquelle de l'argent a déjà été encaissé ne s'annule pas :
  // elle disparaîtrait des encaissements alors que l'argent a été perçu (même
  // raison que pour une facture réglée, voir ETATS_MODIFIABLES).
  if (invoice.amountPaid > 0) {
    throw new ApiError(
      409,
      "Des paiements ont déjà été enregistrés sur cette facture : elle ne peut plus être annulée. Passez par un avoir ou un remboursement."
    );
  }

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

/** Factures du locataire connecté (portail locataire), y compris celles des baux dont il est colocataire. */
export const myInvoices = asyncHandler(async (req: Request, res: Response) => {
  const baux = await bauxDuLocataire((await chargerLocataireDuCompte(req)).id);
  if (baux.size === 0) return res.json([]);
  const rows = await db
    .select({ invoice: invoices, contract: contracts, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(inArray(contracts.id, [...baux.keys()]))
    .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth));

  res.json(
    rows.map(
      (r: {
        invoice: typeof invoices.$inferSelect;
        contract: typeof contracts.$inferSelect;
        property: typeof properties.$inferSelect;
      }) => ({
        ...r.invoice,
        montantRegle: montantRegle(r.invoice),
        resteDu: resteDu(r.invoice),
        contract: { ...r.contract, property: r.property },
      })
    )
  );
});

const paySchema = z.object({
  method: z.enum(["STRIPE", "PAYDUNYA", "BANK_TRANSFER", "DEMO"]),
  bankReference: z.string().optional(),
});

/** Le locataire connecté initie le paiement d'une de ses factures. */
export const payInvoice = asyncHandler(async (req: Request, res: Response) => {
  const body = paySchema.parse(req.body);

  const [row] = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(invoices.id, req.params.id));

  if (!row) throw new ApiError(404, "Facture introuvable");
  if (!(await estLocataireDuBail(req, row.contract))) throw new ApiError(403, "Accès refusé");
  if (row.invoice.status === "PAID") throw new ApiError(409, "Cette facture est déjà réglée");
  // Le payeur est le locataire connecté (titulaire ou colocataire) : c'est son email qui part au prestataire.
  const payeur = await chargerLocataireDuCompte(req);
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
      // Le RESTE DÛ : sur une facture déjà réglée en partie par le gestionnaire,
      // le locataire ne repaie pas la part déjà versée.
      amount: resteDu(row.invoice),
      // Chaque facture porte sa devise (invoices.currency) : un loyer saisi en
      // EUR ne doit pas partir vers un prestataire qui encaisse en FCFA.
      currency: row.invoice.currency,
      invoiceId: row.invoice.id,
      payerEmail: payeur.email,
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
  const [enAttente] =
    result.status === "PAID"
      ? [undefined]
      : await db
          .update(invoices)
          .set({ paymentMethod: result.method, paymentRef: result.reference })
          .where(and(eq(invoices.id, row.invoice.id), inArray(invoices.status, [...ETATS_MODIFIABLES])))
          .returning();
  // Réglé sur le champ (mode démonstration) : encaissement enregistré et facture soldée.
  const updated =
    result.status === "PAID"
      ? await solderEnLigne(row.invoice.id, { methode: result.method, reference: result.reference })
      : enAttente;

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
  // L'email est le canal de référence : un échec WhatsApp seul (numéro
  // invalide, modèle rejeté par Meta) ne compte pas dans `echecs` (voir
  // reminder.service.ts::aEteJoint), donc sans cette clause le gestionnaire
  // lisait "envoyé avec succès" alors qu'une partie de ses locataires
  // n'avait rien reçu sur WhatsApp — voir aussi le journal d'activité, qui
  // reçoit le détail (numéro concerné) pour chaque échec de ce type.
  const whatsappNote =
    result.whatsappEchecs > 0
      ? ` (${result.whatsappEchecs} message${result.whatsappEchecs > 1 ? "s" : ""} WhatsApp non délivré${result.whatsappEchecs > 1 ? "s" : ""} — voir le journal d'activité)`
      : "";
  res.json({
    success: true,
    message:
      result.echecs > 0
        ? `${result.sent} avis d'échéance envoyé(s), ${result.echecs} en échec — ils seront retentés automatiquement.${whatsappNote}`
        : `${result.sent} avis d'échéance envoyé(s) avec succès aux locataires.${whatsappNote}`,
    sent: result.sent,
    echecs: result.echecs,
    whatsappEchecs: result.whatsappEchecs,
    details: result.details,
  });
});

/** Envoi d'un rappel individuel pour une facture impayée. */
export const sendInvoiceReminder = asyncHandler(async (req: Request, res: Response) => {
  const result = await sendSingleInvoiceReminder(req.params.id, req.user!.userId);
  res.json({
    message: result.success
      ? result.whatsappError
        ? `Rappel envoyé par email à ${result.tenantName} (${result.tenantEmail}), mais le message WhatsApp n'a pas pu être délivré.`
        : `Rappel d'échéance envoyé à ${result.tenantName} (${result.tenantEmail}).`
      : `L'envoi vers ${result.tenantEmail} a échoué. Vérifiez l'adresse du locataire, puis réessayez.`,
    ...result,
  });
});

