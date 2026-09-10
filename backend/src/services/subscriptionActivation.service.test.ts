import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { platformSubscriptions, users } from "../db/schema";
import { createManager, createPlatformSubscription } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { activateSubscriptionRecord } from "./subscriptionActivation.service";

describe("activateSubscriptionRecord", () => {
  it("bascule l'enregistrement en PAID et débloque l'accès du compte correspondant", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL" });
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const record = await createPlatformSubscription(manager.id, {
      status: "PENDING",
      plan: "PRO",
      paymentMethod: "BANK_TRANSFER",
      endDate,
    });

    const updated = await activateSubscriptionRecord(record.id, testDb);

    expect(updated?.status).toBe("PAID");

    const [updatedUser] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedUser.subscriptionStatus).toBe("ACTIVE");
    expect(updatedUser.subscriptionPlan).toBe("PRO");
    expect(updatedUser.subscriptionPaymentMethod).toBe("BANK_TRANSFER");
    expect(new Date(updatedUser.subscriptionEndsAt!).getTime()).toBe(endDate.getTime());
  });

  it("est idempotent : un enregistrement déjà PAID n'est pas retraité", async () => {
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "STARTER",
    });
    const record = await createPlatformSubscription(manager.id, { status: "PAID", plan: "STARTER" });

    const result = await activateSubscriptionRecord(record.id, testDb);

    expect(result?.id).toBe(record.id);
    expect(result?.status).toBe("PAID");
    // Le compte n'a pas été retouché par un second appel (pas de double
    // notification/traitement) : son plan reste tel qu'avant l'appel.
    const [unchangedUser] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(unchangedUser.subscriptionPlan).toBe("STARTER");
  });

  it("renvoie null si l'enregistrement n'existe pas", async () => {
    const result = await activateSubscriptionRecord("inexistant-id", testDb);
    expect(result).toBeNull();
  });

  it("ne modifie que le compte associé, pas les autres gestionnaires", async () => {
    const managerA = await createManager({ subscriptionStatus: "TRIAL" });
    const managerB = await createManager({ subscriptionStatus: "TRIAL" });
    const record = await createPlatformSubscription(managerA.id, { status: "PENDING", plan: "ENTERPRISE" });

    await activateSubscriptionRecord(record.id, testDb);

    const [updatedB] = await testDb.select().from(users).where(eq(users.id, managerB.id));
    expect(updatedB.subscriptionStatus).toBe("TRIAL");
  });
});
