import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  agencySettings,
  contracts,
  inspections,
  invoices,
  issueReports,
  messages,
  properties,
  tenants,
  users,
} from "../db/schema";

/**
 * Rassemble tout ce que le Service détient au sujet d'un locataire, pour
 * l'exercice du droit d'accès (RGPD art. 15) et du droit à la portabilité
 * (art. 20).
 *
 * La politique de confidentialité annonçait ces droits comme « traités
 * manuellement » : il fallait qu'un humain reconstitue le dossier à la main,
 * sans outil et sans garantie d'exhaustivité. C'est cette exhaustivité que
 * rassembler le tout au même endroit, en une seule fonction, permet enfin de
 * vérifier.
 *
 * Deux principes de rédaction :
 *
 *  - On ne choisit pas ce qu'on montre. La note interne du gestionnaire sur
 *    un signalement, par exemple, parle du locataire : elle relève du droit
 *    d'accès, même si elle n'a jamais été écrite pour être lue par lui.
 *    Filtrer ferait de l'export un résumé de complaisance.
 *
 *  - On ne montre QUE cette personne. Les messages sont ceux de ses propres
 *    baux, les factures celles de ses propres contrats. Un export qui
 *    déborderait sur un autre locataire transformerait un droit en fuite.
 *
 * Le format est du JSON : « structuré, couramment utilisé et lisible par
 * machine », ce que l'article 20 exige d'un export portable.
 */
export async function construireExportLocataire(tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return null;

  const [gestionnaire] = await db.select().from(users).where(eq(users.id, tenant.managerId));
  const [agence] = await db.select().from(agencySettings).where(eq(agencySettings.userId, tenant.managerId));

  const lignesContrats = await db
    .select({ contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, tenantId));

  const idsContrats = lignesContrats.map((l: { contract: typeof contracts.$inferSelect }) => l.contract.id);

  // `inArray` sur une liste vide produit une condition toujours fausse selon
  // les dialectes, et une erreur sur d'autres : un locataire sans aucun bail
  // est un cas normal (fiche créée, contrat pas encore signé), pas un cas
  // limite à découvrir en production.
  const [factures, signalements, etatsDesLieux, conversations] = idsContrats.length
    ? await Promise.all([
        db.select().from(invoices).where(inArray(invoices.contractId, idsContrats)),
        db.select().from(issueReports).where(eq(issueReports.tenantId, tenantId)),
        db.select().from(inspections).where(eq(inspections.tenantId, tenantId)),
        db.select().from(messages).where(inArray(messages.contractId, idsContrats)),
      ])
    : [[], await db.select().from(issueReports).where(eq(issueReports.tenantId, tenantId)), [], []];

  return {
    exportGenereLe: new Date().toISOString(),
    aProposDeCetExport:
      "Ce document rassemble l'ensemble des données détenues à votre sujet par le service de gestion locative, " +
      "au titre du droit d'accès et du droit à la portabilité (articles 15 et 20 du RGPD). " +
      "Il est au format JSON afin de pouvoir être relu par un autre logiciel.",
    responsableDuTraitement: {
      // C'est le Gestionnaire, et non l'éditeur du Service, qui est
      // responsable des données de ses locataires : c'est donc à lui que se
      // formule une demande de rectification ou d'effacement. Un export qui
      // ne le nommerait pas laisserait son destinataire sans interlocuteur.
      agencyName: agence?.agencyName ?? null,
      email: gestionnaire?.email ?? null,
      telephone: agence?.phone ?? null,
      adresse: agence?.address ?? null,
    },
    locataire: {
      id: tenant.id,
      civility: tenant.civility,
      firstName: tenant.firstName,
      lastName: tenant.lastName,
      email: tenant.email,
      phone: tenant.phone,
      pieceIdentiteDetenue: Boolean(tenant.idDocument),
      compteDePortail: Boolean(tenant.userId),
      anonymizedAt: tenant.anonymizedAt,
      ficheCreeeLe: tenant.createdAt,
    },
    contrats: lignesContrats.map(
      (l: { contract: typeof contracts.$inferSelect; property: typeof properties.$inferSelect }) => ({
        ...l.contract,
        bien: {
          id: l.property.id,
          title: l.property.title,
          address: l.property.address,
          surface: l.property.surface,
        },
      })
    ),
    factures,
    signalements,
    etatsDesLieux,
    messages: conversations,
  };
}

/** Nom de fichier proposé au téléchargement — daté, pour que deux exports ne se confondent pas. */
export function nomFichierExport(tenant: { firstName: string; lastName: string }) {
  const sansAccent = `${tenant.firstName}-${tenant.lastName}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .toLowerCase();
  return `donnees-${sansAccent}-${new Date().toISOString().slice(0, 10)}.json`;
}
