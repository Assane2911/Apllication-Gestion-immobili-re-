import { and, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { agencySettings, contractGuarantors, contracts, invoices, properties, tenants } from "../db/schema";
import { BudgetTemps, SANS_LIMITE } from "../utils/budgetTemps";
import { debutDeLaJournee, joursEntre } from "../utils/dates";
import { formaterMontant } from "../utils/montant";
import { resteDu } from "../utils/montants";
import { nomAvecCivilite, nomComplet } from "../utils/nom";
import { logActivity } from "./activity.service";
import { envoyerCopieAuxColocataires } from "./colocation.service";
import { guarantorUnpaidNoticeEmail, overdueReminderEmail, sendEmail } from "./email.service";

/**
 * Relances graduées des loyers impayés.
 *
 * Trois niveaux : rappel amiable à la fin du délai de grâce, deuxième relance un intervalle plus
 * tard, dernière relance encore un intervalle plus tard (copie aux garants si l'agence le veut).
 * Désactivées par défaut : l'agence les active dans ses réglages.
 *
 * Un impayé ancien ne reçoit pas toutes les relances d'un coup : seul le niveau atteint est envoyé.
 * Au-delà de RETARD_MAXIMAL_JOURS, plus rien n'est automatique : un impayé de trois mois relève du
 * gestionnaire, pas d'un email de plus. Chaque niveau est réclamé par un UPDATE conditionnel avant
 * l'envoi (deux exécutions simultanées n'envoient qu'une fois) et relâché si l'email échoue.
 */
export const NIVEAU_MAXIMAL = 3 as const;
export const RETARD_MAXIMAL_JOURS = 90;

/** Niveau de relance attendu pour un retard donné (0 : rien à envoyer). */
export function niveauAttendu(joursDeRetard: number, grace: number, intervalle: number): 0 | 1 | 2 | 3 {
  if (joursDeRetard < Math.max(1, grace)) return 0;
  const niveau = 1 + Math.floor((joursDeRetard - Math.max(1, grace)) / Math.max(1, intervalle));
  return Math.min(niveau, NIVEAU_MAXIMAL) as 1 | 2 | 3;
}

export async function runOverdueReminders(budget: BudgetTemps = SANS_LIMITE, maintenant: Date = new Date()) {
  const reglages = await db.select().from(agencySettings).where(eq(agencySettings.overdueRemindersEnabled, true));
  if (reglages.length === 0) return { sent: 0, echecs: 0, interrompu: false };
  const parGestionnaire = new Map(reglages.map((r: typeof agencySettings.$inferSelect) => [r.userId, r]));

  const aujourdhui = debutDeLaJournee(maintenant);
  const plusAncienne = new Date(aujourdhui.getTime() - RETARD_MAXIMAL_JOURS * 86_400_000);
  const lignes = await db
    .select({ invoice: invoices, contract: contracts, property: properties, tenant: tenants })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(
      and(
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE")),
        lt(invoices.dueDate, aujourdhui),
        gte(invoices.dueDate, plusAncienne),
        lt(invoices.overdueReminderLevel, NIVEAU_MAXIMAL),
        isNull(tenants.anonymizedAt),
        inArray(properties.managerId, [...parGestionnaire.keys()])
      )
    );

  let sent = 0;
  let echecs = 0;
  let interrompu = false;
  for (const ligne of lignes) {
    if (budget.epuise()) {
      interrompu = true;
      break;
    }
    const reglage = parGestionnaire.get(ligne.property.managerId)!;
    const reste = resteDu(ligne.invoice);
    if (reste <= 0) continue;
    const joursDeRetard = joursEntre(new Date(ligne.invoice.dueDate), aujourdhui);
    const niveau = niveauAttendu(joursDeRetard, reglage.overdueGraceDays, reglage.overdueIntervalDays);
    const precedent = ligne.invoice.overdueReminderLevel;
    if (niveau === 0 || niveau <= precedent) continue;

    const [reclamee] = await db
      .update(invoices)
      .set({ overdueReminderLevel: niveau, overdueReminderSentAt: maintenant })
      .where(and(eq(invoices.id, ligne.invoice.id), lt(invoices.overdueReminderLevel, niveau)))
      .returning();
    if (!reclamee) continue;

    const parametres = {
      propertyTitle: ligne.property.title,
      amount: reste,
      currency: ligne.invoice.currency || "EUR",
      periodMonth: ligne.invoice.periodMonth,
      periodYear: ligne.invoice.periodYear,
      dueDate: new Date(ligne.invoice.dueDate),
      daysLate: joursDeRetard,
      niveau,
      agencyName: reglage.agencyName,
    };
    const { subject, html } = overdueReminderEmail({ ...parametres, tenantName: nomAvecCivilite(ligne.tenant) });
    const resultat = await sendEmail(ligne.tenant.email, subject, html);
    if ("error" in resultat && resultat.error) {
      // Relâché : la relance repartira à la prochaine exécution plutôt que d'être perdue.
      await db.update(invoices).set({ overdueReminderLevel: precedent, overdueReminderSentAt: ligne.invoice.overdueReminderSentAt }).where(eq(invoices.id, ligne.invoice.id));
      echecs++;
      continue;
    }
    sent++;

    await envoyerCopieAuxColocataires(ligne.contract.id, (colocataire) => overdueReminderEmail({ ...parametres, tenantName: nomAvecCivilite(colocataire) }));

    let garantsPrevenus = 0;
    if (niveau === NIVEAU_MAXIMAL && reglage.overdueNotifyGuarantors) {
      const garants = await db.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, ligne.contract.id));
      for (const garant of garants) {
        if (!garant.email) continue;
        try {
          const avis = guarantorUnpaidNoticeEmail({ ...parametres, guarantorName: nomAvecCivilite(garant), tenantName: nomComplet(ligne.tenant) });
          await sendEmail(garant.email, avis.subject, avis.html);
          garantsPrevenus++;
        } catch (err) {
          console.error(`[relances] Avis au garant ${garant.id} non envoyé :`, err);
        }
      }
    }

    await logActivity({
      managerId: ligne.property.managerId,
      action: "invoice.overdue_reminder",
      entityType: "invoice",
      entityId: ligne.invoice.id,
      entityLabel: `${nomComplet(ligne.tenant)} — ${ligne.property.title}`,
      details:
        `Relance ${niveau}/${NIVEAU_MAXIMAL} envoyée (loyer ${String(ligne.invoice.periodMonth).padStart(2, "0")}/${ligne.invoice.periodYear}, ` +
        `${formaterMontant(reste, parametres.currency)} restant dû, ${joursDeRetard} jour(s) de retard)` +
        (garantsPrevenus > 0 ? ` ; ${garantsPrevenus} garant(s) prévenu(s).` : "."),
    });
  }

  if (sent > 0) console.log(`[relances] ${sent} relance(s) d'impayé envoyée(s).`);
  return { sent, echecs, interrompu };
}
