import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { agencySettings, contracts, invoices, properties, tenants } from "../db/schema";
import { sendEmail } from "./email.service";
import { generateReceiptPdfBuffer, ReceiptData } from "./pdf.service";

const monthNames = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/**
 * Envoie automatiquement la quittance de loyer (PDF en pièce jointe) au
 * locataire concerné, dès qu'une facture passe au statut PAID — que ce soit
 * via un paiement en ligne (portail locataire) ou un marquage manuel par le
 * gestionnaire. N'échoue jamais bruyamment : une erreur d'envoi (SMTP non
 * configuré, locataire sans email, etc.) est journalisée et renvoyée dans le
 * résultat plutôt que de faire échouer le paiement lui-même.
 */
export async function sendPaymentReceiptEmail(invoiceId: string) {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) return { sent: false, reason: "invoice_not_found" as const };
    if (invoice.status !== "PAID") return { sent: false, reason: "invoice_not_paid" as const };

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, invoice.contractId));
    if (!contract) return { sent: false, reason: "contract_not_found" as const };

    const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
    if (!tenant?.email) return { sent: false, reason: "no_tenant_email" as const };

    const [agency] = await db.select().from(agencySettings);

    const receiptData: ReceiptData = {
      receiptNumber: `QUITT-${invoice.periodYear}-${String(invoice.periodMonth).padStart(2, "0")}-${invoice.id
        .slice(-6)
        .toUpperCase()}`,
      agency: {
        name: agency?.agencyName || "Agence Immobilière",
        logoUrl: agency?.logoUrl,
        address: agency?.address,
        phone: agency?.phone,
        email: agency?.email,
        siretOrId: agency?.siretOrId,
        legalNotice: agency?.legalNotice,
      },
      tenant: {
        fullName: `${tenant.firstName} ${tenant.lastName}`,
        email: tenant.email,
        phone: tenant.phone,
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
        paidAt: invoice.paidAt || new Date(),
        paymentMethod: invoice.paymentMethod || "DEMO",
        paymentRef: invoice.paymentRef,
      },
    };

    const pdfBuffer = await generateReceiptPdfBuffer(receiptData);
    const monthLabel = monthNames[invoice.periodMonth - 1] || `${invoice.periodMonth}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">✅ Paiement de loyer confirmé</h2>
        <p>Bonjour ${receiptData.tenant.fullName},</p>
        <p>
          Nous confirmons la bonne réception de votre paiement de loyer pour
          <strong>${monthLabel} ${invoice.periodYear}</strong> concernant le logement
          <strong>${receiptData.property.title}</strong>, d'un montant de
          <strong>${invoice.amount} ${receiptData.invoice.currency}</strong>.
        </p>
        <p>Votre quittance de loyer est jointe à cet email au format PDF.</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `;

    const result = await sendEmail(
      tenant.email,
      `Quittance de loyer — ${monthLabel} ${invoice.periodYear}`,
      html,
      [
        {
          filename: `quittance-${receiptData.receiptNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ]
    );

    return { sent: !result.simulated && !("error" in result && result.error), ...result };
  } catch (err) {
    console.error(`[receipt] Échec de la génération/envoi de la quittance pour la facture ${invoiceId}:`, err);
    return { sent: false, reason: "error" as const };
  }
}
