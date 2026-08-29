import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import cron from "node-cron";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { contractEndingReminderEmail, rentDueReminderEmail, rentDueSoonReminderEmail, sendEmail } from "./email.service";
import { generateInvoicesForContract } from "./invoice.service";

/**
 * Recherche les contrats ACTIFS dont la date de fin tombe exactement dans
 * `daysBefore` jours et qui n'ont pas encore reçu de rappel, puis envoie un
 * email au gestionnaire (SMTP_USER) et marque `reminderSentAt` pour éviter
 * les envois en double.
 */
export async function runContractEndingReminders() {
  const daysBefore = env.reminder.daysBefore;

  const now = new Date();
  const targetStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore, 0, 0, 0);
  const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore, 23, 59, 59);

  const rows = await db
    .select({
      contract: contracts,
      tenant: tenants,
      property: properties,
    })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(
        eq(contracts.status, "ACTIVE"),
        isNull(contracts.reminderSentAt),
        gte(contracts.endDate, targetStart),
        lte(contracts.endDate, targetEnd)
      )
    );

  let sent = 0;
  for (const row of rows) {
    const managerEmail = env.smtp.user;
    if (!managerEmail) {
      console.warn("[reminder] SMTP_USER non configuré, rappel non envoyé pour le contrat", row.contract.id);
      continue;
    }

    const { subject, html } = contractEndingReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      endDate: row.contract.endDate,
      daysLeft: daysBefore,
    });

    await sendEmail(managerEmail, subject, html);
    await db.update(contracts).set({ reminderSentAt: new Date() }).where(eq(contracts.id, row.contract.id));
    sent += 1;
  }

  if (sent > 0) {
    console.log(`[reminder] ${sent} rappel(s) de fin de contrat envoyé(s).`);
  }
  return sent;
}

/**
 * Envoie automatiquement un avis d'échéance / rappel de loyer à tous les
 * locataires le 1er de chaque mois pour leur rappeler de régler leur loyer
 * au plus tard le 5 du mois.
 */
export async function runRentDueReminders() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 1. S'assure que les factures du mois en cours sont générées pour tous les contrats actifs
  const activeContracts = await db.select().from(contracts).where(eq(contracts.status, "ACTIVE"));
  for (const c of activeContracts) {
    await generateInvoicesForContract(c);
  }

  // 2. Recherche toutes les factures impayées du mois courant pour les contrats actifs
  const rows = await db
    .select({
      invoice: invoices,
      contract: contracts,
      tenant: tenants,
      property: properties,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(
        eq(contracts.status, "ACTIVE"),
        eq(invoices.periodMonth, currentMonth),
        eq(invoices.periodYear, currentYear),
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE"))
      )
    );

  let sent = 0;
  const details = [];

  for (const row of rows) {
    const { subject, html } = rentDueReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      dueDate: new Date(row.invoice.dueDate),
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);
    await db
      .update(invoices)
      .set({ reminderSentAt: new Date() })
      .where(eq(invoices.id, row.invoice.id));

    sent += 1;
    details.push({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
    });
  }

  console.log(`[reminder] 📢 ${sent} avis d'échéance du 1er du mois envoyé(s) aux locataires (échéance au plus tard le 5).`);
  return { sent, details };
}

/**
 * Envoie un rappel complémentaire quelques jours AVANT la date d'échéance
 * (`env.reminder.rentDueSoonDays`, 3 jours par défaut) pour toute facture
 * encore impayée (PENDING ou LATE) — en plus de l'avis du 1er du mois.
 * Idempotent via `dueSoonReminderSentAt` (distinct de `reminderSentAt`).
 */
export async function runUpcomingRentDueReminders() {
  const daysBefore = env.reminder.rentDueSoonDays;
  const now = new Date();
  const targetStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore, 0, 0, 0);
  const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore, 23, 59, 59);

  const rows = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(
        eq(contracts.status, "ACTIVE"),
        isNull(invoices.dueSoonReminderSentAt),
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE")),
        gte(invoices.dueDate, targetStart),
        lte(invoices.dueDate, targetEnd)
      )
    );

  let sent = 0;
  const details = [];

  for (const row of rows) {
    const { subject, html } = rentDueSoonReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      daysLeft: daysBefore,
      dueDate: new Date(row.invoice.dueDate),
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);
    await db
      .update(invoices)
      .set({ dueSoonReminderSentAt: new Date() })
      .where(eq(invoices.id, row.invoice.id));

    sent += 1;
    details.push({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
    });
  }

  if (sent > 0) {
    console.log(`[reminder] ⏰ ${sent} rappel(s) "avant échéance" (J-${daysBefore}) envoyé(s) aux locataires.`);
  }
  return { sent, details };
}

/**
 * Envoie un rappel d'échéance pour une facture spécifique (déclenché manuellement par l'agence).
 */
export async function sendSingleInvoiceReminder(invoiceId: string) {
  const [row] = await db
    .select({
      invoice: invoices,
      contract: contracts,
      tenant: tenants,
      property: properties,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(invoices.id, invoiceId));

  if (!row) {
    throw new Error("Facture introuvable");
  }

  const { subject, html } = rentDueReminderEmail({
    tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
    propertyTitle: row.property.title,
    amount: row.invoice.amount,
    periodMonth: row.invoice.periodMonth,
    periodYear: row.invoice.periodYear,
    dueDate: new Date(row.invoice.dueDate),
    frontendUrl: env.frontendUrl,
  });

  const emailResult = await sendEmail(row.tenant.email, subject, html);
  await db
    .update(invoices)
    .set({ reminderSentAt: new Date() })
    .where(eq(invoices.id, row.invoice.id));

  return {
    success: true,
    tenantEmail: row.tenant.email,
    tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
    simulated: emailResult.simulated,
  };
}

export function scheduleContractEndingReminders() {
  console.log(`[reminder] Job fin de contrat planifié avec "${env.reminder.cron}"`);
  cron.schedule(env.reminder.cron, () => {
    runContractEndingReminders().catch((err) => console.error("[reminder] erreur fin contrat:", err));
  });

  // Tâche planifiée automatique : le 1er de chaque mois à 8h00 du matin
  const rentDueCron = "0 8 1 * *";
  console.log(`[reminder] 📢 Job avis d'échéance du 1er du mois (date limite le 5) planifié avec "${rentDueCron}"`);
  cron.schedule(rentDueCron, () => {
    runRentDueReminders().catch((err) => console.error("[reminder] erreur avis loyer du 1er:", err));
  });

  // Tâche planifiée automatique : tous les jours à 9h00, rappel complémentaire
  // quelques jours avant l'échéance pour les factures encore impayées.
  const rentDueSoonCron = "0 9 * * *";
  console.log(`[reminder] ⏰ Job rappel "avant échéance" planifié avec "${rentDueSoonCron}"`);
  cron.schedule(rentDueSoonCron, () => {
    runUpcomingRentDueReminders().catch((err) => console.error("[reminder] erreur rappel avant échéance:", err));
  });
}

