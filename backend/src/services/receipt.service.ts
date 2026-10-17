import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { agencySettings, contracts, invoicePayments, invoices, properties, tenants } from "../db/schema";
import { colocatairesActifs, envoyerCopieAuxColocataires, nomsDesLocataires } from "./colocation.service";
import { sendEmail } from "./email.service";
import { escapeHtml } from "../utils/html";
import { periodeCouverte } from "./invoice.service";
import { generateReceiptPdfBuffer, ReceiptData } from "./pdf.service";
import { chargerLogoAgence } from "./storage.service";
import { formaterMontant } from "../utils/montant";
import { libelleMoyenPaiement } from "../utils/moyenPaiement";
import { montantRegle, resteDu } from "../utils/montants";
import { nomAvecCivilite } from "../utils/nom";

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

    const [agency] = property?.managerId
      ? await db.select().from(agencySettings).where(eq(agencySettings.userId, property.managerId))
      : [];

    const periode = periodeCouverte(contract, invoice.periodMonth, invoice.periodYear);

    const receiptData: ReceiptData = {
      receiptNumber: `QUITT-${invoice.periodYear}-${String(invoice.periodMonth).padStart(2, "0")}-${invoice.id
        .slice(-6)
        .toUpperCase()}`,
      agency: {
        name: agency?.agencyName || "Agence Immobilière",
        logoUrl: agency?.logoUrl,
        logoBuffer: await chargerLogoAgence(agency?.logoUrl),
        address: agency?.address,
        phone: agency?.phone,
        email: agency?.email,
        siretOrId: agency?.siretOrId,
        legalNotice: agency?.legalNotice,
      },
      tenant: {
        // En colocation, la quittance nomme tous les locataires du bail.
        fullName: nomsDesLocataires([tenant, ...(await colocatairesActifs(contract.id))]),
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
        // Période réellement couverte : une facture au prorata (entrée ou
        // sortie en cours de mois) ne doit pas donner une quittance annonçant
        // un mois entier.
        periodStartDay: periode.premierJour || null,
        periodEndDay: periode.dernierJour || null,
        amount: invoice.amount,
        currency: invoice.currency || "EUR",
        paidAt: invoice.paidAt || new Date(),
        paymentMethod: invoice.paymentMethod,
        paymentRef: invoice.paymentRef,
      },
    };

    const pdfBuffer = await generateReceiptPdfBuffer(receiptData);
    const monthLabel = monthNames[invoice.periodMonth - 1] || `${invoice.periodMonth}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">✅ Paiement de loyer confirmé</h2>
        <p>Bonjour ${escapeHtml(receiptData.tenant.fullName)},</p>
        <p>
          Nous confirmons la bonne réception de votre paiement de loyer pour
          <strong>${monthLabel} ${invoice.periodYear}</strong> concernant le logement
          <strong>${receiptData.property.title}</strong>, d'un montant de
          <strong>${formaterMontant(invoice.amount, receiptData.invoice.currency)}</strong>.
        </p>
        <p>Votre quittance de loyer est jointe à cet email au format PDF.</p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `;

    const pieceJointe = [
      {
        filename: `quittance-${receiptData.receiptNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];
    const sujet = `Quittance de loyer — ${monthLabel} ${invoice.periodYear}`;
    const result = await sendEmail(tenant.email, sujet, html, pieceJointe);
    // Chaque colocataire reçoit la même quittance (elle les nomme tous).
    await envoyerCopieAuxColocataires(contract.id, () => ({ subject: sujet, html, attachments: pieceJointe }));

    return { sent: !result.simulated && !("error" in result && result.error), ...result };
  } catch (err) {
    console.error(`[receipt] Échec de la génération/envoi de la quittance pour la facture ${invoiceId}:`, err);
    return { sent: false, reason: "error" as const };
  }
}

/**
 * Envoie au locataire le REÇU d'un paiement partiel : ce qui vient d'être
 * encaissé, ce qui a déjà été réglé, ce qui reste dû.
 *
 * Un reçu n'est pas une quittance. La quittance atteste le paiement INTÉGRAL du
 * loyer et n'est délivrée qu'une fois la facture soldée (voir
 * sendPaymentReceiptEmail) ; le message le dit pour que le locataire ne prenne
 * pas ce reçu pour une quittance. Même contrat que la quittance : n'échoue
 * jamais bruyamment, une erreur d'envoi est journalisée et renvoyée.
 */
export async function sendPartialPaymentReceiptEmail(invoiceId: string, paymentId: string) {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) return { sent: false, reason: "invoice_not_found" as const };
    if (invoice.status === "PAID" || invoice.status === "CANCELLED") {
      return { sent: false, reason: "invoice_not_partial" as const };
    }
    const [paiement] = await db.select().from(invoicePayments).where(eq(invoicePayments.id, paymentId));
    if (!paiement || paiement.invoiceId !== invoice.id) return { sent: false, reason: "payment_not_found" as const };

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, invoice.contractId));
    if (!contract) return { sent: false, reason: "contract_not_found" as const };
    const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
    if (!tenant?.email) return { sent: false, reason: "no_tenant_email" as const };

    const [agency] = property?.managerId
      ? await db.select().from(agencySettings).where(eq(agencySettings.userId, property.managerId))
      : [];

    const devise = invoice.currency || "EUR";
    const monthLabel = monthNames[invoice.periodMonth - 1] || `${invoice.periodMonth}`;
    const dateReception = new Date(paiement.paidAt).toLocaleDateString("fr-FR");

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">Reçu de paiement partiel</h2>
        <p>Bonjour ${escapeHtml(nomAvecCivilite(tenant))},</p>
        <p>
          Nous avons bien reçu un paiement de
          <strong>${formaterMontant(paiement.amount, devise)}</strong> le ${dateReception}
          (${libelleMoyenPaiement(paiement.paymentMethod)}) au titre du loyer de
          <strong>${monthLabel} ${invoice.periodYear}</strong>, logement
          <strong>${property?.title || "Logement"}</strong>.
        </p>
        <table style="border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:4px 16px 4px 0; color:#334155;">Loyer</td><td style="text-align:right;">${formaterMontant(invoice.amount, devise)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0; color:#334155;">Déjà réglé</td><td style="text-align:right;">${formaterMontant(montantRegle(invoice), devise)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;"><strong>Reste à payer</strong></td><td style="text-align:right;"><strong>${formaterMontant(resteDu(invoice), devise)}</strong></td></tr>
        </table>
        <p style="color:#475569; font-size:13px;">
          Ce document est un <strong>reçu de paiement partiel</strong>, et non une quittance de loyer :
          la quittance vous sera délivrée lorsque le loyer sera intégralement réglé.
        </p>
        <p style="margin-top:24px; color:#6b7280; font-size:12px;">
          ${agency?.agencyName ? `${agency.agencyName} — ` : ""}Cet email a été envoyé automatiquement par votre application de gestion immobilière.
        </p>
      </div>
    `;

    const sujet = `Reçu de paiement partiel — loyer ${monthLabel} ${invoice.periodYear}`;
    const result = await sendEmail(tenant.email, sujet, html);
    await envoyerCopieAuxColocataires(contract.id, (colocataire) => ({
      subject: sujet,
      html: html.replace(`Bonjour ${escapeHtml(nomAvecCivilite(tenant))},`, `Bonjour ${escapeHtml(nomAvecCivilite(colocataire))},`),
    }));
    return { sent: !result.simulated && !("error" in result && result.error), ...result };
  } catch (err) {
    console.error(`[receipt] Échec de l'envoi du reçu de paiement partiel pour la facture ${invoiceId}:`, err);
    return { sent: false, reason: "error" as const };
  }
}
