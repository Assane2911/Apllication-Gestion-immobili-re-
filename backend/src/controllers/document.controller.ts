import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { agencySettings, contracts, invoices, properties, tenants } from "../db/schema";
import { generateLeaseHtml, generateReceiptHtml } from "../services/pdf.service";
import { getSignedUrl } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire } from "../utils/authorization";

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
      fullName: `${tenant?.firstName || "Locataire"} ${tenant?.lastName || ""}`,
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

