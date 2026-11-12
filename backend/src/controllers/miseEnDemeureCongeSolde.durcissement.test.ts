import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, contracts, properties, tenants, users } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue("http://test.local/signed/conge.pdf"),
  getSignedUrls: vi.fn().mockResolvedValue(new Map()),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const JOUR = 24 * 3600 * 1000;

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });
  // Logo et cachet : des images en base64, jamais utiles à la liste des baux à mettre en demeure.
  await testDb.insert(agencySettings).values({
    userId: manager.id,
    agencyName: "Agence Teranga",
    phone: "+221 77 000 00 00",
    logoUrl: SIGNATURE,
    stampOrSignatureUrl: SIGNATURE,
  });
  const property = await createProperty(manager.id, { title: "Villa Ngor", currency: "EUR" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, {
    status: "ACTIVE",
    terms: "Clauses particulières. ".repeat(200),
    managerSignatureUrl: SIGNATURE,
    tenantSignatureUrl: SIGNATURE,
    currency: "EUR",
  });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

/** Relève les tables lues EN ENTIER : `db.select().from(table)` (et ses jointures), ou une table passée telle quelle dans la liste des colonnes. */
function surveillerLecturesEntieres() {
  const entieres: unknown[] = [];
  const origine = testDb.select.bind(testDb);
  vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
    const requete = origine(...(args as [])) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const champs = args[0] as Record<string, unknown> | undefined;
    if (champs) {
      for (const valeur of Object.values(champs)) if (valeur && is(valeur as never, PgTable)) entieres.push(valeur);
    } else {
      const depuis = requete.from.bind(requete);
      requete.from = (table: unknown) => {
        entieres.push(table);
        const suite = depuis(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
        for (const methode of ["innerJoin", "leftJoin"]) {
          const initiale = suite[methode]?.bind(suite);
          if (!initiale) continue;
          suite[methode] = (jointe: unknown, ...reste: unknown[]) => {
            entieres.push(jointe);
            return initiale(jointe, ...reste);
          };
        }
        return suite;
      };
    }
    return requete;
  }) as never);
  return entieres;
}

describe("Baux à mettre en demeure — ne charge ni le bail, ni le bien, ni le locataire, ni les réglages d'agence entiers", () => {
  it("garde le contenu de la liste et ne lit en entier que le compte de l'utilisateur (authentification)", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 9, periodYear: 2026, amount: 500, dueDate: new Date(Date.now() - 60 * JOUR), status: "LATE" });
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, amountPaid: 200, dueDate: new Date(Date.now() - 40 * JOUR), status: "PENDING" });
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/contracts/formal-notices-due").set(h);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      contractId: contract.id,
      propertyTitle: "Villa Ngor",
      tenantName: "Awa Sow",
      currency: "EUR",
      unpaidCount: 2,
      alreadyClaimedCount: 0,
      totalDue: 800,
      daysLate: 60,
      agencyReachable: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("AAAAAAAA");
    for (const table of [contracts, properties, tenants, agencySettings]) expect(entieres).not.toContain(table);
    expect(entieres.filter((t) => t === users)).toHaveLength(1);
  });

  it("ne liste pas le bail d'une autre agence", async () => {
    const a = await agence();
    const b = await agence();
    await createInvoice(b.contract.id, { dueDate: new Date(Date.now() - 60 * JOUR), status: "LATE" });

    const res = await request(app).get("/api/contracts/formal-notices-due").set(a.h);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Sorties à venir — ne charge ni le bail, ni le bien, ni le locataire entiers", () => {
  it("garde le contenu de la liste et ne lit en entier que le compte de l'utilisateur (authentification)", async () => {
    const { contract, h } = await agence();
    const enregistre = await request(app)
      .post(`/api/contracts/${contract.id}/notices`)
      .set(h)
      .send({ givenBy: "TENANT", deliveryMode: "EMAIL", servedAt: "2026-03-10", periodValue: 3, periodUnit: "MONTHS" });
    expect(enregistre.status).toBe(201);
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/contracts/exits").set(h);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      noticeId: enregistre.body.id,
      contractId: contract.id,
      propertyTitle: "Villa Ngor",
      tenantName: "Awa Sow",
      givenBy: "TENANT",
      etapes: { etatDesLieuxDeSortie: "NONE", depotRestitue: false },
    });
    expect(JSON.stringify(res.body)).not.toContain("AAAAAAAA");
    for (const table of [contracts, properties, tenants]) expect(entieres).not.toContain(table);
    expect(entieres.filter((t) => t === users)).toHaveLength(1);
  });
});
