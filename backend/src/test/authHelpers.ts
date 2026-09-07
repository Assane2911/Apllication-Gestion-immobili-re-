import { createId } from "@paralleldrive/cuid2";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { testDb } from "./setupTestDb";
import { properties, tenants, users } from "../db/schema";

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

/** Émet un JWT valide pour les tests, avec le même secret que l'app en mode test. */
export function tokenFor(user: { id: string; role: "MANAGER" | "TENANT" }, tenantId: string | null = null) {
  return jwt.sign({ userId: user.id, role: user.role, tenantId }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
