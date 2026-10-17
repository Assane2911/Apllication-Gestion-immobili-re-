import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, Transaction } from "../db/client";
import { agencySettings, contractGuarantors, contracts, formalNotices, invoices, properties, tenants } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { debutDeLaJournee, joursEntre } from "../utils/dates";
import { arrondir, resteDu } from "../utils/montants";
import { nomAvecCivilite, nomComplet } from "../utils/nom";
import { colocatairesActifs, envoyerCopieAuxColocataires, nomsDesLocataires } from "./colocation.service";
import { formalNoticeEmail, guarantorFormalNoticeEmail, sendEmail } from "./email.service";
import { generateFormalNoticePdfBuffer } from "./pdf.service";
import { NIVEAU_MAXIMAL } from "./relances.service";

/**
 * Mise en demeure de payer : le courrier qui suit la dernière relance.
 *
 * Il est préparé automatiquement (factures impayées, montant, délai) mais c'est le gestionnaire qui
 * l'émet : il a une portée juridique, et le gestionnaire peut savoir ce que l'application ignore
 * (un échéancier accordé, un paiement en cours). Le courrier émis fige les factures et le montant
 * réclamés ; il se télécharge pour un envoi recommandé et peut partir par email au locataire, aux
 * colocataires et, au choix, aux garants.
 */

/** Délai de paiement proposé par défaut, en jours à compter de la réception. */
export const DELAI_PAR_DEFAUT_JOURS = 8;
/**
 * Fenêtre pendant laquelle une mise en demeure IDENTIQUE (mêmes factures, mêmes restes dus) à la
 * précédente est refusée : un double envoi accidentel (appel rejoué, double requête) ne doit pas
 * écrire deux fois au locataire. Passé ce délai, ou dès qu'une facture ou un reste dû change, une
 * nouvelle mise en demeure peut être émise.
 */
export const FENETRE_DOUBLON_HEURES = 24;
/** Retard au-delà duquel un impayé appelle une mise en demeure quand les relances sont désactivées. */
export const SEUIL_SANS_RELANCES_JOURS = 30;

export interface FactureReclamee {
  invoiceId: string;
  periodMonth: number;
  periodYear: number;
  dueDate: string;
  amount: number;
  resteDu: number;
}

type Facture = typeof invoices.$inferSelect;
type Reglages = Pick<
  typeof agencySettings.$inferSelect,
  "overdueRemindersEnabled" | "overdueGraceDays" | "overdueIntervalDays"
>;

/** Factures du bail échues et non soldées, de la plus ancienne à la plus récente. */
export async function impayesDuBail(contractId: string, maintenant: Date = new Date()): Promise<Facture[]> {
  const lignes = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.contractId, contractId),
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE")),
        lt(invoices.dueDate, debutDeLaJournee(maintenant))
      )
    );
  return lignes
    .filter((f: Facture) => resteDu(f) > 0)
    .sort((a: Facture, b: Facture) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

/**
 * Une facture impayée appelle-t-elle une mise en demeure ?
 *
 *  - relances activées : un intervalle après la dernière relance (ou, si le cycle des relances
 *    n'a pas tourné pour elle, le retard équivalent : délai de grâce + trois intervalles) ;
 *  - relances désactivées : après SEUIL_SANS_RELANCES_JOURS de retard.
 */
export function factureMure(facture: Facture, reglages: Reglages | undefined, maintenant: Date = new Date()): boolean {
  const aujourdhui = debutDeLaJournee(maintenant);
  const retard = joursEntre(new Date(facture.dueDate), aujourdhui);
  if (!reglages?.overdueRemindersEnabled) return retard >= SEUIL_SANS_RELANCES_JOURS;

  const intervalle = Math.max(1, reglages.overdueIntervalDays);
  const seuil = Math.max(1, reglages.overdueGraceDays) + NIVEAU_MAXIMAL * intervalle;
  if (retard >= seuil) return true;
  return (
    facture.overdueReminderLevel >= NIVEAU_MAXIMAL &&
    !!facture.overdueReminderSentAt &&
    joursEntre(new Date(facture.overdueReminderSentAt), aujourdhui) >= intervalle
  );
}

/** Identifiants des factures déjà réclamées par une mise en demeure de ces baux. */
async function facturesDejaReclamees(contractIds: string[]): Promise<Set<string>> {
  if (contractIds.length === 0) return new Set();
  const notices = await db
    .select({ invoicesSnapshot: formalNotices.invoicesSnapshot })
    .from(formalNotices)
    .where(inArray(formalNotices.contractId, contractIds));
  const ids = new Set<string>();
  for (const n of notices) {
    for (const f of lireFactures(n.invoicesSnapshot)) ids.add(f.invoiceId);
  }
  return ids;
}

export function lireFactures(snapshot: string): FactureReclamee[] {
  try {
    const valeur = JSON.parse(snapshot);
    return Array.isArray(valeur) ? (valeur as FactureReclamee[]) : [];
  } catch {
    return [];
  }
}

/**
 * Baux du gestionnaire dont au moins une facture impayée est mûre pour une mise en demeure et
 * n'a encore été réclamée par aucune. Les locataires anonymisés en sont exclus.
 */
export async function bauxAMettreEnDemeure(managerId: string, maintenant: Date = new Date()) {
  const [reglages] = await db.select().from(agencySettings).where(eq(agencySettings.userId, managerId));
  const lignes = await db
    .select({ invoice: invoices, contract: contracts, property: properties, tenant: tenants })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(
      and(
        eq(properties.managerId, managerId),
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE")),
        lt(invoices.dueDate, debutDeLaJournee(maintenant)),
        isNull(tenants.anonymizedAt)
      )
    );

  const dejaReclamees = await facturesDejaReclamees([...new Set(lignes.map((l: (typeof lignes)[number]) => l.contract.id))]);
  const parBail = new Map<
    string,
    { ligne: (typeof lignes)[number]; impayes: Facture[]; mures: number; dejaReclamees: number }
  >();
  for (const ligne of lignes) {
    if (resteDu(ligne.invoice) <= 0) continue;
    const entree = parBail.get(ligne.contract.id) ?? { ligne, impayes: [], mures: 0, dejaReclamees: 0 };
    entree.impayes.push(ligne.invoice);
    if (dejaReclamees.has(ligne.invoice.id)) entree.dejaReclamees++;
    else if (factureMure(ligne.invoice, reglages, maintenant)) entree.mures++;
    parBail.set(ligne.contract.id, entree);
  }

  const resultat = [];
  for (const [contractId, { ligne, impayes, mures, dejaReclamees: reclamees }] of parBail) {
    if (mures === 0) continue;
    const plusAncienne = impayes.reduce((a, b) => (new Date(a.dueDate) < new Date(b.dueDate) ? a : b));
    resultat.push({
      contractId,
      propertyTitle: ligne.property.title,
      tenantName: nomComplet(ligne.tenant),
      currency: ligne.contract.currency,
      unpaidCount: impayes.length,
      alreadyClaimedCount: reclamees,
      totalDue: arrondir(impayes.reduce((s, f) => s + resteDu(f), 0)),
      oldestDueDate: plusAncienne.dueDate,
      daysLate: joursEntre(new Date(plusAncienne.dueDate), debutDeLaJournee(maintenant)),
    });
  }
  return resultat.sort((a, b) => b.daysLate - a.daysLate);
}

/** Les mises en demeure d'un bail, de la plus récente à la plus ancienne. */
export async function listerMisesEnDemeure(contractId: string) {
  const notices = await db
    .select()
    .from(formalNotices)
    .where(eq(formalNotices.contractId, contractId))
    .orderBy(desc(formalNotices.createdAt));
  return notices.map((n: typeof formalNotices.$inferSelect) => ({ ...n, invoices: lireFactures(n.invoicesSnapshot) }));
}

/** Référence lisible : MED-AAAA-xxxxxx (fin de l'identifiant). */
export function referenceMiseEnDemeure(notice: { id: string; createdAt: Date }): string {
  return `MED-${new Date(notice.createdAt).getFullYear()}-${notice.id.slice(-6).toUpperCase()}`;
}

/** Tout ce qu'il faut pour rendre le courrier (HTML à l'écran, PDF joint à l'email). */
export async function donneesDuCourrier(notice: typeof formalNotices.$inferSelect) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, notice.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");
  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
  const [agency] = await db.select().from(agencySettings).where(eq(agencySettings.userId, notice.managerId));
  const garants = await db.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contract.id));
  return {
    reference: referenceMiseEnDemeure(notice),
    createdAt: notice.createdAt,
    deadlineDays: notice.deadlineDays,
    currency: notice.currency,
    totalDue: notice.totalDue,
    factures: lireFactures(notice.invoicesSnapshot),
    destinataires: tenant ? nomsDesLocataires([tenant, ...(await colocatairesActifs(contract.id))]) : "",
    adresse: property?.address ?? "",
    propertyTitle: property?.title ?? "",
    contractStartDate: contract.startDate,
    applicableLaw: contract.applicableLaw,
    garants: garants.map((g: typeof contractGuarantors.$inferSelect) => nomComplet(g)),
    agency: {
      name: agency?.agencyName || "Agence Immobilière",
      address: agency?.address ?? null,
      phone: agency?.phone ?? null,
      email: agency?.email ?? null,
      siretOrId: agency?.siretOrId ?? null,
    },
  };
}

export type DonneesCourrier = Awaited<ReturnType<typeof donneesDuCourrier>>;

/**
 * Émet la mise en demeure d'un bail : fige les factures échues non soldées et le montant dû, puis,
 * si demandé, l'envoie par email (PDF joint) au locataire et aux colocataires, et aux garants.
 */
export async function emettreMiseEnDemeure(params: {
  contractId: string;
  managerId: string;
  deadlineDays: number;
  envoyerParEmail: boolean;
  prevenirGarants: boolean;
  createdBy: string;
  maintenant?: Date;
}) {
  const maintenant = params.maintenant ?? new Date();
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, params.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
  if (!tenant || tenant.anonymizedAt) throw new ApiError(409, "Le locataire de ce bail a été anonymisé : aucun courrier ne peut lui être adressé.");

  const impayes = await impayesDuBail(contract.id, maintenant);
  if (impayes.length === 0) throw new ApiError(409, "Ce bail n'a aucun loyer échu impayé : il n'y a rien à réclamer.");

  const factures: FactureReclamee[] = impayes.map((f) => ({
    invoiceId: f.id,
    periodMonth: f.periodMonth,
    periodYear: f.periodYear,
    dueDate: new Date(f.dueDate).toISOString(),
    amount: f.amount,
    resteDu: resteDu(f),
  }));
  // Verrou sur le bail, puis comparaison avec la dernière mise en demeure, DANS la même transaction :
  // deux requêtes simultanées calculent le même contenu ; la seconde attend, voit la première et
  // se voit refuser.
  const signature = (liste: FactureReclamee[]) =>
    liste
      .map((f) => `${f.invoiceId}:${f.resteDu}`)
      .sort()
      .join("|");
  const notice = await db.transaction(async (tx: Transaction) => {
    await tx.execute(sql`SELECT id FROM contracts WHERE id = ${contract.id} FOR UPDATE`);
    const [derniere] = await tx
      .select()
      .from(formalNotices)
      .where(
        and(
          eq(formalNotices.contractId, contract.id),
          gte(formalNotices.createdAt, new Date(maintenant.getTime() - FENETRE_DOUBLON_HEURES * 3_600_000))
        )
      )
      .orderBy(desc(formalNotices.createdAt))
      .limit(1);
    if (derniere && signature(lireFactures(derniere.invoicesSnapshot)) === signature(factures)) {
      throw new ApiError(
        409,
        `Une mise en demeure identique (réf. ${referenceMiseEnDemeure(derniere)}) a déjà été émise le ` +
          `${new Date(derniere.createdAt).toLocaleDateString("fr-FR")} : rien de nouveau à réclamer depuis.`
      );
    }
    const [creee] = await tx
      .insert(formalNotices)
      .values({
        contractId: contract.id,
        managerId: params.managerId,
        invoicesSnapshot: JSON.stringify(factures),
        totalDue: arrondir(factures.reduce((s, f) => s + f.resteDu, 0)),
        currency: contract.currency,
        deadlineDays: params.deadlineDays,
        createdBy: params.createdBy,
        createdAt: maintenant,
      })
      .returning();
    return creee;
  });

  if (!params.envoyerParEmail) return { notice, emailEnvoye: false, colocatairesPrevenus: 0, garantsPrevenus: 0 };

  const donnees = await donneesDuCourrier(notice);
  const pdf = await generateFormalNoticePdfBuffer(donnees);
  const pieceJointe = [{ filename: `mise-en-demeure-${donnees.reference}.pdf`, content: pdf, contentType: "application/pdf" }];
  const pourLocataire = (nom: string) =>
    formalNoticeEmail({
      tenantName: nom,
      propertyTitle: donnees.propertyTitle,
      totalDue: donnees.totalDue,
      currency: donnees.currency,
      deadlineDays: donnees.deadlineDays,
      agencyName: donnees.agency.name,
      reference: donnees.reference,
    });

  let emailEnvoye = false;
  if (tenant.email) {
    const { subject, html } = pourLocataire(nomAvecCivilite(tenant));
    const resultat = await sendEmail(tenant.email, subject, html, pieceJointe);
    emailEnvoye = !("error" in resultat && resultat.error);
  }
  const colocatairesPrevenus = await envoyerCopieAuxColocataires(contract.id, (colocataire) => ({
    ...pourLocataire(nomAvecCivilite(colocataire)),
    attachments: pieceJointe,
  }));

  let garantsPrevenus = 0;
  if (params.prevenirGarants) {
    const garants = await db.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contract.id));
    for (const garant of garants) {
      if (!garant.email) continue;
      try {
        const { subject, html } = guarantorFormalNoticeEmail({
          guarantorName: nomAvecCivilite(garant),
          maxAmount: garant.maxAmount,
          tenantName: nomComplet(tenant),
          propertyTitle: donnees.propertyTitle,
          totalDue: donnees.totalDue,
          currency: donnees.currency,
          deadlineDays: donnees.deadlineDays,
          agencyName: donnees.agency.name,
          reference: donnees.reference,
        });
        const resultat = await sendEmail(garant.email, subject, html, pieceJointe);
        if (!("error" in resultat && resultat.error)) garantsPrevenus++;
      } catch (err) {
        console.error(`[mise en demeure] Copie au garant ${garant.id} non envoyée :`, err);
      }
    }
  }

  const [misAJour] = await db
    .update(formalNotices)
    .set({ emailSentAt: emailEnvoye ? maintenant : null, guarantorsNotified: garantsPrevenus })
    .where(eq(formalNotices.id, notice.id))
    .returning();
  return { notice: misAJour, emailEnvoye, colocatairesPrevenus, garantsPrevenus };
}
