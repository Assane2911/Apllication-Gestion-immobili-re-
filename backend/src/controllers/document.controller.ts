import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { agencySettings, contracts, invoices, properties, tenants } from "../db/schema";
import { periodeCouverte } from "../services/invoice.service";
import { loadInspectionForExport } from "./inspection.controller";
import { generateInspectionHtml, generateLeaseHtml, generateReceiptHtml } from "../services/pdf.service";
import { getSignedUrl } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire } from "../utils/authorization";
import { nomAvecCivilite } from "../utils/nom";

export const getInvoiceReceipt = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { invoiceId } = req.params;

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new ApiError(404, "Facture introuvable");

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, invoice.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  // Sécurité locataire/gestionnaire : seuls le locataire du contrat, ou le
  // gestionnaire propriétaire du bien (sans ce dernier contrôle, n'importe
  // quel gestionnaire pouvait récupérer la quittance d'une autre agence en
  // devinant/récupérant l'ID de la facture), ont accès à cette quittance —
  // tout autre rôle, y compris ADMIN, est refusé par défaut.
  assertAccesLocataireOuGestionnaire(
    req.user.role,
    contract.tenantId === req.user.tenantId,
    property?.managerId === req.user.userId
  );

  // Une quittance de loyer atteste juridiquement du paiement effectif du loyer :
  // elle ne peut être délivrée que si la facture est acquittée (PAID).
  if (invoice.status !== "PAID") {
    throw new ApiError(400, "Une quittance de loyer ne peut être générée que pour une facture réglée (statut PAID)");
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
      address: agency?.address,
      phone: agency?.phone,
      email: agency?.email,
      siretOrId: agency?.siretOrId,
      legalNotice: agency?.legalNotice,
    },
    tenant: {
      fullName: tenant ? nomAvecCivilite(tenant) : "Locataire",
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
      paymentMethod: invoice.paymentMethod || "VIREMENT",
      paymentRef: invoice.paymentRef,
    },
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(receiptHtml);
});

export const getContractLease = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { contractId } = req.params;

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  // Sécurité locataire/gestionnaire : même contrôle que pour les quittances
  // (voir getInvoiceReceipt ci-dessus) — sans lui, n'importe quel gestionnaire
  // pouvait récupérer le bail d'une autre agence, et tout compte ADMIN
  // pouvait lire n'importe quel bail de la plateforme.
  assertAccesLocataireOuGestionnaire(
    req.user.role,
    contract.tenantId === req.user.tenantId,
    property?.managerId === req.user.userId
  );

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
  const [agency] = property?.managerId
    ? await db.select().from(agencySettings).where(eq(agencySettings.userId, property.managerId))
    : [];

  const leaseHtml = generateLeaseHtml(
    {
      ...contract,
      property,
      tenant,
    },
    agency || { agencyName: "Agence Immobilière" }
  );

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(leaseHtml);
});

export const getInspectionReport = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { inspectionId } = req.params;

  const inspection = await loadInspectionForExport(inspectionId);
  if (!inspection) throw new ApiError(404, "État des lieux introuvable");

  // Même contrôle d'accès que le bail et la quittance (voir
  // getContractLease/getInvoiceReceipt ci-dessus) : seuls le locataire
  // concerné et le gestionnaire propriétaire du bien y ont accès.
  assertAccesLocataireOuGestionnaire(
    req.user.role,
    inspection.tenantId === req.user.tenantId,
    inspection.managerId === req.user.userId
  );

  // Un export "certifié" n'a de sens qu'une fois le constat finalisé : tant
  // qu'il est en brouillon, son contenu peut encore changer (même garde-fou
  // que pour la quittance, délivrée uniquement sur facture PAID).
  if (inspection.status !== "COMPLETED") {
    throw new ApiError(400, "L'export n'est disponible qu'une fois l'état des lieux finalisé");
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
    tenant: { fullName: inspection.tenant ? nomAvecCivilite(inspection.tenant) : "" },
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
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { contractId } = req.params;

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  assertAccesLocataireOuGestionnaire(
    req.user.role,
    contract.tenantId === req.user.tenantId,
    property?.managerId === req.user.userId
  );

  if (!contract.scannedContractUrl) {
    throw new ApiError(404, "Aucun contrat papier scanné n'est rattaché à ce bail");
  }

  const fileUrl = /^https?:\/\//i.test(contract.scannedContractUrl)
    ? contract.scannedContractUrl
    : await getSignedUrl(contract.scannedContractUrl);

  res.json({ url: fileUrl });
});

