import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { invoices } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const MARQUEUR = "AAAAAAAA";

async function setup(overrides: Partial<Parameters<typeof createContract>[2]> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, overrides);
  return { manager, property, tenant, contract };
}

async function ligne(id: string) {
  const [row] = await testDb.select().from(invoices).where(eq(invoices.id, id));
  return row;
}

describe("GET /api/invoices/mine — le portail ne reçoit que ce que l'écran lit", () => {
  it("ne répète pas, sur chaque facture, le bail entier (clauses, images de signature) ni la fiche complète du bien", async () => {
    const { manager, property, tenant, contract } = await setup({
      terms: "Clauses particulières. ".repeat(200),
      managerSignatureUrl: SIGNATURE,
      tenantSignatureUrl: SIGNATURE,
      signedByManagerAt: new Date(),
      signedByTenantAt: new Date(),
    });
    for (let mois = 1; mois <= 12; mois++) await createInvoice(contract.id, { periodMonth: mois, periodYear: 2026 });
    const portail = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/invoices/mine").set(authHeader(tokenFor(portail, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(12);
    const corps = JSON.stringify(res.body);
    expect(corps).not.toContain(MARQUEUR);
    expect(corps).not.toContain("Clauses particulières");
    // Ce que l'écran lit : le titre et l'identifiant du bien, et les champs de la facture.
    expect(res.body[0].contract.property.title).toBe(property.title);
    expect(res.body[0].contract.property.id).toBe(property.id);
    expect(res.body[0].contract.id).toBe(contract.id);
    expect(res.body[0].resteDu).toBe(500);
    expect(res.body[0].montantRegle).toBe(0);
    // Poids : douze factures ne pèsent plus des centaines de ko.
    expect(corps.length).toBeLessThan(30_000);
    void manager;
  });
});

describe("POST /api/invoices/:id/cancel — le refus « des paiements existent » tient même si un paiement arrive entre la lecture et l'écriture", () => {
  /**
   * Fait arriver un encaissement partiel (la facture reste « en attente », seul le cumul avance) JUSTE avant l'écriture de
   * l'annulation : ce que produit un autre onglet ou un autre collaborateur. Déterministe.
   */
  function paiementPartielJusteAvant(id: string) {
    const origine = testDb.update.bind(testDb);
    let fait = false;
    return vi.spyOn(testDb, "update").mockImplementation(((table: unknown) => {
      const constructeur = origine(table as never);
      if (table !== invoices || fait) return constructeur;
      return {
        set: (valeurs: Record<string, unknown>) => {
          const etape = constructeur.set(valeurs as never);
          return {
            where: (condition: never) => {
              const requete = etape.where(condition);
              return {
                returning: async () => {
                  fait = true;
                  await origine(invoices).set({ amountPaid: 200 }).where(eq(invoices.id, id));
                  return requete.returning();
                },
              };
            },
          };
        },
      };
    }) as never);
  }

  it("refuse (409) et laisse la facture en attente, avec son encaissement", async () => {
    const { manager, contract } = await setup();
    const facture = await createInvoice(contract.id);
    const espion = paiementPartielJusteAvant(facture.id);

    const res = await request(app).post(`/api/invoices/${facture.id}/cancel`).set(authHeader(tokenFor(manager)));
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVOICE_HAS_PAYMENTS");
    const apres = await ligne(facture.id);
    expect(apres.status).toBe("PENDING");
    expect(apres.amountPaid).toBe(200);
  });

  it("annule normalement une facture sans paiement", async () => {
    const { manager, contract } = await setup();
    const facture = await createInvoice(contract.id);

    const res = await request(app).post(`/api/invoices/${facture.id}/cancel`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect((await ligne(facture.id)).status).toBe("CANCELLED");
  });
});

describe("POST /api/invoices/:id/send-reminder — aucun rappel « loyer à payer » pour une facture réglée ou annulée", () => {
  async function factureAvec(statut: "PAID" | "CANCELLED" | "PENDING" | "LATE") {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { email: "fatou@test.local" });
    const contract = await createContract(property.id, tenant.id);
    const facture = await createInvoice(contract.id, { status: statut, amount: 500, amountPaid: statut === "PAID" ? 500 : 0 });
    return { h: authHeader(tokenFor(manager)), facture };
  }

  it("facture déjà réglée : refus (409), aucun e-mail, aucune marque de rappel", async () => {
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    const { h, facture } = await factureAvec("PAID");

    const res = await request(app).post(`/api/invoices/${facture.id}/send-reminder`).set(h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVOICE_ALREADY_PAID");
    expect(envoi).not.toHaveBeenCalled();
    expect((await ligne(facture.id)).reminderSentAt).toBeNull();
    envoi.mockRestore();
  });

  it("facture annulée : refus (409), aucun e-mail, aucune marque de rappel", async () => {
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    const { h, facture } = await factureAvec("CANCELLED");

    const res = await request(app).post(`/api/invoices/${facture.id}/send-reminder`).set(h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVOICE_CANCELLED_LOCKED");
    expect(envoi).not.toHaveBeenCalled();
    expect((await ligne(facture.id)).reminderSentAt).toBeNull();
    envoi.mockRestore();
  });

  it.each(["PENDING", "LATE"] as const)("facture %s : le rappel part toujours", async (statut) => {
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    const { h, facture } = await factureAvec(statut);

    const res = await request(app).post(`/api/invoices/${facture.id}/send-reminder`).set(h);

    expect(res.status).toBe(200);
    expect(envoi.mock.calls.filter((c) => c[0] === "fatou@test.local")).toHaveLength(1);
    envoi.mockRestore();
  });
});
