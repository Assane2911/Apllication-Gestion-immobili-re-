import { SQL, and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import cron from "node-cron";
import { env } from "../config/env";
import { db } from "../db/client";
import { agencySettings, contracts, invoices, properties, tenants } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { contractEndingReminderEmail, rentDueReminderEmail, rentDueSoonReminderEmail, sendEmail } from "./email.service";
import { generateInvoicesForContract, markOverdueInvoices } from "./invoice.service";
import { rentDueSoonTemplateParams, rentDueTemplateParams, sendWhatsAppTemplate } from "./whatsapp.service";

/**
 * Envoie, en plus de l'email de rappel de loyer, un message WhatsApp (via
 * template pré-approuvé Meta) au locataire si l'agence a activé ce canal
 * (agencySettings). N'affecte jamais le statut d'envoi de la facture :
 * WhatsApp est un complément à l'email, jamais un remplacement, et un échec
 * de la Cloud API ne doit pas empêcher l'avis d'être considéré comme envoyé
 * (la réclamation `reminderSentAt` / `dueSoonReminderSentAt` a déjà eu lieu
 * avant l'appel à cette fonction).
 */
async function sendRentReminderWhatsApp(
  agency: typeof agencySettings.$inferSelect | null,
  phone: string,
  templateName: string,
  parameters: string[]
) {
  if (!agency?.whatsappRemindersEnabled) return;
  await sendWhatsAppTemplate(phone, templateName, parameters);
}

/** URL de la page de paiement du locataire, passée en dernier paramètre des deux templates WhatsApp. */
function paymentPortalUrl(): string {
  return `${env.frontendUrl}/portail/paiements`;
}

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

    // Réclamation atomique AVANT l'envoi (même principe que
    // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : la
    // requête SELECT ci-dessus charge un instantané des contrats sans
    // rappel envoyé, mais rien n'empêchait auparavant deux exécutions
    // concurrentes de ce job (chevauchement du cron si un envoi précédent
    // traîne, ou un futur déclenchement manuel) de charger le MÊME
    // instantané avant que l'une ou l'autre n'ait eu le temps d'écrire
    // `reminderSentAt` — chacune envoyait alors son propre email pour le
    // même contrat. Seule une des deux exécutions concurrentes peut
    // réclamer une ligne donnée ; l'autre la voit déjà marquée et passe.
    const [reclame] = await db
      .update(contracts)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(contracts.id, row.contract.id), isNull(contracts.reminderSentAt)))
      .returning();
    if (!reclame) continue;

    const { subject, html } = contractEndingReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      endDate: row.contract.endDate,
      daysLeft: daysBefore,
    });

    await sendEmail(managerEmail, subject, html);
    sent += 1;
  }

  if (sent > 0) {
    console.log(`[reminder] ${sent} rappel(s) de fin de contrat envoyé(s).`);
  }
  return sent;
}

/**
 * Envoie automatiquement un avis d'échéance / rappel de loyer aux locataires
 * le 1er de chaque mois pour leur rappeler de régler leur loyer au plus tard
 * le 5 du mois.
 *
 * `managerId` : quand fourni (déclenchement manuel par un gestionnaire depuis
 * son tableau de bord), restreint l'envoi aux seuls locataires de ce
 * gestionnaire. Laissé vide pour le job planifié (cron), qui couvre toute
 * la plateforme.
 */
export async function runRentDueReminders(managerId?: string) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 1. S'assure que les factures du mois en cours sont générées pour les contrats actifs
  //    (scopés au gestionnaire si managerId est fourni, sinon tous les contrats actifs de la plateforme)
  const activeContractsQuery = managerId
    ? db
        .select({ contract: contracts })
        .from(contracts)
        .innerJoin(properties, eq(contracts.propertyId, properties.id))
        .where(and(eq(contracts.status, "ACTIVE"), eq(properties.managerId, managerId)))
    : db.select({ contract: contracts }).from(contracts).where(eq(contracts.status, "ACTIVE"));

  const activeContractRows = await activeContractsQuery;
  for (const { contract } of activeContractRows) {
    await generateInvoicesForContract(contract);
  }

  // 2. Recherche toutes les factures impayées du mois courant pour les contrats actifs
  //    (scopées au gestionnaire appelant si managerId est fourni)
  //
  // isNull(reminderSentAt) est indispensable : sans lui, un second
  // déclenchement le même jour (cron + clic manuel du gestionnaire depuis
  // son tableau de bord, ou double invocation du cron) renvoyait l'avis à
  // TOUS les locataires impayés une deuxième fois — les deux autres rappels
  // de ce fichier (fin de contrat, avant échéance) vérifient déjà chacun
  // leur propre champ d'idempotence, celui-ci ne le faisait pas.
  const conditions: SQL[] = [
    eq(contracts.status, "ACTIVE"),
    eq(invoices.periodMonth, currentMonth),
    eq(invoices.periodYear, currentYear),
    or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE"))!,
    isNull(invoices.reminderSentAt),
  ];
  if (managerId) conditions.push(eq(properties.managerId, managerId));

  const rows = await db
    .select({
      invoice: invoices,
      contract: contracts,
      tenant: tenants,
      property: properties,
      agency: agencySettings,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .leftJoin(agencySettings, eq(properties.managerId, agencySettings.userId))
    .where(and(...conditions));

  let sent = 0;
  const details = [];

  for (const row of rows) {
    // Réclamation atomique AVANT l'envoi (même principe que
    // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : le
    // SELECT ci-dessus charge un instantané des factures sans rappel
    // envoyé, mais rien n'empêchait auparavant deux exécutions
    // concurrentes de cette fonction (le cron du 1er du mois ET un
    // gestionnaire cliquant "Envoyer les avis" depuis son tableau de bord
    // au même moment, ou une double invocation du cron) de charger le
    // MÊME instantané avant que l'une ou l'autre n'ait eu le temps
    // d'écrire `reminderSentAt` — chaque locataire impayé recevait alors
    // l'avis en double. Seule une des deux exécutions concurrentes peut
    // réclamer une ligne donnée ; l'autre la voit déjà marquée et passe.
    const [reclamee] = await db
      .update(invoices)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(invoices.id, row.invoice.id), isNull(invoices.reminderSentAt)))
      .returning();
    if (!reclamee) continue;

    const { subject, html } = rentDueReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      dueDate: new Date(row.invoice.dueDate),
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);

    await sendRentReminderWhatsApp(
      row.agency,
      row.tenant.phone,
      env.whatsapp.templateRentDue,
      rentDueTemplateParams({
        tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
        propertyTitle: row.property.title,
        amount: row.invoice.amount,
        currency: row.invoice.currency || "EUR",
        periodMonth: row.invoice.periodMonth,
        periodYear: row.invoice.periodYear,
        paymentUrl: paymentPortalUrl(),
      })
    );

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
  // Repasse d'abord en LATE les factures PENDING dont l'échéance est déjà
  // dépassée — sans cet appel (auparavant jamais déclenché nulle part),
  // une facture en retard ne changeait jamais de statut automatiquement et
  // le compteur d'impayés du tableau de bord sous-estimait la réalité.
  const overdueCount = await markOverdueInvoices();
  if (overdueCount > 0) {
    console.log(`[reminder] ${overdueCount} facture(s) passée(s) en retard (LATE).`);
  }

  const daysBefore = env.reminder.rentDueSoonDays;
  const now = new Date();
  const targetStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore, 0, 0, 0);
  const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore, 23, 59, 59);

  const rows = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties, agency: agencySettings })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .leftJoin(agencySettings, eq(properties.managerId, agencySettings.userId))
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
    // Réclamation atomique AVANT l'envoi — même course concurrentielle que
    // runRentDueReminders ci-dessus (chevauchement du cron quotidien si un
    // envoi précédent traîne encore).
    const [reclamee] = await db
      .update(invoices)
      .set({ dueSoonReminderSentAt: new Date() })
      .where(and(eq(invoices.id, row.invoice.id), isNull(invoices.dueSoonReminderSentAt)))
      .returning();
    if (!reclamee) continue;

    const dueDate = new Date(row.invoice.dueDate);
    const { subject, html } = rentDueSoonReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      daysLeft: daysBefore,
      dueDate,
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);

    await sendRentReminderWhatsApp(
      row.agency,
      row.tenant.phone,
      env.whatsapp.templateRentDueSoon,
      rentDueSoonTemplateParams({
        tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
        propertyTitle: row.property.title,
        amount: row.invoice.amount,
        currency: row.invoice.currency || "EUR",
        periodMonth: row.invoice.periodMonth,
        periodYear: row.invoice.periodYear,
        daysLeft: daysBefore,
        paymentUrl: paymentPortalUrl(),
      })
    );

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

// Fenêtre de réclamation pour l'envoi manuel d'un rappel individuel : assez
// courte pour ne bloquer qu'un double-clic ou une double requête quasi
// simultanée sur la MÊME facture, assez longue pour absorber la latence
// réelle d'un envoi SMTP. Passé ce délai, le gestionnaire peut renvoyer un
// rappel de suivi pour la même facture — contrairement à reminderSentAt
// posé par le job automatique du 1er du mois (isNull strict, permanent),
// cette réclamation-ci n'a pas vocation à empêcher un futur renvoi manuel,
// seulement les doublons d'une même action de clic. Même valeur que
// invoice.controller.ts::DUREE_RECLAMATION_MS pour le même type de garde.
const DUREE_RECLAMATION_RAPPEL_MS = 60_000;

/**
 * Envoie un rappel d'échéance pour une facture spécifique (déclenché manuellement par l'agence).
 * `managerId` : le gestionnaire à l'origine de l'appel — doit être le propriétaire
 * du bien concerné, sinon la facture est traitée comme introuvable.
 */
export async function sendSingleInvoiceReminder(invoiceId: string, managerId: string) {
  const [row] = await db
    .select({
      invoice: invoices,
      contract: contracts,
      tenant: tenants,
      property: properties,
      agency: agencySettings,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .leftJoin(agencySettings, eq(properties.managerId, agencySettings.userId))
    .where(eq(invoices.id, invoiceId));

  if (!row || row.property.managerId !== managerId) {
    throw new ApiError(404, "Facture introuvable");
  }

  // Réclamation atomique AVANT l'envoi (même principe que
  // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : sans
  // elle, un double-clic sur "Envoyer un rappel" (ou deux requêtes API
  // quasi simultanées) déclenchait deux envois pour la même facture, le
  // SELECT ci-dessus n'empêchant rien à lui seul.
  const seuilReclamationPerimee = new Date(Date.now() - DUREE_RECLAMATION_RAPPEL_MS);
  const [reclamee] = await db
    .update(invoices)
    .set({ reminderSentAt: new Date() })
    .where(
      and(
        eq(invoices.id, row.invoice.id),
        or(isNull(invoices.reminderSentAt), lt(invoices.reminderSentAt, seuilReclamationPerimee))
      )
    )
    .returning();

  if (!reclamee) {
    throw new ApiError(409, "Un rappel vient déjà d'être envoyé pour cette facture. Patientez un instant puis réessayez.");
  }

  const { subject, html } = rentDueReminderEmail({
    tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
    propertyTitle: row.property.title,
    amount: row.invoice.amount,
    currency: row.invoice.currency || "EUR",
    periodMonth: row.invoice.periodMonth,
    periodYear: row.invoice.periodYear,
    dueDate: new Date(row.invoice.dueDate),
    frontendUrl: env.frontendUrl,
  });

  const emailResult = await sendEmail(row.tenant.email, subject, html);

  await sendRentReminderWhatsApp(
    row.agency,
    row.tenant.phone,
    env.whatsapp.templateRentDue,
    rentDueTemplateParams({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      paymentUrl: paymentPortalUrl(),
    })
  );

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

