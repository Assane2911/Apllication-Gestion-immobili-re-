import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { agencySettings, contracts, invoices, properties, tenants } from "../db/schema";
import { generateLeaseHtml, generateReceiptHtml } from "../services/pdf.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

export const getInvoiceReceipt = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { invoiceId } = req.params;

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new ApiError(404, "Facture introuvable");

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, invoice.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");

  // Sécurité locataire
  if (req.user.role === "TENANT" && contract.tenantId !== req.user.tenantId) {
    throw new ApiError(403, "Accès refusé");
  }

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  // Sécurité gestionnaire : la facture doit appartenir à l'un de ses biens
  // (sans ce contrôle, n'importe quel gestionnaire pouvait récupérer la
  // quittance d'une autre agence en devinant/récupérant l'ID de la facture).
  if (req.user.role === "MANAGER" && property?.managerId !== req.user.userId) {
    throw new ApiError(403, "Accès refusé");
  }

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

  if (req.user.role === "TENANT" && contract.tenantId !== req.user.tenantId) {
    throw new ApiError(403, "Accès refusé");
  }

  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));

  // Sécurité gestionnaire : le contrat doit appartenir à l'un de ses biens
  // (même faille que ci-dessus pour les quittances : sans ce contrôle,
  // n'importe quel gestionnaire pouvait récupérer le bail d'une autre agence).
  if (req.user.role === "MANAGER" && property?.managerId !== req.user.userId) {
    throw new ApiError(403, "Accès refusé");
  }

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
