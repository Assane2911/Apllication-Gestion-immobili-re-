import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { agendaFeeds, users } from "../db/schema";
import { abonnementEnCours } from "../middleware/auth";
import { hashToken } from "../utils/token";
import { chargerAgenda, JOURS_AGENDA_MAX } from "./agenda.service";
import { genererIcs } from "./agendaIcal.service";
import { langueOuDefaut } from "../utils/langue";

/**
 * Lien d'abonnement au calendrier de l'agenda. Un calendrier externe lit le flux sans pouvoir se connecter : le lien est le
 * secret. Il est aléatoire (256 bits), seule son empreinte est gardée, et il n'est affiché qu'à sa création : le régénérer
 * invalide l'ancien, le désactiver supprime la ligne.
 */

/** 32 octets en base64url : 43 caractères. Le format est vérifié avant toute lecture en base. */
const FORMAT_JETON = /^[A-Za-z0-9_-]{43}$/;

/** On ne réécrit pas « dernière lecture » à chaque passage d'un calendrier qui interroge toutes les heures. */
const PAS_MINIMUM_DERNIERE_LECTURE_MS = 60 * 60 * 1000;

export interface EtatLien {
  active: boolean;
  createdAt: Date | null;
  lastUsedAt: Date | null;
  /** Le calendrier externe n'affiche pas le nom des locataires. Faux tant qu'il n'y a pas de lien. */
  hideTenantNames: boolean;
}

export async function etatDuLien(managerId: string): Promise<EtatLien> {
  const [ligne] = await db.select().from(agendaFeeds).where(eq(agendaFeeds.managerId, managerId));
  return ligne
    ? { active: true, createdAt: ligne.createdAt, lastUsedAt: ligne.lastUsedAt, hideTenantNames: ligne.hideTenantNames }
    : { active: false, createdAt: null, lastUsedAt: null, hideTenantNames: false };
}

/**
 * Règle le masquage des noms de locataires du calendrier. Sans lien, rien n'est écrit (le réglage appartient au lien) et l'état
 * « inactif » est simplement renvoyé. Le réglage est conservé quand on régénère le lien.
 */
export async function definirMasquageLocataires(managerId: string, masquer: boolean): Promise<EtatLien> {
  await db.update(agendaFeeds).set({ hideTenantNames: masquer, updatedAt: new Date() }).where(eq(agendaFeeds.managerId, managerId));
  return etatDuLien(managerId);
}

/** Crée le lien de l'agence, ou en génère un nouveau qui remplace (et invalide) le précédent. Renvoie le jeton, à ne montrer qu'une fois. */
export async function genererLien(managerId: string): Promise<{ token: string; createdAt: Date; hideTenantNames: boolean }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const maintenant = new Date();
  await db
    .insert(agendaFeeds)
    .values({ managerId, tokenHash: hashToken(token), lastUsedAt: null, createdAt: maintenant, updatedAt: maintenant })
    .onConflictDoUpdate({
      target: agendaFeeds.managerId,
      set: { tokenHash: hashToken(token), lastUsedAt: null, createdAt: maintenant, updatedAt: maintenant },
    });
  // Le réglage de masquage n'est pas touché par l'upsert : on relit la valeur conservée.
  const [ligne] = await db.select({ hideTenantNames: agendaFeeds.hideTenantNames }).from(agendaFeeds).where(eq(agendaFeeds.managerId, managerId));
  return { token, createdAt: maintenant, hideTenantNames: ligne?.hideTenantNames ?? false };
}

export async function supprimerLien(managerId: string): Promise<void> {
  await db.delete(agendaFeeds).where(eq(agendaFeeds.managerId, managerId));
}

/**
 * Le calendrier (texte iCal) que le jeton donne à lire, ou null si le jeton est inconnu, révoqué, d'une agence suspendue ou
 * d'un compte dont l'abonnement est échu. Un seul refus pour tous ces cas : rien ne dit à qui essaie des jetons lequel existe.
 */
export async function calendrierDuJeton(token: string, maintenant: Date = new Date()): Promise<string | null> {
  if (!FORMAT_JETON.test(token)) return null;

  const [ligne] = await db
    .select({ feed: agendaFeeds, manager: users })
    .from(agendaFeeds)
    .innerJoin(users, eq(agendaFeeds.managerId, users.id))
    .where(eq(agendaFeeds.tokenHash, hashToken(token)));
  if (!ligne) return null;
  if (ligne.manager.suspendedAt) return null;
  if (!abonnementEnCours(ligne.manager, maintenant)) return null;

  const derniere = ligne.feed.lastUsedAt?.getTime() ?? 0;
  if (maintenant.getTime() - derniere >= PAS_MINIMUM_DERNIERE_LECTURE_MS) {
    // Un échec d'écriture de la « dernière lecture » ne doit jamais empêcher le calendrier de se mettre à jour.
    await db
      .update(agendaFeeds)
      .set({ lastUsedAt: maintenant })
      .where(eq(agendaFeeds.managerId, ligne.feed.managerId))
      .catch(() => undefined);
  }

  const chargees = await chargerAgenda(ligne.feed.managerId, JOURS_AGENDA_MAX, maintenant);
  // Le nom du locataire est retiré à la source, avant la mise en forme : il ne peut alors figurer nulle part dans le fichier.
  const evenements = ligne.feed.hideTenantNames ? chargees.map((e) => ({ ...e, tenantName: null })) : chargees;
  return genererIcs(evenements, { langue: langueOuDefaut(ligne.manager.language), maintenant });
}
