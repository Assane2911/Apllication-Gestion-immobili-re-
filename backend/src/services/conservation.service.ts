import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { activityLogs, contractCotenants, contracts, listingLeads, rateLimitHits, tenants, users } from "../db/schema";
import { jourDecale } from "../utils/dates";

/**
 * Durées de conservation.
 *
 * Repères issus du référentiel « gestion locative » de la CNIL et des
 * obligations comptables, et non d'un avis juridique : ils décrivent ce que le
 * Service SIGNALE, jamais ce qu'il détruit de sa propre initiative.
 */
export const DUREES = {
  /** Journaux d'activité — traçabilité, au-delà d'un an sans utilité. */
  journauxJours: 365,
  /**
   * Fiche locataire qu'aucun bail n'a jamais concrétisée : le référentiel
   * CNIL ramène à trois mois le dossier d'un candidat non retenu.
   */
  ficheSansBailJours: 90,
  /**
   * Après la fin d'un bail : trois ans en gestion directe, cinq en gestion
   * déléguée. On retient CINQ — le plus long des deux — parce que la
   * plateforme ignore de quelle gestion il s'agit, et qu'un signalement
   * prématuré pousserait à effacer des pièces encore utiles. Signaler trop
   * tard se corrige ; effacer trop tôt, non.
   */
  apresFinDeBailJours: 5 * 365,
  /**
   * Demande de contact/visite (listingLeads) reçue sur une annonce vitrine :
   * un prospect, pas un locataire — la recommandation CNIL en matière de
   * prospection commerciale (3 ans sans contact) s'applique, plutôt que les
   * durées propres au bail ci-dessus.
   */
  leadProspectionJours: 3 * 365,
};

/**
 * Purge automatique — strictement limitée aux données de LA PLATEFORME.
 *
 * Ce qui est effacé ici n'appartient à personne d'autre qu'au Service : des
 * jetons à usage unique déjà expirés, qui ne rouvriront jamais rien, et des
 * lignes de journal dont la valeur de traçabilité s'est éteinte. Les garder
 * n'a aucune utilité et les effacer ne prive personne de rien.
 *
 * La frontière est nette et voulue : aucune donnée locative n'est touchée.
 * Pour celles-là, le Gestionnaire est responsable de traitement et le Service
 * sous-traitant ; un sous-traitant qui détruirait de sa propre initiative les
 * données du responsable sortirait de son rôle. Et la règle de durée dépend de
 * faits que la plateforme ignore — gestion directe ou déléguée, litige en
 * cours qui suspend l'effacement. Un job qui ne connaît que des dates
 * supprimerait les pièces au milieu d'une procédure de recouvrement.
 * Voir donneesArriveesAEcheance pour ce que le Service fait à la place.
 */
export async function purgerDonneesDeLaPlateforme() {
  const maintenant = new Date();

  // Un jeton expiré ne rouvre plus rien : son empreinte ne sert qu'à occuper
  // de la place et à élargir inutilement ce qu'une fuite de base révélerait.
  const jetons = await db
    .update(users)
    .set({
      resetPasswordTokenHash: null,
      resetPasswordExpiresAt: null,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    })
    .where(
      or(
        and(isNotNull(users.resetPasswordExpiresAt), lt(users.resetPasswordExpiresAt, maintenant)),
        and(isNotNull(users.emailVerificationExpiresAt), lt(users.emailVerificationExpiresAt, maintenant))
      )
    )
    .returning({ id: users.id });

  const journaux = await db
    .delete(activityLogs)
    .where(lt(activityLogs.createdAt, jourDecale(-DUREES.journauxJours, maintenant)))
    .returning({ id: activityLogs.id });

  // Compteurs de limitation de fréquence des routes d'authentification (voir
  // middleware/rateLimitStore.ts) : une fenêtre dépassée ne sert plus à rien.
  // On garde un jour de marge — la fenêtre dure 15 minutes — pour ne jamais
  // effacer un compteur encore utile, et l'on évite ainsi que la table grossisse.
  const compteurs = await db
    .delete(rateLimitHits)
    .where(lt(rateLimitHits.resetAt, jourDecale(-1, maintenant)))
    .returning({ cle: rateLimitHits.cle });

  if (jetons.length || journaux.length) {
    console.log(
      `[conservation] ${jetons.length} jeton(s) périmé(s) effacé(s), ${journaux.length} entrée(s) de journal au-delà de ${DUREES.journauxJours} jours.`
    );
  }

  return { jetonsEffaces: jetons.length, journauxEffaces: journaux.length, compteursEfface: compteurs.length };
}

type FicheSignalee = typeof tenants.$inferSelect & { finDuDernierBail?: Date | null };

/**
 * Données d'un gestionnaire dont la durée de conservation est atteinte.
 *
 * Cette fonction ne SUPPRIME rien, et c'est son intérêt : elle rend visible ce
 * qu'une règle de durée désigne, pour que le Gestionnaire — seul à savoir si
 * un litige est en cours et de quel type de gestion il s'agit — décide lui-même
 * d'anonymiser ou de conserver. La durée cesse d'être une promesse que personne
 * n'applique, sans que le Service ne s'arroge une décision qui ne lui revient
 * pas.
 *
 * Les locataires déjà anonymisés sont exclus : il ne reste chez eux aucune
 * donnée identifiante à effacer.
 */
export async function donneesArriveesAEcheance(managerId: string) {
  const maintenant = new Date();
  const seuilFicheSansBail = jourDecale(-DUREES.ficheSansBailJours, maintenant);
  const seuilFinDeBail = jourDecale(-DUREES.apresFinDeBailJours, maintenant);
  const seuilLead = jourDecale(-DUREES.leadProspectionJours, maintenant);

  const fiches = await db
    .select({
      tenant: tenants,
      nbContrats: sql<number>`count(${contracts.id})::int`,
      aUnBailEnCours: sql<number>`sum(case when ${contracts.status} = 'ACTIVE' then 1 else 0 end)::int`,
      finDuDernierBail: sql<Date | null>`max(${contracts.endDate})`,
    })
    .from(tenants)
    .leftJoin(contracts, eq(contracts.tenantId, tenants.id))
    .where(and(eq(tenants.managerId, managerId), isNull(tenants.anonymizedAt)))
    .groupBy(tenants.id)
    .orderBy(desc(tenants.createdAt));

  // Les baux qu'un locataire OCCUPE en tant que colocataire : il n'a aucun bail à son nom, mais la relation
  // contractuelle est la même. Ne compter que les baux dont il est titulaire le faisait signaler comme
  // « fiche sans bail » alors qu'il occupe le logement — et pousser à anonymiser un occupant.
  const liensColocation = await db
    .select({ tenantId: contractCotenants.tenantId, status: contracts.status, fin: contracts.endDate })
    .from(contractCotenants)
    .innerJoin(contracts, eq(contractCotenants.contractId, contracts.id))
    .innerJoin(tenants, eq(contractCotenants.tenantId, tenants.id))
    .where(eq(tenants.managerId, managerId));
  const colocParLocataire = new Map<string, { nb: number; enCours: number; fin: Date | null }>();
  for (const l of liensColocation) {
    const cumul = colocParLocataire.get(l.tenantId) ?? { nb: 0, enCours: 0, fin: null };
    cumul.nb += 1;
    if (l.status === "ACTIVE") cumul.enCours += 1;
    const fin = l.fin ? new Date(l.fin) : null;
    if (fin && (!cumul.fin || fin > cumul.fin)) cumul.fin = fin;
    colocParLocataire.set(l.tenantId, cumul);
  }

  const fichesSansBail: FicheSignalee[] = [];
  const bauxClosDepuisLongtemps: FicheSignalee[] = [];

  for (const brute of fiches) {
    const coloc = colocParLocataire.get(brute.tenant.id);
    const finTitulaire = brute.finDuDernierBail ? new Date(brute.finDuDernierBail) : null;
    const ligne = {
      tenant: brute.tenant,
      nbContrats: brute.nbContrats + (coloc?.nb ?? 0),
      aUnBailEnCours: (brute.aUnBailEnCours ?? 0) + (coloc?.enCours ?? 0),
      finDuDernierBail: coloc?.fin && (!finTitulaire || coloc.fin > finTitulaire) ? coloc.fin : finTitulaire,
    };

    // Un bail en cours écarte toute échéance, quelle que soit l'ancienneté de
    // la fiche : la relation contractuelle est la raison même de conserver.
    if (ligne.aUnBailEnCours > 0) continue;

    if (ligne.nbContrats === 0) {
      if (new Date(ligne.tenant.createdAt) < seuilFicheSansBail) {
        fichesSansBail.push(ligne.tenant);
      }
      continue;
    }

    const fin = ligne.finDuDernierBail ? new Date(ligne.finDuDernierBail) : null;
    if (fin && fin < seuilFinDeBail) {
      bauxClosDepuisLongtemps.push({ ...ligne.tenant, finDuDernierBail: fin });
    }
  }

  // Contrairement aux fiches locataire ci-dessus, aucun état n'écarte une
  // échéance : un lead "NEW" oublié depuis 3 ans n'est pas moins un prospect
  // qu'il faut cesser de démarcher qu'un lead "CONVERTED" du même âge — voir
  // exportDonnees.service.ts pour l'équivalent côté locataire, dont ces
  // demandes de contact ne relèvent pas (un prospect n'est jamais devenu
  // locataire, donc jamais titulaire d'un compte).
  const leadsAnciens = await db
    .select()
    .from(listingLeads)
    .where(and(eq(listingLeads.managerId, managerId), lt(listingLeads.createdAt, seuilLead)))
    .orderBy(desc(listingLeads.createdAt));

  return {
    calculeLe: maintenant.toISOString(),
    durees: DUREES,
    fichesSansBail,
    bauxClosDepuisLongtemps,
    leadsAnciens,
    total: fichesSansBail.length + bauxClosDepuisLongtemps.length + leadsAnciens.length,
  };
}
