import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { contracts, insurancePolicies, invoices, leaseNotices, properties, rentRevisions, tenants } from "../db/schema";
import { debutDeLaJournee, jourDecale, joursEntre } from "../utils/dates";

/**
 * Agenda de l'agence : toutes les dates qui appellent une action, réunies en une liste.
 *
 * Seules les échéances à traiter y figurent : une date passée n'apparaît que si rien ne l'a encore soldée
 * (loyer non payé, assurance non renouvelée, révision non appliquée, bail ou sortie non clôturés). Une
 * échéance dépassée est marquée `enRetard` ; les autres sont à venir, dans la fenêtre demandée.
 */

export type TypeEvenement = "RENT_DUE" | "LEASE_END" | "EXIT" | "RENT_REVISION" | "INSURANCE_EXPIRY";

export interface EvenementAgenda {
  /** Stable d'un appel à l'autre : « type:identifiant de l'objet ». */
  id: string;
  type: TypeEvenement;
  date: Date;
  enRetard: boolean;
  propertyId: string;
  propertyTitle: string;
  contractId: string | null;
  tenantName: string | null;
  /** Loyer dû (RENT_DUE) ou nouveau loyer (RENT_REVISION) ; null sinon. */
  amount: number | null;
  currency: string | null;
  /** Libellé libre : assureur pour une assurance, motif pour un congé. */
  label: string | null;
}

/** Au-delà, une police échue et jamais supprimée n'est plus une urgence, seulement du bruit. */
const JOURS_ASSURANCE_ECHUE = 90;
/** Garde-fou : une agence très chargée ne doit pas renvoyer une réponse sans limite. */
const MAX_EVENEMENTS = 1000;

export const JOURS_AGENDA_PAR_DEFAUT = 180;
export const JOURS_AGENDA_MAX = 366;

export async function chargerAgenda(managerId: string, jours: number, maintenant: Date = new Date()): Promise<EvenementAgenda[]> {
  const aujourdhui = debutDeLaJournee(maintenant);
  const horizon = jourDecale(jours, aujourdhui);
  const enRetard = (date: Date) => joursEntre(aujourdhui, date) < 0;
  const nom = (t: { firstName: string; lastName: string } | null) => (t ? `${t.firstName} ${t.lastName}`.trim() : null);

  const [loyers, baux, conges, revisions, assurances] = await Promise.all([
    db
      .select({ i: invoices, c: contracts, p: properties, t: tenants })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), inArray(invoices.status, ["PENDING", "LATE"]), lte(invoices.dueDate, horizon))),
    db
      .select({ c: contracts, p: properties, t: tenants })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), eq(contracts.status, "ACTIVE"), lte(contracts.endDate, horizon))),
    db
      .select({ n: leaseNotices, c: contracts, p: properties, t: tenants })
      .from(leaseNotices)
      .innerJoin(contracts, eq(leaseNotices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), eq(leaseNotices.status, "ACTIVE"), eq(contracts.status, "ACTIVE"), lte(leaseNotices.exitDate, horizon))),
    db
      .select({ r: rentRevisions, c: contracts, p: properties, t: tenants })
      .from(rentRevisions)
      .innerJoin(contracts, eq(rentRevisions.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(and(eq(properties.managerId, managerId), eq(rentRevisions.status, "PENDING"), lte(rentRevisions.effectiveDate, horizon))),
    db
      .select({ a: insurancePolicies, p: properties })
      .from(insurancePolicies)
      .innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
      .where(and(eq(properties.managerId, managerId), lte(insurancePolicies.expiryDate, horizon))),
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
    if (joursEntre(a.expiryDate, aujourdhui) > JOURS_ASSURANCE_ECHUE) continue;
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

  // En retard d'abord, du plus ancien au plus récent ; puis le reste par date croissante.
  evenements.sort((x, y) => Number(y.enRetard) - Number(x.enRetard) || x.date.getTime() - y.date.getTime() || x.id.localeCompare(y.id));
  return evenements.slice(0, MAX_EVENEMENTS);
}
