import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listingLeads, listings, users } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Les annonces d'un gestionnaire dont l'abonnement est terminé quittent la vitrine : son CRM est fermé tant qu'il n'a pas
 * renouvelé (402), donc les visiteurs recevaient « demande envoyée » pour des demandes que personne ne pouvait lire.
 * Même règle que requireActiveSubscription (middleware/auth.ts) : essai en cours, abonnement actif (sans date de fin =
 * à vie), ou abonnement résilié jusqu'au terme de la période déjà payée.
 */
const jours = (n: number) => new Date(Date.now() + n * 24 * 3_600_000);

async function creerAnnonce(managerId: string, title: string) {
  const [annonce] = await testDb
    .insert(listings)
    .values({ managerId, title, description: "Belle villa avec piscine", price: 250000, location: "Ngor, Dakar", country: "SN" })
    .returning();
  return annonce;
}

const titresPublics = async () =>
  (await request(app).get("/api/listings/public")).body.items.map((l: { title: string }) => l.title).sort();

describe("vitrine : l'abonnement du gestionnaire", () => {
  it("n'affiche que les annonces d'un compte dont l'accès est en cours (essai, abonnement actif, résilié non échu)", async () => {
    const comptes = [
      ["Essai en cours", await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: jours(5) })],
      ["Actif à date", await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(20) })],
      ["Actif sans date", await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null })],
      ["Résilié non échu", await createManager({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: jours(10) })],
      ["Essai terminé", await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: jours(-2) })],
      ["Actif échu", await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(-1) })],
      ["Résilié échu", await createManager({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: jours(-1) })],
      ["Résilié sans période", await createManager({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: null })],
      ["Expiré", await createManager({ subscriptionStatus: "EXPIRED" })],
    ] as const;
    for (const [titre, compte] of comptes) await creerAnnonce(compte.id, titre);

    expect(await titresPublics()).toEqual(["Actif sans date", "Actif à date", "Essai en cours", "Résilié non échu"]);
    const pays = await request(app).get("/api/listings/public/countries");
    expect(pays.body.countries).toEqual(["SN"]);
  });

  it("répond 404 en fiche et refuse la demande de contact quand l'abonnement est terminé, sans rien supprimer", async () => {
    const compte = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(-3) });
    const annonce = await creerAnnonce(compte.id, "Villa");

    expect((await request(app).get(`/api/listings/public/${annonce.id}`)).status).toBe(404);
    const demande = await request(app)
      .post(`/api/listings/public/${annonce.id}/leads`)
      .send({ prospectName: "Awa Sow", prospectEmail: "awa@test.local", prospectPhone: "+221771234567" });
    expect(demande.status).toBe(404);
    expect(await testDb.select().from(listingLeads)).toHaveLength(0);
    // Rien n'est écrit : l'annonce est toujours là, et revient avec le renouvellement.
    expect(await testDb.select().from(listings)).toHaveLength(1);
  });

  it("l'annonce revient d'elle-même au renouvellement", async () => {
    const compte = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(-3) });
    await creerAnnonce(compte.id, "Villa");
    expect(await titresPublics()).toEqual([]);

    await testDb.update(users).set({ subscriptionEndsAt: jours(30) }).where(eq(users.id, compte.id));

    expect(await titresPublics()).toEqual(["Villa"]);
  });

  it("l'administration le voit : visibilité réelle exclue, et l'annonce signalée « abonnement terminé »", async () => {
    const token = authHeader(tokenFor(await createAdmin()));
    const expire = await createManager({ subscriptionStatus: "EXPIRED" });
    const actif = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(30) });
    await creerAnnonce(expire.id, "Expirée");
    await creerAnnonce(actif.id, "Active");

    const visibles = await request(app).get("/api/admin/listings?visibility=VISIBLE").set(token);
    const toutes = await request(app).get("/api/admin/listings").set(token);

    expect(visibles.body.items.map((i: { title: string }) => i.title)).toEqual(["Active"]);
    const ligneExpiree = toutes.body.items.find((i: { title: string }) => i.title === "Expirée");
    const ligneActive = toutes.body.items.find((i: { title: string }) => i.title === "Active");
    expect(ligneExpiree.managerSubscriptionExpired).toBe(true);
    expect(ligneActive.managerSubscriptionExpired).toBe(false);
  });
});
