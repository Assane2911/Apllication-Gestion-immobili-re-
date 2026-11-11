import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { leaseNotices, owners, rentRevisions, storedDocuments, users } from "../db/schema";
import { chargerAgendaProprietaire } from "../services/agenda.service";
import {
  authHeader,
  createContract,
  createInsurancePolicy,
  createInvoice,
  createManager,
  createOwner,
  createProperty,
  createTenant,
  tokenFor,
  tokenProprietaire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// 15 juin 2026 : les dates ci-dessous sont relatives à ce jour.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function monde() {
  const manager = await createManager();
  const proprietaire = await createOwner(manager.id);
  const bien = await createProperty(manager.id, { title: "Villa Baobab", ownerId: proprietaire.id });
  const locataire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const bail = await createContract(bien.id, locataire.id, { status: "ACTIVE", startDate: new Date(2026, 0, 1), endDate: new Date(2026, 7, 31) });
  const jeton = await tokenProprietaire(proprietaire);
  return { manager, proprietaire, bien, locataire, bail, jeton };
}
const lire = (jeton: string, query = "") => request(app).get(`/api/owners/mine/agenda${query}`).set(authHeader(jeton));
const conge = (managerId: string, contractId: string, exitDate: Date) =>
  testDb.insert(leaseNotices).values({
    contractId, managerId, givenBy: "TENANT", deliveryMode: "EMAIL", servedAt: new Date(2026, 5, 1),
    periodValue: 1, periodUnit: "MONTHS", exitDate, reason: "Mutation à Lyon",
  });

describe("GET /api/owners/mine/agenda", () => {
  it("donne les fins de bail et les assurances de ses biens, par date", async () => {
    const { bien, jeton } = await monde();
    await createInsurancePolicy(bien.id, { insurerName: "AXA", expiryDate: new Date(2026, 6, 10) });

    const res = await lire(jeton);

    expect(res.status).toBe(200);
    expect(res.body.map((e: { type: string }) => e.type)).toEqual(["INSURANCE_EXPIRY", "LEASE_END"]);
    expect(res.body[0]).toMatchObject({ propertyTitle: "Villa Baobab", label: "AXA", enRetard: false });
    expect(res.body[1]).toMatchObject({ propertyTitle: "Villa Baobab", enRetard: false });
  });

  it("ne livre aucune donnée du locataire : ni nom, ni motif de congé, ni loyer, ni révision, ni document", async () => {
    const { manager, bien, bail, jeton } = await monde();
    await conge(manager.id, bail.id, new Date(2026, 6, 1));
    await createInvoice(bail.id, { status: "LATE", dueDate: new Date(2026, 4, 5), amount: 500 });
    await testDb.insert(rentRevisions).values({ contractId: bail.id, previousRent: 500, newRent: 520, effectiveDate: new Date(2026, 6, 1), method: "AMOUNT" });
    await testDb.insert(storedDocuments).values({ managerId: manager.id, propertyId: bien.id, title: "Diagnostic gaz", filePath: "documents/x.pdf", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10, expiresAt: new Date(2026, 6, 5) });

    const res = await lire(jeton);

    expect(res.status).toBe(200);
    // Le congé remplace la fin de bail ; rien d'autre n'apparaît.
    expect(res.body.map((e: { type: string }) => e.type)).toEqual(["EXIT"]);
    expect(res.body[0]).toMatchObject({ tenantName: null, label: null, amount: null, contractId: null });
    const brut = JSON.stringify(res.body);
    for (const interdit of ["Awa", "Sow", "Mutation", "Lyon", "Diagnostic", "520"]) expect(brut).not.toContain(interdit);
  });

  it("ne sélectionne aucune colonne de locataire ni de motif : la confidentialité ne dépend pas d'un filtrage après coup", async () => {
    const { manager, proprietaire, bail } = await monde();
    await conge(manager.id, bail.id, new Date(2026, 6, 1));
    const select = vi.spyOn(db, "select");

    await chargerAgendaProprietaire(proprietaire.id, 180, new Date(2026, 5, 15));

    const colonnes = (selection: unknown, sortie: string[] = []): string[] => {
      if (selection && typeof selection === "object") {
        const c = selection as { name?: unknown };
        if (typeof c.name === "string" && "table" in (selection as object)) sortie.push(c.name);
        else for (const v of Object.values(selection as Record<string, unknown>)) colonnes(v, sortie);
      }
      return sortie;
    };
    expect(select.mock.calls).toHaveLength(3);
    for (const [champs] of select.mock.calls) {
      expect(champs).toBeDefined();
      const noms = colonnes(champs);
      for (const interdit of ["first_name", "last_name", "email", "phone", "reason", "tenant_id", "terms", "rent"]) expect(noms).not.toContain(interdit);
    }
  });

  it("se limite à SES biens : ni ceux d'un autre propriétaire de l'agence, ni ceux sans propriétaire, ni ceux d'une autre agence", async () => {
    const { manager, locataire, jeton } = await monde();
    const autreProprietaire = await createOwner(manager.id);
    const bienAutre = await createProperty(manager.id, { title: "Bien d'un autre propriétaire", ownerId: autreProprietaire.id });
    const bienSans = await createProperty(manager.id, { title: "Bien sans propriétaire" });
    await createContract(bienAutre.id, locataire.id, { status: "ACTIVE", endDate: new Date(2026, 7, 1) });
    await createInsurancePolicy(bienSans.id, { expiryDate: new Date(2026, 6, 1) });
    const b = await monde();

    const res = await lire(jeton);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].propertyTitle).toBe("Villa Baobab");
    const autre = await lire(b.jeton);
    expect(autre.body).toHaveLength(1);
    expect(autre.body[0].propertyId).not.toBe(res.body[0].propertyId);
  });

  it("met en tête ce qui est dépassé, et laisse de côté un bail terminé et une assurance échue depuis longtemps", async () => {
    const { manager, bien, locataire, jeton } = await monde();
    await createInsurancePolicy(bien.id, { insurerName: "MAIF", expiryDate: new Date(2026, 5, 1) }); // échue il y a 14 jours
    await createInsurancePolicy(bien.id, { policyNumber: "ANCIENNE", insurerName: "Ancienne", expiryDate: new Date(2025, 0, 1) });
    const bien2 = await createProperty(manager.id, { title: "Studio clos", ownerId: bien.ownerId });
    await createContract(bien2.id, locataire.id, { status: "TERMINATED", endDate: new Date(2026, 4, 1) });

    const res = await lire(jeton);

    expect(res.body.map((e: { type: string; enRetard: boolean; label: string | null }) => [e.type, e.enRetard, e.label])).toEqual([
      ["INSURANCE_EXPIRY", true, "MAIF"],
      ["LEASE_END", false, null],
    ]);
  });

  it("respecte l'horizon demandé et refuse un horizon invalide", async () => {
    const { jeton } = await monde(); // fin de bail le 31 août, dans 77 jours
    expect((await lire(jeton, "?days=30")).body).toHaveLength(0);
    expect((await lire(jeton, "?days=90")).body).toHaveLength(1);
    expect((await lire(jeton, "?days=0")).status).toBe(400);
    expect((await lire(jeton, "?days=5000")).status).toBe(400);
  });

  it("est réservé au propriétaire connecté, dont la fiche est rattachée au compte", async () => {
    const { manager, locataire, proprietaire } = await monde();

    expect((await request(app).get("/api/owners/mine/agenda")).status).toBe(401);
    expect((await lire(tokenFor(manager))).status).toBe(403);
    expect((await lire(tokenFor({ ...manager, role: "TENANT" } as never, locataire.id))).status).toBe(403);

    // Compte propriétaire dont la fiche a été détachée : plus rien à lire.
    const [compte] = await testDb.select().from(users).where(eq(users.email, proprietaire.email));
    await testDb.update(owners).set({ userId: null }).where(eq(owners.id, proprietaire.id));
    const res = await lire(tokenFor(compte, null, proprietaire.id));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_NOT_LINKED");
  });
});
