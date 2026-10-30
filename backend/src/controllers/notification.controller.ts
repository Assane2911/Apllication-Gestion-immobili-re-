import { and, eq, gte, inArray, isNull, lte, max, notInArray, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, invoices, issueReports, listingLeads, listings, messages, notificationVues, properties, tenants } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { bauxDuLocataire } from "../services/colocation.service";
import { TEXTES_NOTIFICATION } from "../services/notification.textes";
import { idLocataireDuCompte } from "../utils/authorization";
import { formaterMontant } from "../utils/montant";
import { resteDu } from "../utils/montants";
import { formaterDate, langueDeLaRequete, type Langue } from "../utils/langue";

export type NotificationType = "message" | "invoice" | "issue" | "contract_ending" | "lead";
export type NotificationSeverity = "info" | "warning" | "danger";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  link: string;
  createdAt: string;
}

// Fenêtre d'anticipation pour signaler un contrat qui arrive à échéance dans
// le centre de notifications — plus large que le rappel email automatique
// (voir CONTRACT_REMINDER_DAYS) pour donner de la visibilité en amont.
const CONTRACT_ENDING_WINDOW_DAYS = 14;

/**
 * Centre de notifications du gestionnaire : agrège en un seul flux les
 * éléments qui nécessitent son attention (messages non lus des locataires,
 * factures en retard, signalements d'incidents ouverts, contrats arrivant à
 * échéance). Calculé à la volée à partir de l'état actuel des données plutôt
 * que stocké dans une table dédiée — plus simple et toujours à jour.
 */
async function calculerNotificationsGestionnaire(managerId: string, langue: Langue): Promise<NotificationItem[]> {
  const notifications: NotificationItem[] = [];
  const t = TEXTES_NOTIFICATION[langue];

  // Chaque requête ne lit que les colonnes dont la notification a besoin : la cloche est interrogée toutes les 30 s
  // par chaque onglet ouvert, et les lignes entières de quatre tables jointes (dont des champs longs) n'y servent à rien.

  // --- Messages non lus envoyés par les locataires ---
  // Le filtre isRead=false est porté par le SQL, pas par une boucle JS après
  // coup : sans lui, cette requête chargeait l'intégralité de l'historique
  // des messages de l'agence (des années de conversations, la quasi-totalité
  // déjà lus) à chaque affichage du centre de notifications, pour n'en
  // retenir qu'une poignée. Le regroupement par fil est fait par la base : une
  // ligne par fil, quel que soit le nombre de messages en attente.
  const unreadRows = await db
    .select({
      contractId: contracts.id,
      titulaireId: contracts.tenantId,
      tenantId: tenants.id,
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      propertyTitle: properties.title,
      count: sql<number>`count(*)::int`,
      latest: max(messages.createdAt),
    })
    .from(messages)
    .innerJoin(contracts, eq(messages.contractId, contracts.id))
    // Le locataire du fil (titulaire ou colocataire) ; une ligne non rattachée est au titulaire.
    .innerJoin(tenants, sql`${tenants.id} = coalesce(${messages.tenantId}, ${contracts.tenantId})`)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(messages.senderRole, "TENANT"), eq(messages.isRead, false), eq(properties.managerId, managerId)))
    .groupBy(contracts.id, contracts.tenantId, tenants.id, tenants.firstName, tenants.lastName, properties.title);

  for (const r of unreadRows) {
    // Un fil par locataire : le titulaire garde la clé historique (le bail seul), pour que les
    // notifications déjà vues ne réapparaissent pas.
    const key = r.tenantId === r.titulaireId ? r.contractId : `${r.contractId}-${r.tenantId}`;
    notifications.push({
      id: `message-${key}`,
      type: "message",
      severity: "info",
      title: t.messagesDuLocataire(r.count, `${r.firstName} ${r.lastName}`),
      description: r.propertyTitle,
      link: "/messages",
      createdAt: new Date(r.latest!).toISOString(),
    });
  }

  // --- Factures en retard ---
  // Une ligne par BAIL, pas par mois : un loyer impayé depuis neuf mois remplissait la cloche de neuf lignes identiques.
  // Un seul loyer en retard garde sa clé et son texte d'avant (la notification déjà vue ne réapparaît pas) ; à partir de
  // deux, la ligne regroupe les échéances et le reste dû. Sa date est celle de la plus récente échéance en retard : un
  // nouveau mois qui passe en retard produit une clé jamais vue, donc une vraie nouveauté.
  const lateInvoiceRows = await db
    .select({
      id: invoices.id,
      contractId: invoices.contractId,
      dueDate: invoices.dueDate,
      amount: invoices.amount,
      amountPaid: invoices.amountPaid,
      currency: invoices.currency,
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      propertyTitle: properties.title,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(invoices.status, "LATE"), eq(properties.managerId, managerId)));

  const retardsParBail = new Map<string, typeof lateInvoiceRows>();
  for (const r of lateInvoiceRows) retardsParBail.set(r.contractId, [...(retardsParBail.get(r.contractId) ?? []), r]);

  for (const lignes of retardsParBail.values()) {
    const parEcheance = [...lignes].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    const premiere = parEcheance[0];
    const derniere = parEcheance[parEcheance.length - 1];
    const nom = `${derniere.firstName} ${derniere.lastName}`;
    if (parEcheance.length === 1) {
      notifications.push({
        id: `invoice-${derniere.id}`,
        type: "invoice",
        severity: "danger",
        title: t.loyerEnRetard(nom),
        description: t.echeanceDuBien(derniere.propertyTitle, formaterDate(derniere.dueDate, langue, t.optionsDate)),
        link: "/invoices",
        createdAt: new Date(derniere.dueDate).toISOString(),
      });
      continue;
    }
    // Le reste dû, devise par devise : un bail peut avoir des factures dans deux devises, qu'on ne somme jamais.
    const parDevise = new Map<string, number>();
    for (const l of parEcheance) parDevise.set(l.currency, (parDevise.get(l.currency) ?? 0) + resteDu({ status: "LATE", amount: l.amount, amountPaid: l.amountPaid }));
    const total = [...parDevise.entries()].map(([devise, montant]) => formaterMontant(montant, devise, langue)).join(" + ");
    notifications.push({
      id: `invoices-${derniere.contractId}`,
      type: "invoice",
      severity: "danger",
      title: t.loyersEnRetard(parEcheance.length, nom),
      description: t.echeancesDuBien(
        derniere.propertyTitle,
        formaterDate(premiere.dueDate, langue, t.optionsDate),
        formaterDate(derniere.dueDate, langue, t.optionsDate),
        total
      ),
      link: "/invoices",
      createdAt: new Date(derniere.dueDate).toISOString(),
    });
  }

  // --- Signalements d'incidents ouverts ---
  const openIssueRows = await db
    .select({ id: issueReports.id, title: issueReports.title, createdAt: issueReports.createdAt, firstName: tenants.firstName, lastName: tenants.lastName, propertyTitle: properties.title })
    .from(issueReports)
    .innerJoin(tenants, eq(issueReports.tenantId, tenants.id))
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(issueReports.status, "OPEN"), eq(properties.managerId, managerId)));

  for (const r of openIssueRows) {
    notifications.push({
      id: `issue-${r.id}`,
      type: "issue",
      severity: "warning",
      title: t.signalement(r.title),
      description: `${r.propertyTitle} · ${r.firstName} ${r.lastName}`,
      link: "/issues",
      createdAt: new Date(r.createdAt).toISOString(),
    });
  }

  // --- Demandes reçues via la vitrine publique, pas encore traitées ---
  // C'est la seule écriture sans compte du service : sans signalement, une demande de visite dormait dans le CRM
  // tant que le gestionnaire n'ouvrait pas cette page.
  const nouvellesDemandes = await db
    .select({ id: listingLeads.id, requestType: listingLeads.requestType, prospectName: listingLeads.prospectName, createdAt: listingLeads.createdAt, listingTitle: listings.title })
    .from(listingLeads)
    .innerJoin(listings, eq(listingLeads.listingId, listings.id))
    .where(and(eq(listingLeads.status, "NEW"), eq(listingLeads.managerId, managerId)));

  for (const r of nouvellesDemandes) {
    notifications.push({
      id: `lead-${r.id}`,
      type: "lead",
      severity: "info",
      title: r.requestType === "INFO" ? t.demandeInformation(r.prospectName) : t.demandeVisite(r.prospectName),
      description: r.listingTitle,
      link: "/leads",
      createdAt: new Date(r.createdAt).toISOString(),
    });
  }

  // --- Contrats arrivant à échéance ---
  // La fenêtre est portée par le SQL : seuls les baux qui se terminent dans les prochains jours sont lus, pas tous
  // les baux actifs de l'agence.
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + CONTRACT_ENDING_WINDOW_DAYS);

  const activeContractRows = await db
    .select({ id: contracts.id, endDate: contracts.endDate, firstName: tenants.firstName, lastName: tenants.lastName, propertyTitle: properties.title })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(contracts.status, "ACTIVE"), eq(properties.managerId, managerId), gte(contracts.endDate, now), lte(contracts.endDate, windowEnd)));

  for (const r of activeContractRows) {
    const endDate = new Date(r.endDate);
    const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    notifications.push({
      id: `contract-${r.id}`,
      type: "contract_ending",
      severity: daysLeft <= 7 ? "danger" : "warning",
      title: t.contratSeTermine(daysLeft),
      description: `${r.propertyTitle} · ${r.firstName} ${r.lastName}`,
      link: "/contracts",
      createdAt: endDate.toISOString(),
    });
  }

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return notifications;
}

/**
 * Centre de notifications du locataire (Espace résident) : même principe que
 * getNotifications côté gestionnaire — calculé à la volée, jamais stocké —
 * mais scopé à SES PROPRES contrats et limité à ce qui le concerne
 * directement : messages non lus envoyés par le gestionnaire, loyers à régler
 * (en retard, ou bientôt dus — même fenêtre que le rappel email automatique,
 * `env.reminder.rentDueSoonDays`), et bail arrivant à échéance.
 *
 * Volontairement SANS les signalements d'incidents : contrairement au
 * gestionnaire, qui doit être alerté d'un nouveau signalement, le locataire
 * qui l'a lui-même déposé n'a besoin d'aucun rappel pour une action qu'il a
 * déjà effectuée — il consulte son statut depuis la page Incidents.
 */
async function calculerNotificationsLocataire(tenantId: string, langue: Langue): Promise<NotificationItem[]> {
  const notifications: NotificationItem[] = [];
  const t = TEXTES_NOTIFICATION[langue];

  // --- Messages non lus envoyés par le gestionnaire ---
  // Seuls le nombre et la date du dernier comptent : la base les calcule, au lieu de renvoyer chaque message.
  const [unread] = await db
    .select({ count: sql<number>`count(*)::int`, latest: max(messages.createdAt) })
    .from(messages)
    .innerJoin(contracts, eq(messages.contractId, contracts.id))
    .where(
      and(
        // Son fil : rattaché à sa fiche, ou ancienne ligne non rattachée d'un bail dont il est titulaire.
        or(eq(messages.tenantId, tenantId), and(isNull(messages.tenantId), eq(contracts.tenantId, tenantId))),
        eq(messages.senderRole, "MANAGER"),
        eq(messages.isRead, false)
      )
    );

  if (unread.count > 0) {
    notifications.push({
      id: "message-mine",
      type: "message",
      severity: "info",
      title: t.messagesDuGestionnaire(unread.count),
      description: t.consulterMessagerie,
      link: "/portail/messages",
      createdAt: new Date(unread.latest!).toISOString(),
    });
  }

  // --- Loyers à régler (en retard, ou bientôt dus) ---
  const now = new Date();
  const dueSoonWindowEnd = new Date(now);
  dueSoonWindowEnd.setDate(dueSoonWindowEnd.getDate() + env.reminder.rentDueSoonDays);

  // Les baux qu'il OCCUPE, titulaire ou colocataire : un colocataire voit ce bail et ses factures dans
  // son portail, il doit aussi être prévenu d'un loyer en retard ou de la fin du bail.
  const idsBaux = [...(await bauxDuLocataire(tenantId)).keys()];

  // En retard, quelle que soit l'ancienneté ; en attente, seulement si l'échéance tombe dans la fenêtre « bientôt dus ».
  const invoiceRows =
    idsBaux.length === 0
      ? []
      : await db
          .select({ id: invoices.id, status: invoices.status, dueDate: invoices.dueDate })
          .from(invoices)
          .where(
            and(
              inArray(invoices.contractId, idsBaux),
              or(eq(invoices.status, "LATE"), and(eq(invoices.status, "PENDING"), gte(invoices.dueDate, now), lte(invoices.dueDate, dueSoonWindowEnd)))
            )
          );

  for (const r of invoiceRows) {
    const estEnRetard = r.status === "LATE";
    notifications.push({
      id: `invoice-${r.id}`,
      type: "invoice",
      severity: estEnRetard ? "danger" : "warning",
      title: estEnRetard ? t.loyerEnRetardLocataire : t.loyerBientotDu,
      description: t.echeance(formaterDate(r.dueDate, langue, t.optionsDate)),
      link: "/portail/paiements",
      createdAt: new Date(r.dueDate).toISOString(),
    });
  }

  // --- Bail arrivant à échéance ---
  // Fenêtre plus large que celle des loyers "bientôt dus" ci-dessus (3 jours,
  // trop courte pour un bail) : on reprend celle du centre de notifications
  // du gestionnaire (CONTRACT_ENDING_WINDOW_DAYS), pensée pour ça.
  const contractEndingWindowEnd = new Date(now);
  contractEndingWindowEnd.setDate(contractEndingWindowEnd.getDate() + CONTRACT_ENDING_WINDOW_DAYS);

  const activeContractRows =
    idsBaux.length === 0
      ? []
      : await db
          .select({ id: contracts.id, endDate: contracts.endDate })
          .from(contracts)
          .where(and(inArray(contracts.id, idsBaux), eq(contracts.status, "ACTIVE"), gte(contracts.endDate, now), lte(contracts.endDate, contractEndingWindowEnd)));

  for (const r of activeContractRows) {
    const endDate = new Date(r.endDate);
    const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    notifications.push({
      id: `contract-${r.id}`,
      type: "contract_ending",
      severity: daysLeft <= 7 ? "danger" : "warning",
      title: t.bailSeTermine(daysLeft),
      description: t.contacterGestionnaire,
      link: "/portail",
      createdAt: endDate.toISOString(),
    });
  }

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return notifications;
}

/**
 * --- État « vu » ---
 *
 * Les notifications sont recalculées à chaque appel : sans autre information,
 * une facture en retard restait « nouvelle » et gardait le badge allumé tant
 * qu'elle n'était pas payée, même après ouverture de la cloche. On retient donc,
 * par personne, quelles notifications elle a déjà vues (table notification_vues).
 *
 * La clé d'une notification est son identifiant ET la date de l'événement : un
 * nouveau message d'un locataire, un nouvel incident ou une nouvelle échéance
 * produit une clé jamais vue, donc une vraie nouveauté. (Le titre n'entre pas
 * dans la clé : « se termine dans N jours » changerait chaque jour.)
 *
 * L'état est celui de la PERSONNE qui consulte : pour un collaborateur,
 * req.user.userId porte l'id du propriétaire de l'agence, `collaboratorId` le
 * sien — sans ça, un collaborateur qui ouvre la cloche la marquerait vue pour
 * tout le monde.
 */
const cleDe = (n: NotificationItem) => `${n.id}|${n.createdAt}`;
const lecteurDe = (req: Request) => req.user!.collaboratorId ?? req.user!.userId;

async function repondreAvecEtatVu(req: Request, res: Response, notifications: NotificationItem[]) {
  const cles = notifications.map(cleDe);
  const vues = new Set<string>();
  const lues = new Set<string>();
  if (cles.length > 0) {
    const lignes = await db
      .select({ cle: notificationVues.cle, readAt: notificationVues.readAt })
      .from(notificationVues)
      .where(and(eq(notificationVues.userId, lecteurDe(req)), inArray(notificationVues.cle, cles)));
    for (const l of lignes) {
      vues.add(l.cle);
      if (l.readAt) lues.add(l.cle);
    }
  }
  const items = notifications.map((n) => ({
    ...n,
    key: cleDe(n),
    seen: vues.has(cleDe(n)),
    read: lues.has(cleDe(n)),
  }));
  res.json({
    notifications: items,
    count: items.length,
    unseenCount: items.filter((n) => !n.seen).length,
    unreadCount: items.filter((n) => !n.read).length,
  });
}

// La cloche envoie TOUTES les clés qu'elle affiche : une limite basse (200) rendait impossible d'éteindre le badge
// d'une agence qui a plus de notifications que cela. 5000 laisse une large marge tout en bornant le corps de requête.
const markSeenSchema = z.object({ keys: z.array(z.string().max(300)).max(5000).optional() });

/**
 * Marque des notifications comme vues (ou, avec `commeLues`, comme LUES : le
 * bouton « Tout marquer comme lu », qui les écarte du panneau). `keys` = celles que la personne avait
 * sous les yeux (une notification arrivée entre-temps reste donc « nouvelle ») ;
 * absent, toutes les notifications actuelles. Seules les clés qui existent
 * réellement MAINTENANT sont retenues : le client ne peut rien inscrire d'autre,
 * et les lignes devenues sans objet (facture payée, message lu...) sont purgées
 * au passage, la table ne grossit pas.
 */
async function marquerVues(
  req: Request,
  res: Response,
  notifications: NotificationItem[],
  commeLues = false
) {
  const { keys } = markSeenSchema.parse(req.body ?? {});
  const courantes = notifications.map(cleDe);
  const demandees = keys ? new Set(keys) : null;
  const aMarquer = demandees ? courantes.filter((c) => demandees.has(c)) : courantes;
  const lecteur = lecteurDe(req);

  if (aMarquer.length > 0) {
    const insertion = db.insert(notificationVues).values(
      aMarquer.map((cle) => ({ userId: lecteur, cle, ...(commeLues ? { readAt: new Date() } : {}) }))
    );
    // « Vue » est posée une fois et ne bouge plus ; « lue » s'ajoute à une ligne
    // déjà vue sans réécrire une lecture plus ancienne (COALESCE).
    await (commeLues
      ? insertion.onConflictDoUpdate({
          target: [notificationVues.userId, notificationVues.cle],
          set: { readAt: sql`COALESCE(${notificationVues.readAt}, excluded.read_at)` },
        })
      : insertion.onConflictDoNothing());
  }
  await db
    .delete(notificationVues)
    .where(
      courantes.length > 0
        ? and(eq(notificationVues.userId, lecteur), notInArray(notificationVues.cle, courantes))
        : eq(notificationVues.userId, lecteur)
    );

  res.json({ success: true });
}

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  await repondreAvecEtatVu(req, res, await calculerNotificationsGestionnaire(req.user!.userId, langueDeLaRequete(req)));
});

export const markNotificationsSeen = asyncHandler(async (req: Request, res: Response) => {
  await marquerVues(req, res, await calculerNotificationsGestionnaire(req.user!.userId, langueDeLaRequete(req)));
});

export const markNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await marquerVues(req, res, await calculerNotificationsGestionnaire(req.user!.userId, langueDeLaRequete(req)), true);
});

async function idLocataireOu403(req: Request): Promise<string> {
  const tenantId = await idLocataireDuCompte(req);
  if (!tenantId) throw new ApiError(403, "Aucune fiche locataire n'est rattachée à ce compte.", "TENANT_NOT_LINKED");
  return tenantId;
}

export const getTenantNotifications = asyncHandler(async (req: Request, res: Response) => {
  await repondreAvecEtatVu(req, res, await calculerNotificationsLocataire(await idLocataireOu403(req), langueDeLaRequete(req)));
});

export const markTenantNotificationsSeen = asyncHandler(async (req: Request, res: Response) => {
  await marquerVues(req, res, await calculerNotificationsLocataire(await idLocataireOu403(req), langueDeLaRequete(req)));
});

export const markTenantNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await marquerVues(req, res, await calculerNotificationsLocataire(await idLocataireOu403(req), langueDeLaRequete(req)), true);
});
