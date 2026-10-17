import { eq, inArray, or, sql } from "drizzle-orm";
import { db, Transaction } from "../db/client";
import { agencySettings, contracts, invoices, issueReports, listings, properties, tenants, users } from "../db/schema";
import { cancelStripeSubscriptionNow } from "./payment.service";
import { deleteStorageObjectBestEffort } from "./storage.service";

/**
 * Suppression définitive d'un compte gestionnaire propriétaire et de TOUT ce
 * qui appartient à son agence. Partagée par la suppression à la demande du
 * gestionnaire (deleteMyAccount, auth.controller.ts) et par la suppression
 * décidée par l'administration (adminSuppression.controller.ts) : une seule
 * règle, donc pas de dérive entre les deux chemins.
 *
 * Portée (choix explicite) : biens, locataires, propriétaires, contrats,
 * factures, signalements, annonces (+ leurs demandes), états des lieux,
 * messages, journal d'activité, paramètres d'agence, historique des
 * abonnements SaaS et comptes des collaborateurs invités sont supprimés sans
 * anonymisation ni conservation. Les comptes de connexion « portail » d'un
 * locataire/propriétaire (users liés via tenants.userId / owners.userId) ne
 * sont volontairement PAS supprimés : ce sont des identités qui appartiennent
 * à ces personnes, pas à l'agence qui les gérait.
 *
 * Ordre, et pourquoi :
 *  1. Stripe — résiliation IMMÉDIATE de l'abonnement à renouvellement
 *     automatique, AVANT toute écriture. Son échec (502) annule la suppression :
 *     effacer le compte en laissant un prélèvement actif serait pire que de
 *     refuser. (Avant ce service, la suppression à la demande du gestionnaire
 *     omettait cette étape.)
 *  2. Références Supabase Storage lues AVANT la suppression des lignes qui en
 *     gardent la trace.
 *  3. Une transaction : contrats et ce qui les référence sans cascade, puis la
 *     ligne `users`, dont les ON DELETE CASCADE nettoient le reste.
 *  4. Nettoyage du stockage, best-effort, APRÈS le commit : un stockage
 *     indisponible ne doit jamais remettre en cause une suppression actée.
 *
 * Retourne la volumétrie supprimée, pour la trace d'audit de l'appelant.
 */
export async function supprimerCompteGestionnaire(user: typeof users.$inferSelect) {
  if (user.stripeSubscriptionId) await cancelStripeSubscriptionNow(user.stripeSubscriptionId);

  const [managerProperties, managerListings, managerTenants, managerContracts, managerIssues, [reglagesAgence]] = await Promise.all([
    db.select({ imageUrl: properties.imageUrl }).from(properties).where(eq(properties.managerId, user.id)),
    db.select({ imageUrl: listings.imageUrl }).from(listings).where(eq(listings.managerId, user.id)),
    db.select({ idDocument: tenants.idDocument }).from(tenants).where(eq(tenants.managerId, user.id)),
    db
      .select({ scannedContractUrl: contracts.scannedContractUrl })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(properties.managerId, user.id)),
    db
      .select({ photoUrl: issueReports.photoUrl, additionalPhotos: issueReports.additionalPhotos })
      .from(issueReports)
      .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(properties.managerId, user.id)),
    // Le logo de l'agence vit dans le bucket PUBLIC : sans nettoyage, il resterait accessible par son adresse, sans plus
    // aucune ligne en base pour le retrouver.
    db.select({ logoUrl: agencySettings.logoUrl }).from(agencySettings).where(eq(agencySettings.userId, user.id)),
  ]);
  const [{ collaborateurs }] = await db
    .select({ collaborateurs: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.teamOwnerId, user.id));

  await db.transaction(async (tx: Transaction) => {
    // contracts.propertyId / contracts.tenantId n'ont PAS de ON DELETE
    // CASCADE (voir schema.ts) : supprimer un bien ou un locataire qui porte
    // encore un contrat échouerait (violation de clé étrangère). Ces
    // contrats — et tout ce qui les référence sans cascade (invoices,
    // issueReports) — doivent donc être supprimés explicitement ici, avant
    // de s'appuyer sur les CASCADE existants pour le reste.
    const propertyRows = await tx.select({ id: properties.id }).from(properties).where(eq(properties.managerId, user.id));
    const tenantRows = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.managerId, user.id));
    const propertyIds = propertyRows.map((p: { id: string }) => p.id);
    const tenantIds = tenantRows.map((t: { id: string }) => t.id);

    const contractConditions = [];
    if (propertyIds.length > 0) contractConditions.push(inArray(contracts.propertyId, propertyIds));
    if (tenantIds.length > 0) contractConditions.push(inArray(contracts.tenantId, tenantIds));

    if (contractConditions.length > 0) {
      const contractRows = await tx.select({ id: contracts.id }).from(contracts).where(or(...contractConditions));
      const contractIds = contractRows.map((c: { id: string }) => c.id);

      if (contractIds.length > 0) {
        await tx.delete(invoices).where(inArray(invoices.contractId, contractIds));
        await tx.delete(issueReports).where(inArray(issueReports.contractId, contractIds));
        await tx.delete(contracts).where(inArray(contracts.id, contractIds));
      }
    }

    // Le reste (biens, locataires, propriétaires, annonces + leurs demandes,
    // états des lieux, messages, journal d'activité, paramètres d'agence,
    // historique des abonnements SaaS, collaborateurs) est nettoyé par les
    // contraintes ON DELETE CASCADE déjà déclarées sur users.id.
    await tx.delete(users).where(eq(users.id, user.id));
  });

  const cibles: Array<string | null | undefined> = [
    reglagesAgence?.logoUrl,
    ...managerProperties.map((p) => p.imageUrl),
    ...managerListings.map((l) => l.imageUrl),
    ...managerTenants.map((t) => t.idDocument),
    ...managerContracts.map((c) => c.scannedContractUrl),
    ...managerIssues.flatMap((i) => {
      const extras: string[] = [];
      if (i.additionalPhotos) {
        try {
          extras.push(...(JSON.parse(i.additionalPhotos) as string[]));
        } catch {
          // Champ illisible : rien à nettoyer de plus fiable que d'ignorer.
        }
      }
      return [i.photoUrl, ...extras];
    }),
  ];
  await Promise.allSettled(cibles.map((cible) => deleteStorageObjectBestEffort(cible)));

  console.log(`[account] Compte gestionnaire supprimé définitivement (id=${user.id})`);

  return {
    biens: managerProperties.length,
    locataires: managerTenants.length,
    annonces: managerListings.length,
    collaborateurs,
  };
}
