import type { Request } from "express";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLogs } from "../db/schema";
import { createManager, createTenantPortalUser, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { logActivity } from "./activity.service";

function fakeRequest(user: { userId: string; role: "MANAGER" | "TENANT" | "ADMIN"; tenantId?: string | null }) {
  return { user } as unknown as Request;
}

describe("logActivity", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enregistre 'Système' comme acteur quand aucune requête authentifiée n'est fournie", async () => {
    const manager = await createManager();

    await logActivity({
      managerId: manager.id,
      action: "cron.reminder",
      entityType: "contract",
      entityLabel: "Rappel automatique",
    });

    const [row] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(row.actorLabel).toBe("Système");
    expect(row.actorId).toBeNull();
    expect(row.actorRole).toBeNull();
  });

  it("enregistre le gestionnaire authentifié avec son email", async () => {
    const manager = await createManager();

    await logActivity({
      req: fakeRequest({ userId: manager.id, role: "MANAGER" }),
      managerId: manager.id,
      action: "property.create",
      entityType: "property",
      entityLabel: "Studio Centre-ville",
    });

    const [row] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(row.actorLabel).toBe(`Gestionnaire (${manager.email})`);
    expect(row.actorId).toBe(manager.id);
    expect(row.actorRole).toBe("MANAGER");
  });

  it("enregistre un locataire authentifié avec son email (ex: signalement d'incident)", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const tenantUser = await createTenantPortalUser(tenant);

    await logActivity({
      req: fakeRequest({ userId: tenantUser.id, role: "TENANT", tenantId: tenant.id }),
      managerId: manager.id,
      action: "issue.create",
      entityType: "issue",
      entityLabel: "Fuite d'eau",
    });

    const [row] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(row.actorLabel).toBe(`Locataire (${tenantUser.email})`);
    expect(row.actorRole).toBe("TENANT");
  });

  // Contrat documenté explicitement dans activity.service.ts : une entrée de
  // journal ne doit JAMAIS faire échouer l'action métier en cours, même si
  // son enregistrement échoue (ici : violation de contrainte de clé
  // étrangère sur managerId, qui n'existe pas). Sans le try/catch, une simple
  // erreur d'audit ferait échouer, par exemple, la création d'un bien.
  it("n'échoue jamais, même si l'enregistrement en base échoue (managerId invalide)", async () => {
    await expect(
      logActivity({
        managerId: "manager-inexistant",
        action: "property.create",
        entityType: "property",
        entityLabel: "Studio Centre-ville",
      })
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });
});
