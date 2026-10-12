import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { contractCotenants, contracts, tenants } from "../db/schema";
import { nomAvecCivilite } from "../utils/nom";
import { type EmailAttachment, sendEmail } from "./email.service";

/**
 * Colocation (voir contract_cotenants) : qui, au-delà du titulaire, est partie au bail.
 *
 * Le colocataire voit le bail, ses factures et ses documents dans son portail, peut
 * payer et signaler un incident, et reçoit une copie des avis, relances et
 * quittances. Restent au titulaire seul : la signature électronique du bail et des
 * états des lieux (une seule signature est stockée), et la messagerie (la
 * conversation existante est la sienne).
 */
type Locataire = typeof tenants.$inferSelect;

/** Colocataires d'un bail, hors fiches anonymisées (on n'écrit plus à quelqu'un qui a demandé l'effacement). */
export async function colocatairesActifs(contractId: string): Promise<Locataire[]> {
  const lignes = await db
    .select({ tenant: tenants })
    .from(contractCotenants)
    .innerJoin(tenants, eq(contractCotenants.tenantId, tenants.id))
    .where(and(eq(contractCotenants.contractId, contractId), isNull(tenants.anonymizedAt)));
  return lignes.map((l: { tenant: Locataire }) => l.tenant);
}

/** Le locataire est-il colocataire de ce bail ? */
export async function estColocataire(contractId: string, tenantId: string): Promise<boolean> {
  const [lien] = await db
    .select({ id: contractCotenants.id })
    .from(contractCotenants)
    .where(and(eq(contractCotenants.contractId, contractId), eq(contractCotenants.tenantId, tenantId)))
    .limit(1);
  return Boolean(lien);
}

/** Baux dont le locataire est titulaire ou colocataire, avec sa qualité sur chacun. */
export async function bauxDuLocataire(tenantId: string): Promise<Map<string, "TITULAIRE" | "COLOCATAIRE">> {
  const [titulaire, colocataire] = await Promise.all([
    db.select({ id: contracts.id }).from(contracts).where(eq(contracts.tenantId, tenantId)),
    db.select({ id: contractCotenants.contractId }).from(contractCotenants).where(eq(contractCotenants.tenantId, tenantId)),
  ]);
  const baux = new Map<string, "TITULAIRE" | "COLOCATAIRE">();
  for (const c of colocataire) baux.set(c.id, "COLOCATAIRE");
  for (const c of titulaire) baux.set(c.id, "TITULAIRE");
  return baux;
}

/** « Madame Awa Sow », « Madame Awa Sow et Madame Binta Kane », « A, B et C ». */
export function nomsDesLocataires(personnes: Array<{ civility: string | null; firstName: string; lastName: string }>): string {
  const noms = personnes.map((p) => nomAvecCivilite(p));
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

/**
 * Envoie à chaque colocataire sa copie d'un message adressé au titulaire. Au mieux : un échec est
 * journalisé et n'affecte ni l'envoi au titulaire ni les autres colocataires. Renvoie le nombre de
 * copies envoyées.
 */
export async function envoyerCopieAuxColocataires(
  contractId: string,
  construire: (colocataire: Locataire) => { subject: string; html: string; attachments?: EmailAttachment[] }
): Promise<number> {
  let envoyees = 0;
  for (const colocataire of await colocatairesActifs(contractId)) {
    if (!colocataire.email) continue;
    try {
      const { subject, html, attachments } = construire(colocataire);
      await sendEmail(colocataire.email, subject, html, attachments);
      envoyees++;
    } catch (err) {
      console.error(`[colocation] Copie non envoyée au colocataire ${colocataire.id} (bail ${contractId}) :`, err);
    }
  }
  return envoyees;
}
