import { createId } from "@paralleldrive/cuid2";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { testDb } from "./setupTestDb";
import { contracts, inspections, invoices, owners, platformSubscriptions, properties, tenants, users } from "../db/schema";

/**
 * Construit un buffer commençant par la vraie signature magique JPEG
 * (FF D8 FF), pour les tests d'upload : depuis le correctif de
 * middleware/upload.ts (vérification du contenu réel du fichier, pas
 * seulement du Content-Type déclaré), un buffer de test qui ne contient
 * pas ces trois octets est désormais rejeté (400) même s'il est déclaré
 * comme "image/jpeg". Le texte fourni n'a plus valeur d'image réelle, mais
 * reste utile pour distinguer plusieurs fichiers de test entre eux.
 */
export function fakeJpegBuffer(label: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(label)]);
}

/** Crée un gestionnaire (email déjà vérifié, essai en cours) directement en base de test. */
export async function createManager(overrides: Partial<typeof users.$inferInsert> = {}) {
  const id = overrides.id ?? createId();
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const [user] = await testDb
    .insert(users)
    .values({
      id,
      email: `manager-${id}@test.local`,
      passwordHash,
      role: "MANAGER" as const,
      subscriptionStatus: "TRIAL" as const,
      subscriptionPlan: "STARTER" as const,
      trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  return user;
}

/** Crée un administrateur de la plateforme directement en base de test. */
export async function createAdmin(overrides: Partial<typeof users.$inferInsert> = {}) {
  const id = overrides.id ?? createId();
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const [user] = await testDb
    .insert(users)
    .values({
      id,
      email: `admin-${id}@test.local`,
      passwordHash,
      role: "ADMIN" as const,
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  return user;
}

/** Crée un bien pour un gestionnaire donné. */
export async function createProperty(managerId: string, overrides: Partial<typeof properties.$inferInsert> = {}) {
  const [property] = await testDb
    .insert(properties)
    .values({
      managerId,
      title: "Appartement Test",
      address: "1 rue du Test",
      surface: 50,
      rent: 500,
      ...overrides,
    })
    .returning();
  return property;
}

/** Crée une fiche locataire pour un gestionnaire donné. */
export async function createTenant(managerId: string, overrides: Partial<typeof tenants.$inferInsert> = {}) {
  const id = overrides.id ?? createId();
  const [tenant] = await testDb
    .insert(tenants)
    .values({
      id,
      managerId,
      firstName: "Jean",
      lastName: "Dupont",
      phone: "0600000000",
      email: `tenant-${id}@test.local`,
      ...overrides,
    })
    .returning();
  return tenant;
}

/**
 * Compte utilisateur minimal, sans fiche associée.
 *
 * Depuis que `authenticate` relit la ligne `users` à chaque requête (contrôle
 * de révocation, voir middleware/auth.ts), un jeton forgé sur un identifiant
 * inventé est refusé en 401 — ce qui est le comportement voulu, mais rendait
 * muets les tests qui ne s'intéressaient qu'au rôle porté par le jeton et
 * fabriquaient un id au hasard. Ce helper donne à ces tests un compte qui
 * existe vraiment, comme en production où le jeton est toujours émis à partir
 * d'une ligne lue en base.
 */
export async function createPortalUser(role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER") {
  const id = createId();
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const [user] = await testDb
    .insert(users)
    .values({
      id,
      email: `portail-${id}@test.local`,
      passwordHash,
      role,
      emailVerifiedAt: new Date(),
    })
    .returning();
  return user;
}

/** Crée une fiche propriétaire (Espace propriétaire) pour un gestionnaire donné. */
export async function createOwner(managerId: string, overrides: Partial<typeof owners.$inferInsert> = {}) {
  const id = overrides.id ?? createId();
  const [owner] = await testDb
    .insert(owners)
    .values({
      id,
      managerId,
      firstName: "Fatou",
      lastName: "Diop",
      phone: "0600000000",
      email: `owner-${id}@test.local`,
      ...overrides,
    })
    .returning();
  return owner;
}

/** Émet un JWT valide pour les tests, avec le même secret que l'app en mode test. */
/**
 * `tokenVersion` est volontairement ABSENT du jeton produit ici : c'est la
 * forme qu'ont les jetons émis avant l'introduction du mécanisme de
 * révocation, et `authenticate` les lit comme la version 0. Les tests
 * couvrent ainsi, sans rien faire de particulier, la compatibilité que ce
 * mécanisme promet — et un test qui veut provoquer une révocation n'a qu'à
 * incrémenter users.tokenVersion (voir controllers/revocationJetons.test.ts).
 */
export function tokenFor(
  user: { id: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" },
  tenantId: string | null = null,
  ownerId: string | null = null
) {
  return jwt.sign({ userId: user.id, role: user.role, tenantId, ownerId }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Crée un contrat de location entre un bien et un locataire donnés. */
export async function createContract(
  propertyId: string,
  tenantId: string,
  overrides: Partial<typeof contracts.$inferInsert> = {}
) {
  const [contract] = await testDb
    .insert(contracts)
    .values({
      propertyId,
      tenantId,
      rent: 500,
      deposit: 1000,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2027, 0, 1),
      ...overrides,
    })
    .returning();
  return contract;
}

/** Crée directement un état des lieux (sans passer par createInspection du contrôleur). */
export async function createInspection(
  contract: { id: string; propertyId: string; tenantId: string },
  managerId: string,
  overrides: Partial<typeof inspections.$inferInsert> = {}
) {
  const [inspection] = await testDb
    .insert(inspections)
    .values({
      contractId: contract.id,
      propertyId: contract.propertyId,
      managerId,
      tenantId: contract.tenantId,
      ...overrides,
    })
    .returning();
  return inspection;
}

/** Crée directement une facture pour un contrat donné (sans passer par generateInvoicesForContract). */
export async function createInvoice(
  contractId: string,
  overrides: Partial<typeof invoices.$inferInsert> = {}
) {
  const [invoice] = await testDb
    .insert(invoices)
    .values({
      contractId,
      periodMonth: 6,
      periodYear: 2026,
      amount: 500,
      dueDate: new Date(2026, 5, 20),
      ...overrides,
    })
    .returning();
  return invoice;
}

/**
 * Crée un enregistrement d'historique de facturation SaaS (platform_subscriptions)
 * directement en base de test — utilisé par les tests du tableau de bord admin
 * pour simuler un paiement confirmé (calcul du MRR) sans passer par le flux de
 * paiement complet (initiatePayment).
 */
export async function createPlatformSubscription(
  userId: string,
  overrides: Partial<typeof platformSubscriptions.$inferInsert> = {}
) {
  const now = new Date();
  const [record] = await testDb
    .insert(platformSubscriptions)
    .values({
      userId,
      plan: "STARTER",
      amount: 9,
      billingCycle: "MONTHLY",
      status: "PAID",
      paymentMethod: "DEMO",
      startDate: now,
      endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  return record;
}

/**
 * Crée un compte utilisateur "portail" (role TENANT) et le lie à la fiche
 * locataire donnée (tenants.userId). Nécessaire pour tout flux de test qui
 * insère une ligne référençant réellement users.id — ex: messages.senderId
 * (contrainte de clé étrangère) — contrairement à un simple GET ou à une
 * fiche locataire "hors-ligne" (sans compte portail), où un identifiant
 * fictif dans le JWT de test suffit.
 */
export async function createTenantPortalUser(tenant: { id: string }) {
  const id = createId();
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const [user] = await testDb
    .insert(users)
    .values({
      id,
      email: `tenant-portal-${id}@test.local`,
      passwordHash,
      role: "TENANT" as const,
      emailVerifiedAt: new Date(),
    })
    .returning();
  await testDb.update(tenants).set({ userId: user.id }).where(eq(tenants.id, tenant.id));
  return user;
}

/**
 * Crée un compte utilisateur "portail" (role OWNER) et le lie à la fiche
 * propriétaire donnée (owners.userId) — même principe que
 * createTenantPortalUser ci-dessus, pour tester login/me côté propriétaire
 * sans passer par le flux d'invitation complet (email + token).
 */
export async function createOwnerPortalUser(owner: { id: string; email: string }) {
  const id = createId();
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const [user] = await testDb
    .insert(users)
    .values({
      id,
      email: owner.email,
      passwordHash,
      role: "OWNER" as const,
    })
    .returning();
  await testDb.update(owners).set({ userId: user.id }).where(eq(owners.id, owner.id));
  return user;
}

/**
 * Jeton d'un locataire RÉELLEMENT rattaché à la fiche.
 *
 * Les tests forgeaient jusqu'ici un jeton portant un `tenantId` sur un compte
 * qui n'était lié à rien. Depuis que le portail résout la fiche par le compte
 * et non par le jeton (voir chargerLocataireDuCompte), c'est exactement la
 * situation qu'il refuse — et c'est tant mieux : un test qui met en scène un
 * cas impossible en production ne prouve rien.
 *
 * Pour le cas inverse, celui de l'intrus, on garde délibérément un compte non
 * rattaché : c'est lui que le service doit éconduire.
 */
export async function tokenLocataire(tenantId: string) {
  const compte = await createTenantPortalUser({ id: tenantId });
  return tokenFor(compte, tenantId);
}

/**
 * Jeton d'un propriétaire RÉELLEMENT rattaché à la fiche — pendant de
 * tokenLocataire, pour la même raison : le portail propriétaire résout
 * désormais la fiche par le compte.
 */
export async function tokenProprietaire(owner: { id: string; email: string }) {
  const compte = await createOwnerPortalUser(owner);
  return tokenFor(compte, null, owner.id);
}
