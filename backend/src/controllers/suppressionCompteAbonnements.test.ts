import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";
import { authHeader, createManager, createPlatformSubscription, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/**
 * Les paiements d'abonnement encaissés sont des pièces comptables : ils doivent survivre dix ans à la clôture du compte,
 * mais anonymisés (plus aucun lien avec le compte supprimé). Les demandes jamais encaissées n'ont aucune valeur comptable.
 */
const supprimerMonCompte = (manager: { id: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" }) =>
  request(app).delete("/api/auth/account").set(authHeader(tokenFor(manager))).send({ password: "Password123!" });

const lignesDe = (id: string) => testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id));

describe("suppression d'une agence — paiements d'abonnement", () => {
  it("conserve les paiements encaissés, anonymisés (user_id NULL), avec tous leurs montants", async () => {
    const manager = await createManager();
    const paiement = await createPlatformSubscription(manager.id, { status: "PAID", amount: 15000, currency: "XOF", plan: "PRO", paymentMethod: "PAYDUNYA", paymentRef: "PD-2026-0042" });

    const res = await supprimerMonCompte(manager);

    expect(res.status).toBe(204);
    const [reste] = await lignesDe(paiement.id);
    expect(reste).toBeDefined();
    expect(reste.userId).toBeNull();
    expect(reste.amount).toBe(15000);
    expect(reste.currency).toBe("XOF");
    expect(reste.plan).toBe("PRO");
    expect(reste.paymentMethod).toBe("PAYDUNYA");
    expect(reste.paymentRef).toBe("PD-2026-0042");
    expect((await testDb.select().from(users).where(eq(users.id, manager.id))).length).toBe(0);
  });

  it("supprime les demandes jamais encaissées (virement en attente, rejeté)", async () => {
    const manager = await createManager();
    const enAttente = await createPlatformSubscription(manager.id, { status: "PENDING", paymentMethod: "BANK_TRANSFER" });
    const rejete = await createPlatformSubscription(manager.id, { status: "REJECTED", paymentMethod: "BANK_TRANSFER" });
    const paye = await createPlatformSubscription(manager.id, { status: "PAID" });

    await supprimerMonCompte(manager);

    expect(await lignesDe(enAttente.id)).toHaveLength(0);
    expect(await lignesDe(rejete.id)).toHaveLength(0);
    expect(await lignesDe(paye.id)).toHaveLength(1);
  });

  it("ne touche pas aux paiements des autres agences", async () => {
    const cible = await createManager();
    const autre = await createManager();
    const paiementAutre = await createPlatformSubscription(autre.id, { status: "PAID" });

    await supprimerMonCompte(cible);

    const [intact] = await lignesDe(paiementAutre.id);
    expect(intact.userId).toBe(autre.id);
  });

  it("un paiement anonymisé ne peut plus être « activé » : aucun compte à qui donner l'abonnement", async () => {
    const manager = await createManager();
    const paiement = await createPlatformSubscription(manager.id, { status: "PAID" });
    await supprimerMonCompte(manager);

    const resultat = await activateSubscriptionRecord(paiement.id);

    expect(resultat?.userId ?? null).toBeNull();
    expect((await lignesDe(paiement.id))[0].status).toBe("PAID");
  });
});
