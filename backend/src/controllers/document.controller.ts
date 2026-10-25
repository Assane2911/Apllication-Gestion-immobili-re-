import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { agencySettings, contractGuarantors, contracts, invoices, properties, rentRevisions, tenants } from "../db/schema";
import { periodeCouverte } from "../services/invoice.service";
import { loadInspectionForExport } from "./inspection.controller";
import { colocatairesDuBail } from "./cotenant.controller";
import { colocatairesActifs, nomsDesLocataires } from "../services/colocation.service";
import { motifRevision, numeroAvenant, revisionsAppliquees } from "../services/rentRevision.service";
import { generateInspectionHtml, generateLeaseHtml, generateReceiptHtml, generateRentRevisionHtml } from "../services/pdf.service";
import { getSignedUrl } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire, estLocataireDuBail } from "../utils/authorization";

/** Réponse d'un refus d'accès : celle d'un identifiant inventé, pour ne pas révéler qu'une ressource existe ailleurs. */
const FACTURE_INTROUVABLE = { message: "Facture introuvable", code: "INVOICE_NOT_FOUND" };
const CONTRAT_INTROUVABLE = { message: "Contrat introuvable", code: "CONTRACT_NOT_FOUND" };
const ETAT_DES_LIEUX_INTROUVABLE = { message: "État des lieux introuvable", code: "INSPECTION_NOT_FOUND" };
const REVISION_INTROUVABLE = { message: "Révision introuvable", code: "REVISION_NOT_FOUND" };

export const getInvoiceReceipt = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { invoiceId } = req.params;

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new ApiError(404, "Facture introuvable", "INVOICE_NOT_FOUND");

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, invoice.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  // Sécurité locataire/gestionnaire : seuls le locataire du contrat, ou le
  // gestionnaire propriétaire du bien (sans ce dernier contrôle, n'importe
  // quel gestionnaire pouvait récupérer la quittance d'une autre agence en
  // devinant/récupérant l'ID de la facture), ont accès à cette quittance —
  // tout autre rôle, y compris ADMIN, est refusé par défaut.
  assertAccesLocataireOuGestionnaire(
    req.user.role,
    await estLocataireDuBail(req, contract),
    property?.managerId === req.user.userId,
    FACTURE_INTROUVABLE
  );

  // Une quittance de loyer atteste juridiquement du paiement effectif du loyer :
  // elle ne peut être délivrée que si la facture est acquittée (PAID).
  if (invoice.status !== "PAID") {
    throw new ApiError(400, "Une quittance de loyer ne peut être générée que pour une facture réglée (statut PAID)", "RECEIPT_REQUIRES_PAID");
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));

  // Récupérer les paramètres d'agence du gestionnaire propriétaire du bien
  const [agency] = property?.managerId
    ? await db.select().from(agencySettings).where(eq(agencySettings.userId, property.managerId))
    : [];

  const periodeFacturee = periodeCouverte(contract, invoice.periodMonth, invoice.periodYear);

  const receiptHtml = generateReceiptHtml({
    receiptNumber: `QUITT-${invoice.periodYear}-${String(invoice.periodMonth).padStart(2, "0")}-${invoice.id.slice(-6).toUpperCase()}`,
    agency: {
      name: agency?.agencyName || "Agence Immobilière Privée",
      logoUrl: agency?.logoUrl,
      stampUrl: agency?.stampOrSignatureUrl,
      address: agency?.address,
      phone: agency?.phone,
      email: agency?.email,
      siretOrId: agency?.siretOrId,
      legalNotice: agency?.legalNotice,
    },
    tenant: {
      // En colocation, la quittance nomme tous les locataires du bail.
      fullName: tenant ? nomsDesLocataires([tenant, ...(await colocatairesActifs(contract.id))]) : "Locataire",
      email: tenant?.email || "",
      phone: tenant?.phone || "",
    },
    property: {
      title: property?.title || "Logement",
      address: property?.address || "",
      surface: property?.surface || 0,
    },
    invoice: {
      periodMonth: invoice.periodMonth,
      periodYear: invoice.periodYear,
      // Voir receipt.service.ts : même période couverte que la quittance
      // envoyée par email, pour que les deux documents concordent.
      periodStartDay: periodeFacturee.premierJour || null,
      periodEndDay: periodeFacturee.dernierJour || null,
      amount: invoice.amount,
      currency: invoice.currency || "EUR",
      paidAt: invoice.paidAt || invoice.createdAt,
      paymentMethod: invoice.paymentMethod,
      paymentRef: invoice.paymentRef,
    },
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(receiptHtml);
});

export const getContractLease = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { contractId } = req.params;

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  // Sécurité locataire/gestionnaire : même contrôle que pour les quittances
  // (voir getInvoiceReceipt ci-dessus) — sans lui, n'importe quel gestionnaire
  // pouvait récupérer le bail d'une autre agence, et tout compte ADMIN
  // pouvait lire n'importe quel bail de la plateforme.
  assertAccesLocataireOuGestionnaire(
    req.user.role,
    await estLocataireDuBail(req, contract),
    property?.managerId === req.user.userId,
    CONTRAT_INTROUVABLE
  );

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
  const [agency] = property?.managerId
    ? await db.select().from(agencySettings).where(eq(agencySettings.userId, property.managerId))
    : [];

  const revisions = await revisionsAppliquees(contract.id);
  const guarantors = await db.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contract.id));
  const cotenants = (await colocatairesDuBail(contract.id)).map((c: { tenant: typeof tenants.$inferSelect }) => c.tenant);

  const leaseHtml = generateLeaseHtml(
    {
      ...contract,
      revisions,
      guarantors,
      cotenants,
      property,
      tenant,
    },
    agency || { agencyName: "Agence Immobilière" }
  );

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(leaseHtml);
});

export const getInspectionReport = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { inspectionId } = req.params;

  const inspection = await loadInspectionForExport(inspectionId);
  if (!inspection) throw new ApiError(404, "État des lieux introuvable", "INSPECTION_NOT_FOUND");

  // Même contrôle d'accès que le bail et la quittance (voir
  // getContractLease/getInvoiceReceipt ci-dessus) : seuls le locataire
  // concerné et le gestionnaire propriétaire du bien y ont accès.
  assertAccesLocataireOuGestionnaire(
    req.user.role,
    await estLocataireDuBail(req, { id: inspection.contractId, tenantId: inspection.tenantId }),
    inspection.managerId === req.user.userId,
    ETAT_DES_LIEUX_INTROUVABLE
  );

  // Un export "certifié" n'a de sens qu'une fois le constat finalisé : tant
  // qu'il est en brouillon, son contenu peut encore changer (même garde-fou
  // que pour la quittance, délivrée uniquement sur facture PAID).
  if (inspection.status !== "COMPLETED") {
    throw new ApiError(400, "L'export n'est disponible qu'une fois l'état des lieux finalisé", "INSPECTION_EXPORT_NEEDS_FINAL");
  }

  const [agency] = inspection.property?.managerId
    ? await db.select().from(agencySettings).where(eq(agencySettings.userId, inspection.property.managerId))
    : [];

  const html = generateInspectionHtml({
    reference: `EDL-${inspection.type}-${inspection.id.slice(-6).toUpperCase()}`,
    type: inspection.type as "ENTRY" | "EXIT",
    inspectionDate: inspection.inspectionDate,
    agencyName: agency?.agencyName || "Agence Immobilière",
    property: { title: inspection.property?.title || "", address: inspection.property?.address || "" },
    // En colocation, le constat nomme tous les occupants du bail (comme le bail et la quittance).
    tenant: {
      fullName: inspection.tenant
        ? nomsDesLocataires([inspection.tenant, ...(await colocatairesActifs(inspection.contractId))])
        : "",
    },
    rooms: inspection.rooms,
    meters: inspection.meters,
    keys: inspection.keys,
    generalComments: inspection.generalComments,
    managerSignatureUrl: inspection.managerSignatureUrl,
    signedByManagerAt: inspection.signedByManagerAt,
    tenantSignatureUrl: inspection.tenantSignatureUrl,
    signedByTenantAt: inspection.signedByTenantAt,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/**
 * Récupère l'URL d'accès sécurisée (signée) au scan papier du contrat de bail.
 * Accessible uniquement au gestionnaire propriétaire du bien ou au locataire rattaché au contrat.
 */
export const getScannedLease = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { contractId } = req.params;

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  assertAccesLocataireOuGestionnaire(
    req.user.role,
    await estLocataireDuBail(req, contract),
    property?.managerId === req.user.userId,
    CONTRAT_INTROUVABLE
  );

  if (!contract.scannedContractUrl) {
    throw new ApiError(404, "Aucun contrat papier scanné n'est rattaché à ce bail", "SCANNED_CONTRACT_NOT_FOUND");
  }

  const fileUrl = /^https?:\/\//i.test(contract.scannedContractUrl)
    ? contract.scannedContractUrl
    : await getSignedUrl(contract.scannedContractUrl);

  res.json({ url: fileUrl });
});


/** Avenant de révision de loyer : même accès que le bail (locataire du contrat ou gestionnaire du bien). */
export const getRentRevisionAmendment = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const [revision] = await db.select().from(rentRevisions).where(eq(rentRevisions.id, req.params.revisionId));
  if (!revision) throw new ApiError(404, "Révision introuvable", "REVISION_NOT_FOUND");
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, revision.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  assertAccesLocataireOuGestionnaire(
    req.user.role,
    await estLocataireDuBail(req, contract),
    property?.managerId === req.user.userId,
    REVISION_INTROUVABLE
  );
  if (revision.status === "CANCELLED") throw new ApiError(409, "Cette révision a été annulée : aucun avenant ne s'y rattache.", "REVISION_CANCELLED_NO_AMENDMENT");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
  const [agency] = property?.managerId ? await db.select().from(agencySettings).where(eq(agencySettings.userId, property.managerId)) : [];

  const guarantors = await db.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contract.id));
  const cotenants = (await colocatairesDuBail(contract.id)).map((c: { tenant: typeof tenants.$inferSelect }) => c.tenant);

  const html = generateRentRevisionHtml(
    {
      numero: await numeroAvenant(revision),
      status: revision.status,
      previousRent: revision.previousRent,
      newRent: revision.newRent,
      currency: contract.currency,
      effectiveDate: revision.effectiveDate,
      motif: motifRevision(revision),
      note: revision.note,
      createdAt: revision.createdAt,
      contract,
      property,
      tenant,
      guarantors,
      cotenants,
    },
    agency || { agencyName: "Agence Immobilière" }
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
