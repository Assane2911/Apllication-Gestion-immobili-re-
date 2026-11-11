import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/client";
import { contracts, insurancePolicies, invoices, leaseNotices, properties, rentRevisions, storedDocuments, tenants } from "../db/schema";
import { debutDeLaJournee, jourDecale, joursEntre } from "../utils/dates";

/**
 * Agenda de l'agence : toutes les dates qui appellent une action, réunies en une liste.
 *
 * Seules les échéances à traiter y figurent : une date passée n'apparaît que si rien ne l'a encore soldée
 * (loyer non payé, assurance non renouvelée, révision non appliquée, bail ou sortie non clôturés). Une
 * échéance dépassée est marquée `enRetard` ; les autres sont à venir, dans la fenêtre demandée.
 */

export type TypeEvenement = "RENT_DUE" | "LEASE_END" | "EXIT" | "RENT_REVISION" | "INSURANCE_EXPIRY" | "DOCUMENT_EXPIRY";

export interface EvenementAgenda {
  /** Stable d'un appel à l'autre : « type:identifiant de l'objet ». */
  id: string;
  type: TypeEvenement;
  date: Date;
  enRetard: boolean;
  /** Null pour un document rangé au seul nom d'un locataire. */
  propertyId: string | null;
  propertyTitle: string | null;
  contractId: string | null;
  tenantName: string | null;
  /** Loyer dû (RENT_DUE) ou nouveau loyer (RENT_REVISION) ; null sinon. */
  amount: number | null;
  currency: string | null;
  /** Libellé libre : assureur pour une assurance, motif pour un congé, intitulé pour un document. */
  label: string | null;
}

/** Au-delà, une police ou un document échu et jamais supprimé n'est plus une urgence, seulement du bruit. */
const JOURS_ECHEANCE_PASSEE_CONSERVEE = 90;
/** Garde-fou : une agence très chargée ne doit pas renvoyer une réponse sans limite. */
const MAX_EVENEMENTS = 1000;

export const JOURS_AGENDA_PAR_DEFAUT = 180;
export const JOURS_AGENDA_MAX = 366;

/**
 * Les requêtes de l'agenda ne rapatrient QUE les colonnes dont elles se servent. Les lignes entières de contrats, de biens et
 * de locataires portent des textes libres (clauses du bail, mentions, signatures) : mesuré sur 500 biens, la requête des
 * loyers ramenait 7,5 Mo pour 170 Ko utiles, à chaque affichage du menu (le décompte est relu toutes les cinq minutes par
 * onglet ouvert). Ajouter un champ à une échéance suppose de l'ajouter ici.
 */
const NOM_LOCATAIRE = { firstName: tenants.firstName, lastName: tenants.lastName };

export async function chargerAgenda(managerId: string, jours: number, maintenant: Date = new Date()): Promise<EvenementAgenda[]> {
  const aujourdhui = debutDeLaJournee(maintenant);
  const horizon = jourDecale(jours, aujourdhui);
  const enRetard = (date: Date) => joursEntre(aujourdhui, date) < 0;
  const nom = (t: { firstName: string; lastName: string } | null) => (t ? `${t.firstName} ${t.lastName}`.trim() : null);

  const [loyers, baux, conges, revisions, assurances, documents] = await Promise.all([
    db
      .select({
        i: { id: invoices.id, dueDate: invoices.dueDate, status: invoices.status, amount: invoices.amount, amountPaid: invoices.amountPaid, currency: invoices.currency },
        c: { id: contracts.id },
        p: { id: properties.id, title: properties.title },
        t: NOM_LOCATAIRE,
      })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), inArray(invoices.status, ["PENDING", "LATE"]), lte(invoices.dueDate, horizon))),
    db
      .select({ c: { id: contracts.id, endDate: contracts.endDate }, p: { id: properties.id, title: properties.title }, t: NOM_LOCATAIRE })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), eq(contracts.status, "ACTIVE"), lte(contracts.endDate, horizon))),
    db
      .select({
        n: { id: leaseNotices.id, exitDate: leaseNotices.exitDate, reason: leaseNotices.reason },
        c: { id: contracts.id },
        p: { id: properties.id, title: properties.title },
        t: NOM_LOCATAIRE,
      })
      .from(leaseNotices)
      .innerJoin(contracts, eq(leaseNotices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), eq(leaseNotices.status, "ACTIVE"), eq(contracts.status, "ACTIVE"), lte(leaseNotices.exitDate, horizon))),
    db
      .select({
        r: { id: rentRevisions.id, effectiveDate: rentRevisions.effectiveDate, newRent: rentRevisions.newRent },
        c: { id: contracts.id, currency: contracts.currency },
        p: { id: properties.id, title: properties.title },
        t: NOM_LOCATAIRE,
      })
      .from(rentRevisions)
      .innerJoin(contracts, eq(rentRevisions.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), eq(rentRevisions.status, "PENDING"), lte(rentRevisions.effectiveDate, horizon))),
    db
      .select({
        a: { id: insurancePolicies.id, expiryDate: insurancePolicies.expiryDate, insurerName: insurancePolicies.insurerName },
        p: { id: properties.id, title: properties.title },
      })
      .from(insurancePolicies)
      .innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
      .where(and(eq(properties.managerId, managerId), lte(insurancePolicies.expiryDate, horizon))),
    db
      .select({
        d: { id: storedDocuments.id, expiresAt: storedDocuments.expiresAt, title: storedDocuments.title },
        bien: { id: properties.id, title: properties.title },
        t: NOM_LOCATAIRE,
      })
      .from(storedDocuments)
      .leftJoin(properties, eq(storedDocuments.propertyId, properties.id))
      .leftJoin(tenants, eq(storedDocuments.tenantId, tenants.id))
      .where(and(eq(storedDocuments.managerId, managerId), isNotNull(storedDocuments.expiresAt), lte(storedDocuments.expiresAt, horizon))),
  ]);

  // Un congé en cours remplace la fin de bail : on ne montre pas deux dates de sortie pour un même bail.
  const bauxEnConge = new Set(conges.map((r: { c: { id: string } }) => r.c.id));
  const evenements: EvenementAgenda[] = [];

  for (const { i, c, p, t } of loyers) {
    evenements.push({
      id: `RENT_DUE:${i.id}`,
      type: "RENT_DUE",
      date: i.dueDate,
      enRetard: i.status === "LATE" || enRetard(i.dueDate),
      propertyId: p.id,
      propertyTitle: p.title,
      contractId: c.id,
      tenantName: nom(t),
      amount: Math.max(0, i.amount - i.amountPaid),
      currency: i.currency,
      label: null,
    });
  }
  for (const { c, p, t } of baux) {
    if (bauxEnConge.has(c.id)) continue;
    evenements.push({
      id: `LEASE_END:${c.id}`,
      type: "LEASE_END",
      date: c.endDate,
      enRetard: enRetard(c.endDate),
      propertyId: p.id,
      propertyTitle: p.title,
      contractId: c.id,
      tenantName: nom(t),
      amount: null,
      currency: null,
      label: null,
    });
  }
  for (const { n, c, p, t } of conges) {
    evenements.push({
      id: `EXIT:${n.id}`,
      type: "EXIT",
      date: n.exitDate,
      enRetard: enRetard(n.exitDate),
      propertyId: p.id,
      propertyTitle: p.title,
      contractId: c.id,
      tenantName: nom(t),
      amount: null,
      currency: null,
      label: n.reason ?? null,
    });
  }
  for (const { r, c, p, t } of revisions) {
    evenements.push({
      id: `RENT_REVISION:${r.id}`,
      type: "RENT_REVISION",
      date: r.effectiveDate,
      enRetard: enRetard(r.effectiveDate),
      propertyId: p.id,
      propertyTitle: p.title,
      contractId: c.id,
      tenantName: nom(t),
      amount: r.newRent,
      currency: c.currency,
      label: null,
    });
  }
  for (const { a, p } of assurances) {
    // Une police échue depuis longtemps n'est plus une échéance : on ne garde que les récentes.
    if (joursEntre(a.expiryDate, aujourdhui) > JOURS_ECHEANCE_PASSEE_CONSERVEE) continue;
    evenements.push({
      id: `INSURANCE_EXPIRY:${a.id}`,
      type: "INSURANCE_EXPIRY",
      date: a.expiryDate,
      enRetard: enRetard(a.expiryDate),
      propertyId: p.id,
      propertyTitle: p.title,
      contractId: null,
      tenantName: null,
      amount: null,
      currency: null,
      label: a.insurerName,
    });
  }

  for (const { d, bien, t } of documents) {
    const echeance = d.expiresAt!;
    // Un document périmé depuis longtemps n'est plus une échéance : on ne garde que les récents.
    if (joursEntre(echeance, aujourdhui) > JOURS_ECHEANCE_PASSEE_CONSERVEE) continue;
    evenements.push({
      id: `DOCUMENT_EXPIRY:${d.id}`,
      type: "DOCUMENT_EXPIRY",
      date: echeance,
      enRetard: enRetard(echeance),
      propertyId: bien?.id ?? null,
      propertyTitle: bien?.title ?? null,
      contractId: null,
      tenantName: nom(t),
      amount: null,
      currency: null,
      label: d.title,
    });
  }

  // En retard d'abord, du plus ancien au plus récent ; puis le reste par date croissante.
  evenements.sort((x, y) => Number(y.enRetard) - Number(x.enRetard) || x.date.getTime() - y.date.getTime() || x.id.localeCompare(y.id));
  return evenements.slice(0, MAX_EVENEMENTS);
}

/** Fenêtre de l'« à venir » du tableau de bord : la semaine qui vient. */
export const JOURS_AGENDA_RESUME = 7;

export interface ResumeAgenda {
  /** Toutes les échéances dépassées, loyers compris (la pastille du menu et le titre « En retard » de la page). */
  overdue: number;
  /** Les dépassées hors loyers : les impayés ont déjà leur propre ligne au tableau de bord, on ne les compte pas deux fois. */
  overdueOther: number;
  /** Les échéances des prochains jours, retard exclu. */
  soon: number;
}

/** Les seuls chiffres de l'agenda dont le tableau de bord et le menu ont besoin, calculés comme la liste elle-même. */
export async function resumeAgenda(managerId: string, maintenant: Date = new Date()): Promise<ResumeAgenda> {
  const evenements = await chargerAgenda(managerId, JOURS_AGENDA_RESUME, maintenant);
  const enRetard = evenements.filter((e) => e.enRetard);
  return {
    overdue: enRetard.length,
    overdueOther: enRetard.filter((e) => e.type !== "RENT_DUE").length,
    soon: evenements.length - enRetard.length,
  };
}
