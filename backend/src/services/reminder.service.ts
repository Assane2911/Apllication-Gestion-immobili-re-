import { and, eq, gte, isNull, lte } from "drizzle-orm";
import cron from "node-cron";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, properties, tenants } from "../db/schema";
import { contractEndingReminderEmail, sendEmail } from "./email.service";

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

export function scheduleContractEndingReminders() {
  console.log(`[reminder] Job planifié avec l'expression cron "${env.reminder.cron}"`);
  cron.schedule(env.reminder.cron, () => {
    runContractEndingReminders().catch((err) => console.error("[reminder] erreur:", err));
  });
}
