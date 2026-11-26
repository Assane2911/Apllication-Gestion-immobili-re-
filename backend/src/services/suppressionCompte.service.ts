import { and, eq, inArray, isNotNull, ne, notExists, or, sql } from "drizzle-orm";
import { db, Transaction } from "../db/client";
import { agencySettings, contracts, invoices, issueReports, leaseNotices, listings, messages, owners, ownerMessages, platformSubscriptions, properties, storedDocuments, suggestions, tenants, users } from "../db/schema";
import { cancelStripeSubscriptionNow } from "./payment.service";
import { deleteStorageObjectBestEffort } from "./storage.service";

const TAILLE_LOT_COMPTES = 1000;

/** Comptes de connexion « portail » (locataire ou propriétaire) que les fiches de cette agence rattachent. */
async function comptesPortailDeLAgence(managerId: string): Promise<string[]> {
  const [locataires, proprietaires] = await Promise.all([
    db.select({ userId: tenants.userId }).from(tenants).where(and(eq(tenants.managerId, managerId), isNotNull(tenants.userId))),
    db.select({ userId: owners.userId }).from(owners).where(and(eq(owners.managerId, managerId), isNotNull(owners.userId))),
  ]);
  const identifiants = new Set<string>();
  for (const ligne of [...locataires, ...proprietaires]) if (ligne.userId) identifiants.add(ligne.userId);
  return [...identifiants];
}

/**
 * Condition de suppression d'un lot de comptes portail : de rôle locataire ou propriétaire (jamais un gestionnaire,
 * un administrateur ou un collaborateur), et qu'AUCUNE fiche — de cette agence ou d'une autre — ne rattache plus.
 */
function comptesPortailOrphelins(identifiants: string[]) {
  return and(
    inArray(users.id, identifiants),
    inArray(users.role, ["TENANT", "OWNER"]),
    notExists(db.select({ un: sql`1` }).from(tenants).where(eq(tenants.userId, users.id))),
    notExists(db.select({ un: sql`1` }).from(owners).where(eq(owners.userId, users.id)))
  );
}

/**
 * Suppression définitive d'un compte gestionnaire propriétaire et de TOUT ce
 * qui appartient à son agence. Partagée par la suppression à la demande du
 * gestionnaire (deleteMyAccount, auth.controller.ts) et par la suppression
 * décidée par l'administration (adminSuppression.controller.ts) : une seule
 * règle, donc pas de dérive entre les deux chemins.
 *
 * Portée (choix explicite) : biens, locataires, propriétaires, contrats,
 * factures, signalements, annonces (+ leurs demandes), états des lieux,
 * messages, journal d'activité, paramètres d'agence, suggestions de leurs
 * auteurs et comptes des collaborateurs invités sont supprimés sans
 * anonymisation ni conservation.
 *
 * Exception : les paiements d'abonnement ENCAISSÉS (statut PAID) sont des
 * pièces comptables, à conserver pendant la durée légale (10 ans) même après la
 * clôture du compte. Ils sont conservés ANONYMISÉS : la clé étrangère
 * `platform_subscriptions.user_id` (ON DELETE SET NULL) coupe le lien avec le
 * compte, et il ne reste que plan, montant, devise, période, moyen et référence
 * de paiement. Les demandes jamais encaissées (en attente, rejetée)
 * n'ont aucune valeur comptable : elles sont supprimées.
 *
 * Les comptes de connexion « portail » d'un locataire/propriétaire (users liés
 * via tenants.userId / owners.userId) que CETTE agence était seule à rattacher
 * partent avec elle : une fois toutes les fiches de l'agence effacées, ces
 * comptes (adresse e-mail, empreinte du mot de passe) ne serviraient plus à rien
 * et personne n'aurait plus de moyen d'en demander l'effacement. Un compte
 * encore rattaché à une fiche d'une autre agence est conservé, ainsi que tout
 * compte d'un autre rôle (jamais « portail »). Voir comptesPortailOrphelins.
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

  const [managerAudios, ownerAudios, managerProperties, managerListings, managerTenants, managerContracts, managerIssues, [reglagesAgence], managerDocuments, managerNotices] = await Promise.all([
    // Les messages vocaux : leurs fichiers vivent dans le stockage privé, hors de portée des suppressions en cascade.
    db
      .select({ audioPath: messages.audioPath })
      .from(messages)
      .innerJoin(contracts, eq(messages.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(properties.managerId, user.id), isNotNull(messages.audioPath))),
    // Idem pour la discussion avec les propriétaires (leurs lignes partent avec les fiches, par cascade).
    db.select({ audioPath: ownerMessages.audioPath }).from(ownerMessages).where(and(eq(ownerMessages.managerId, user.id), isNotNull(ownerMessages.audioPath))),
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
    // Le logo et le tampon de l'agence vivent dans le bucket PUBLIC : sans nettoyage, ils resteraient accessibles par
    // leur adresse, sans plus aucune ligne en base pour les retrouver.
    db.select({ logoUrl: agencySettings.logoUrl, stampOrSignatureUrl: agencySettings.stampOrSignatureUrl }).from(agencySettings).where(eq(agencySettings.userId, user.id)),
    // Les documents rangés (diagnostics, pièces, justificatifs) : privés, donc hors de portée des cascades.
    db.select({ filePath: storedDocuments.filePath }).from(storedDocuments).where(eq(storedDocuments.managerId, user.id)),
    // Les scans des congés (acte d'huissier, lettre, accusé de réception) : privés eux aussi, et nommant le locataire. Les
    // lignes partent avec les baux ; sans cette lecture préalable, leurs fichiers survivaient à une suppression « définitive ».
    db
      .select({ documentUrl: leaseNotices.documentUrl })
      .from(leaseNotices)
      .innerJoin(contracts, eq(leaseNotices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(properties.managerId, user.id), isNotNull(leaseNotices.documentUrl))),
  ]);
  const [{ collaborateurs }] = await db
    .select({ collaborateurs: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.teamOwnerId, user.id));
  // Lus AVANT la transaction : les fiches qui les référencent disparaissent avec le compte de l'agence.
  const comptesPortail = await comptesPortailDeLAgence(user.id);

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

    // Le rattachement à users.id n'est pas une clé étrangère : les documents rangés sont supprimés explicitement.
    await tx.delete(storedDocuments).where(eq(storedDocuments.managerId, user.id));

    // Les suggestions recopient l'adresse e-mail de leur auteur (authorLabel) et survivraient à son compte : la clé étrangère
    // passe seulement authorId à NULL. Elles partent avec les comptes qui disparaissent (le gestionnaire, ses collaborateurs et les
    // comptes portail orphelins), AVANT la suppression de ces comptes, tant que le lien existe encore.
    const auteursSupprimes = new Set<string>([user.id]);
    const collaborateursRows = await tx.select({ id: users.id }).from(users).where(eq(users.teamOwnerId, user.id));
    for (const ligne of collaborateursRows as { id: string }[]) auteursSupprimes.add(ligne.id);
    for (let i = 0; i < comptesPortail.length; i += TAILLE_LOT_COMPTES) {
      const orphelins = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, comptesPortail.slice(i, i + TAILLE_LOT_COMPTES)),
            inArray(users.role, ["TENANT", "OWNER"]),
            // Les fiches de CETTE agence partent avec elle : seules celles des autres agences gardent un compte en vie.
            notExists(db.select({ un: sql`1` }).from(tenants).where(and(eq(tenants.userId, users.id), ne(tenants.managerId, user.id)))),
            notExists(db.select({ un: sql`1` }).from(owners).where(and(eq(owners.userId, users.id), ne(owners.managerId, user.id))))
          )
        );
      for (const ligne of orphelins as { id: string }[]) auteursSupprimes.add(ligne.id);
    }
    const auteurs = [...auteursSupprimes];
    for (let i = 0; i < auteurs.length; i += TAILLE_LOT_COMPTES) {
      await tx.delete(suggestions).where(inArray(suggestions.authorId, auteurs.slice(i, i + TAILLE_LOT_COMPTES)));
    }

    // Demandes d'abonnement jamais encaissées : sans valeur comptable, elles partent avec le compte. Les paiements encaissés
    // (PAID) restent, et la clé étrangère ON DELETE SET NULL les anonymise à la suppression de la ligne users ci-dessous.
    await tx.delete(platformSubscriptions).where(and(eq(platformSubscriptions.userId, user.id), ne(platformSubscriptions.status, "PAID")));

    // Le reste (biens, locataires, propriétaires, annonces + leurs demandes,
    // états des lieux, messages, journal d'activité, paramètres d'agence,
    // collaborateurs) est nettoyé par les contraintes ON DELETE CASCADE déjà
    // déclarées sur users.id.
    await tx.delete(users).where(eq(users.id, user.id));

    // Les fiches de l'agence ont disparu avec elle (cascade) : un compte portail qu'aucune autre fiche ne rattache
    // est désormais orphelin. Par lots, pour qu'un grand portefeuille ne dépasse pas le plafond de paramètres.
    for (let i = 0; i < comptesPortail.length; i += TAILLE_LOT_COMPTES) {
      await tx.delete(users).where(comptesPortailOrphelins(comptesPortail.slice(i, i + TAILLE_LOT_COMPTES)));
    }
  });

  const cibles: Array<string | null | undefined> = [
    reglagesAgence?.logoUrl,
    reglagesAgence?.stampOrSignatureUrl,
    ...managerProperties.map((p) => p.imageUrl),
    ...managerListings.map((l) => l.imageUrl),
    ...managerTenants.map((t) => t.idDocument),
    ...managerContracts.map((c) => c.scannedContractUrl),
    ...managerDocuments.map((d: { filePath: string }) => d.filePath),
    ...managerNotices.map((n: { documentUrl: string | null }) => n.documentUrl),
    ...managerAudios.map((m: { audioPath: string | null }) => m.audioPath),
    ...ownerAudios.map((m: { audioPath: string | null }) => m.audioPath),
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
