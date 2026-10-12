import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db, Transaction } from "../db/client";
import { contracts, invoices, properties, rentRevisions, tenants } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { arrondir } from "../utils/montants";
import { rentRevisionEmail, sendEmail } from "./email.service";

/**
 * Révision du loyer d'un bail (indexation annuelle, accord amiable).
 *
 * Trois façons de fixer le nouveau loyer, toutes calculées PAR LE SERVEUR :
 * un montant, un pourcentage, ou le rapport de deux valeurs d'un indice (IRL ou
 * autre — la plateforme ne connaît aucun indice : le gestionnaire saisit les
 * deux valeurs publiées, elle n'affirme rien sur leur exactitude ni sur le
 * plafond légal de son pays).
 *
 * La date d'effet est un premier de mois, jamais dans le passé : un loyer déjà
 * facturé et encaissé ne se réécrit pas. Une révision à date future reste
 * PENDING et le cron l'applique le jour venu ; celle du mois en cours s'applique
 * tout de suite. Les factures encore impayées à partir du mois d'effet sont
 * recalculées (au prorata du nouveau loyer, donc un dernier mois partiel reste
 * juste) ; une facture déjà encaissée, même en partie, refuse la révision.
 */
export type ModeRevision = "AMOUNT" | "PERCENT" | "INDEX";

export type EntreeRevision =
  | { mode: "AMOUNT"; newRent: number }
  | { mode: "PERCENT"; percent: number }
  | { mode: "INDEX"; indexOld: number; indexNew: number; indexName?: string | null };

export const POURCENTAGE_MIN = -50;
export const POURCENTAGE_MAX = 100;

type Revision = typeof rentRevisions.$inferSelect;
type Contrat = typeof contracts.$inferSelect;

/** Nouveau loyer d'après l'entrée du gestionnaire, arrondi au centime ; refuse tout ce qui n'est pas un loyer plausible. */
export function calculerNouveauLoyer(loyerActuel: number, entree: EntreeRevision): number {
  let nouveau: number;
  if (entree.mode === "AMOUNT") nouveau = entree.newRent;
  else if (entree.mode === "PERCENT") {
    if (entree.percent < POURCENTAGE_MIN || entree.percent > POURCENTAGE_MAX) {
      throw new ApiError(400, `Le pourcentage doit être compris entre ${POURCENTAGE_MIN} % et ${POURCENTAGE_MAX} %.`);
    }
    nouveau = loyerActuel * (1 + entree.percent / 100);
  } else {
    if (!(entree.indexOld > 0) || !(entree.indexNew > 0)) throw new ApiError(400, "Les deux valeurs de l'indice doivent être positives.");
    nouveau = (loyerActuel * entree.indexNew) / entree.indexOld;
  }
  nouveau = arrondir(nouveau);
  if (!Number.isFinite(nouveau) || nouveau <= 0) throw new ApiError(400, "Le nouveau loyer doit être supérieur à zéro.");
  if (nouveau === arrondir(loyerActuel)) throw new ApiError(400, "Le nouveau loyer est identique au loyer actuel.");
  return nouveau;
}

/** Premier du mois (UTC) d'une date. */
export function debutDeMois(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

const moisAbsolu = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

/** Motif lisible, repris dans l'email au locataire. */
export function motifRevision(r: Pick<Revision, "method" | "percent" | "indexName" | "indexOld" | "indexNew">): string | null {
  if (r.method === "PERCENT" && r.percent !== null) return `${r.percent > 0 ? "+" : ""}${String(r.percent).replace(".", ",")} %`;
  if (r.method === "INDEX" && r.indexOld !== null && r.indexNew !== null) {
    const nom = r.indexName ? `${r.indexName} : ` : "indice : ";
    return `${nom}${String(r.indexOld).replace(".", ",")} → ${String(r.indexNew).replace(".", ",")}`;
  }
  return null;
}

/**
 * Applique le nouveau loyer au contrat (verrou de ligne tenu par l'appelant) et recalcule les
 * factures impayées à partir du mois d'effet. Renvoie le nombre de factures recalculées.
 */
async function appliquerAuContrat(tx: Transaction, contrat: Contrat, nouveauLoyer: number, effet: Date): Promise<number> {
  const ancien = contrat.rent;
  const concernees = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.contractId, contrat.id), sql`${invoices.status} <> 'CANCELLED'`));
  const aPartirDuMois = concernees.filter(
    (f: typeof invoices.$inferSelect) => f.periodYear * 12 + (f.periodMonth - 1) >= moisAbsolu(effet)
  );

  let recalculees = 0;
  for (const f of aPartirDuMois) {
    if (f.status === "PAID" || f.amountPaid > 0) continue; // loyer déjà encaissé : il garde le montant payé
    await tx.update(invoices).set({ amount: arrondir((f.amount * nouveauLoyer) / ancien) }).where(eq(invoices.id, f.id));
    recalculees++;
  }
  await tx.update(contracts).set({ rent: nouveauLoyer }).where(eq(contracts.id, contrat.id));
  return recalculees;
}

export interface CreationRevision {
  contractId: string;
  managerId: string;
  entree: EntreeRevision;
  effectiveDate: Date;
  note?: string | null;
  createdBy?: string | null;
  prevenirLocataire: boolean;
  maintenant?: Date;
}

/** Crée la révision ; l'applique tout de suite si sa date d'effet est le mois en cours. */
export async function creerRevision(p: CreationRevision): Promise<{ revision: Revision; appliquee: boolean; facturesRecalculees: number; emailEnvoye: boolean }> {
  const maintenant = p.maintenant ?? new Date();
  const effet = debutDeMois(p.effectiveDate);
  if (effet.getTime() !== p.effectiveDate.getTime()) {
    throw new ApiError(400, "La date d'effet doit être le premier jour d'un mois.");
  }
  if (moisAbsolu(effet) < moisAbsolu(maintenant)) {
    throw new ApiError(400, "La date d'effet ne peut pas être dans le passé : un loyer déjà facturé ne se réécrit pas.");
  }
  const immediate = moisAbsolu(effet) === moisAbsolu(maintenant);

  const resultat = await db.transaction(async (tx: Transaction) => {
    // Verrou de ligne : deux révisions simultanées sur le même bail se succèdent au lieu de se croiser.
    await tx.execute(sql`SELECT id FROM contracts WHERE id = ${p.contractId} FOR UPDATE`);
    const [contrat] = await tx.select().from(contracts).where(eq(contracts.id, p.contractId));
    if (!contrat) throw new ApiError(404, "Contrat introuvable");
    const [bien] = await tx.select().from(properties).where(eq(properties.id, contrat.propertyId));
    if (!bien || bien.managerId !== p.managerId) throw new ApiError(404, "Contrat introuvable");
    if (contrat.status !== "ACTIVE") throw new ApiError(409, "Seul un contrat actif peut voir son loyer révisé.");
    if (effet <= new Date(contrat.startDate)) throw new ApiError(400, "La date d'effet doit suivre le début du bail.");
    if (effet > new Date(contrat.endDate)) throw new ApiError(400, "La date d'effet dépasse la fin du bail : renouvelez le bail d'abord.");

    const [enAttente] = await tx
      .select({ id: rentRevisions.id })
      .from(rentRevisions)
      .where(and(eq(rentRevisions.contractId, contrat.id), eq(rentRevisions.status, "PENDING")));
    if (enAttente) throw new ApiError(409, "Une révision est déjà programmée pour ce bail : annulez-la avant d'en créer une autre.");

    const nouveauLoyer = calculerNouveauLoyer(contrat.rent, p.entree);

    // Un mois déjà (même partiellement) encaissé garde son montant : on le dit plutôt que de le réécrire.
    const factures = await tx.select().from(invoices).where(and(eq(invoices.contractId, contrat.id), sql`${invoices.status} <> 'CANCELLED'`));
    const encaissee = factures.find(
      (f: typeof invoices.$inferSelect) => f.periodYear * 12 + (f.periodMonth - 1) >= moisAbsolu(effet) && (f.status === "PAID" || f.amountPaid > 0)
    );
    if (encaissee) {
      throw new ApiError(
        409,
        `Le loyer de ${String(encaissee.periodMonth).padStart(2, "0")}/${encaissee.periodYear} est déjà encaissé : choisissez un mois suivant.`
      );
    }

    const [revision] = await tx
      .insert(rentRevisions)
      .values({
        contractId: contrat.id,
        previousRent: contrat.rent,
        newRent: nouveauLoyer,
        effectiveDate: effet,
        method: p.entree.mode,
        percent: p.entree.mode === "PERCENT" ? p.entree.percent : null,
        indexName: p.entree.mode === "INDEX" ? p.entree.indexName?.trim() || null : null,
        indexOld: p.entree.mode === "INDEX" ? p.entree.indexOld : null,
        indexNew: p.entree.mode === "INDEX" ? p.entree.indexNew : null,
        note: p.note?.trim() || null,
        status: immediate ? "APPLIED" : "PENDING",
        appliedAt: immediate ? maintenant : null,
        createdBy: p.createdBy ?? null,
      })
      .returning();

    const recalculees = immediate ? await appliquerAuContrat(tx, contrat, nouveauLoyer, effet) : 0;
    return { revision, contrat, bien, recalculees };
  });

  let emailEnvoye = false;
  if (p.prevenirLocataire) emailEnvoye = await prevenirLocataire(resultat.revision, resultat.bien.title, resultat.contrat.tenantId, resultat.contrat.currency);

  return { revision: resultat.revision, appliquee: immediate, facturesRecalculees: resultat.recalculees, emailEnvoye };
}

/** Email au locataire ; un échec d'envoi ne défait jamais la révision. */
async function prevenirLocataire(revision: Revision, titreBien: string, tenantId: string, devise: string): Promise<boolean> {
  try {
    const [locataire] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!locataire?.email) return false;
    const { subject, html } = rentRevisionEmail({
      tenantName: `${locataire.firstName} ${locataire.lastName}`,
      propertyTitle: titreBien,
      previousRent: revision.previousRent,
      newRent: revision.newRent,
      currency: devise,
      effectiveDate: revision.effectiveDate,
      motif: motifRevision(revision),
      note: revision.note,
    });
    await sendEmail(locataire.email, subject, html);
    await db.update(rentRevisions).set({ tenantNotifiedAt: new Date() }).where(eq(rentRevisions.id, revision.id));
    return true;
  } catch (err) {
    console.error(`[rent-revision] Email au locataire non envoyé pour la révision ${revision.id} :`, err);
    return false;
  }
}

/** Révisions d'un bail, de la plus récente à la plus ancienne. */
export async function listerRevisions(contractId: string): Promise<Revision[]> {
  const lignes = await db.select().from(rentRevisions).where(eq(rentRevisions.contractId, contractId));
  return lignes.sort((a: Revision, b: Revision) => b.effectiveDate.getTime() - a.effectiveDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
}

/** Révisions appliquées d'un bail, de la plus ancienne à la plus récente (bail PDF). */
export async function revisionsAppliquees(contractId: string): Promise<Revision[]> {
  return db
    .select()
    .from(rentRevisions)
    .where(and(eq(rentRevisions.contractId, contractId), eq(rentRevisions.status, "APPLIED")))
    .orderBy(asc(rentRevisions.effectiveDate), asc(rentRevisions.createdAt));
}

/** Retire une révision programmée. Une révision déjà appliquée ne s'annule pas : on en crée une nouvelle. */
export async function annulerRevision(contractId: string, revisionId: string): Promise<void> {
  const [annulee] = await db
    .update(rentRevisions)
    .set({ status: "CANCELLED" })
    .where(and(eq(rentRevisions.id, revisionId), eq(rentRevisions.contractId, contractId), eq(rentRevisions.status, "PENDING")))
    .returning({ id: rentRevisions.id });
  if (!annulee) {
    const [existante] = await db.select({ status: rentRevisions.status }).from(rentRevisions).where(and(eq(rentRevisions.id, revisionId), eq(rentRevisions.contractId, contractId)));
    if (!existante) throw new ApiError(404, "Révision introuvable");
    throw new ApiError(409, existante.status === "APPLIED" ? "Cette révision est déjà appliquée : créez une nouvelle révision pour la corriger." : "Cette révision est déjà annulée.");
  }
}

/**
 * Applique les révisions dont la date d'effet est arrivée (appelée par le cron avant la génération
 * des factures du mois). Chaque révision est réclamée par un UPDATE conditionnel : deux exécutions
 * simultanées ne l'appliquent qu'une fois. Un bail terminé entre-temps annule la révision.
 */
export async function appliquerRevisionsDues(maintenant: Date = new Date(), managerId?: string): Promise<{ appliquees: number; annulees: number }> {
  const dues: Array<{ revision: Revision }> = await db
    .select({ revision: rentRevisions })
    .from(rentRevisions)
    .innerJoin(contracts, eq(rentRevisions.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(
        eq(rentRevisions.status, "PENDING"),
        lte(rentRevisions.effectiveDate, maintenant),
        ...(managerId ? [eq(properties.managerId, managerId)] : [])
      )
    );

  let appliquees = 0;
  let annulees = 0;
  for (const { revision } of dues) {
    try {
      const resultat = await db.transaction(async (tx: Transaction) => {
        await tx.execute(sql`SELECT id FROM contracts WHERE id = ${revision.contractId} FOR UPDATE`);
        const [reclamee] = await tx
          .update(rentRevisions)
          .set({ status: "APPLIED", appliedAt: maintenant })
          .where(and(eq(rentRevisions.id, revision.id), eq(rentRevisions.status, "PENDING")))
          .returning();
        if (!reclamee) return "DEJA" as const; // une autre exécution l'a prise
        const [contrat] = await tx.select().from(contracts).where(eq(contracts.id, revision.contractId));
        if (!contrat || contrat.status !== "ACTIVE") {
          await tx.update(rentRevisions).set({ status: "CANCELLED", appliedAt: null }).where(eq(rentRevisions.id, revision.id));
          return "ANNULEE" as const;
        }
        // Le loyer de départ est celui du bail AU MOMENT d'appliquer (il a pu être corrigé depuis la programmation).
        await tx.update(rentRevisions).set({ previousRent: contrat.rent }).where(eq(rentRevisions.id, revision.id));
        await appliquerAuContrat(tx, contrat, revision.newRent, revision.effectiveDate);
        return "APPLIQUEE" as const;
      });
      if (resultat === "APPLIQUEE") appliquees++;
      if (resultat === "ANNULEE") annulees++;
    } catch (err) {
      console.error(`[rent-revision] Échec de l'application de la révision ${revision.id} :`, err);
    }
  }
  return { appliquees, annulees };
}

// --- Baux à réviser ------------------------------------------------------------------------------------------------

/** Fenêtre de rappel autour de la date anniversaire : un mois après (oubli) à deux mois avant (préparation). */
export const JOURS_APRES_ANNIVERSAIRE = 30;
export const JOURS_AVANT_ANNIVERSAIRE = 60;
const JOUR_MS = 24 * 60 * 60 * 1000;

export interface BailAReviser {
  contractId: string;
  propertyTitle: string;
  tenantName: string;
  rent: number;
  currency: string;
  startDate: Date;
  endDate: Date;
  /** Date anniversaire du bail concernée (minuit UTC). */
  anniversaire: Date;
  /** Premier de mois proposé pour la révision : jamais avant l'anniversaire, jamais dans le passé. */
  dateSuggeree: Date;
  /** Date d'effet de la dernière révision appliquée, ou null. */
  derniereRevision: Date | null;
}

/** Anniversaire de `debut` en `annee`, plafonné au dernier jour du mois (un bail du 29 février tombe le 28). */
function anniversaireEn(debut: Date, annee: number): Date {
  const dernierJour = new Date(Date.UTC(annee, debut.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, debut.getUTCMonth(), Math.min(debut.getUTCDate(), dernierJour)));
}

/**
 * Baux actifs dont la date anniversaire tombe dans la fenêtre [−30 j ; +60 j] et qui n'ont pas
 * déjà une révision (programmée ou appliquée) pour cette échéance. La plateforme ne dit pas
 * qu'un loyer DOIT être révisé : elle rappelle seulement l'échéance au gestionnaire.
 */
export async function bauxAReviser(managerId: string, maintenant: Date = new Date()): Promise<BailAReviser[]> {
  const lignes: Array<{ contrat: Contrat; titre: string; prenom: string; nom: string }> = await db
    .select({ contrat: contracts, titre: properties.title, prenom: tenants.firstName, nom: tenants.lastName })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(and(eq(properties.managerId, managerId), eq(contracts.status, "ACTIVE")));
  if (lignes.length === 0) return [];

  const revisions: Revision[] = await db
    .select()
    .from(rentRevisions)
    .innerJoin(contracts, eq(rentRevisions.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(properties.managerId, managerId), sql`${rentRevisions.status} <> 'CANCELLED'`))
    .then((r: Array<{ rent_revisions: Revision }>) => r.map((x) => x.rent_revisions));

  const debutFenetre = maintenant.getTime() - JOURS_APRES_ANNIVERSAIRE * JOUR_MS;
  const finFenetre = maintenant.getTime() + JOURS_AVANT_ANNIVERSAIRE * JOUR_MS;
  const moisCourant = debutDeMois(maintenant);

  const resultat: BailAReviser[] = [];
  for (const { contrat, titre, prenom, nom } of lignes) {
    const debut = new Date(contrat.startDate);
    const fin = new Date(contrat.endDate);
    const anniversaire = [maintenant.getUTCFullYear() - 1, maintenant.getUTCFullYear(), maintenant.getUTCFullYear() + 1]
      .map((annee) => anniversaireEn(debut, annee))
      .find((a) => a > debut && a <= fin && a.getTime() >= debutFenetre && a.getTime() <= finFenetre);
    if (!anniversaire) continue;

    const siennes = revisions.filter((r) => r.contractId === contrat.id);
    // Une révision programmée, ou appliquée dans les onze mois qui précèdent l'anniversaire, couvre cette échéance.
    const seuil = Date.UTC(anniversaire.getUTCFullYear(), anniversaire.getUTCMonth() - 11, anniversaire.getUTCDate());
    if (siennes.some((r) => r.status === "PENDING" || r.effectiveDate.getTime() >= seuil)) continue;

    const apresAnniversaire =
      anniversaire.getUTCDate() === 1 ? anniversaire : new Date(Date.UTC(anniversaire.getUTCFullYear(), anniversaire.getUTCMonth() + 1, 1));
    const dateSuggeree = apresAnniversaire < moisCourant ? moisCourant : apresAnniversaire;
    const appliquees = siennes.filter((r) => r.status === "APPLIED").sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());

    resultat.push({
      contractId: contrat.id,
      propertyTitle: titre,
      tenantName: `${prenom} ${nom}`,
      rent: contrat.rent,
      currency: contrat.currency,
      startDate: debut,
      endDate: fin,
      anniversaire,
      dateSuggeree,
      derniereRevision: appliquees[0]?.effectiveDate ?? null,
    });
  }
  return resultat.sort((a, b) => a.anniversaire.getTime() - b.anniversaire.getTime());
}

/** Numéro d'avenant d'une révision : son rang parmi les révisions non annulées du bail, par date d'effet. */
export async function numeroAvenant(revision: Revision): Promise<number> {
  const toutes = await db
    .select()
    .from(rentRevisions)
    .where(and(eq(rentRevisions.contractId, revision.contractId), sql`${rentRevisions.status} <> 'CANCELLED'`))
    .orderBy(asc(rentRevisions.effectiveDate), asc(rentRevisions.createdAt));
  return toutes.findIndex((r: Revision) => r.id === revision.id) + 1;
}
