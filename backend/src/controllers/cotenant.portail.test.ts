import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contractCotenants, invoicePayments, invoices, tenants } from "../db/schema";
import * as emailService from "../services/email.service";
import { sendPartialPaymentReceiptEmail, sendPaymentReceiptEmail } from "../services/receipt.service";
import { runRentDueReminders, sendSingleInvoiceReminder } from "../services/reminder.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  fakeJpegBuffer,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { eq } from "drizzle-orm";

/**
 * Colocation, partie 2 : le colocataire est locataire du bail dans son portail (bail, factures,
 * documents, paiement, incident) et reçoit sa copie des avis, relances et quittances. La signature
 * électronique et la messagerie restent au titulaire.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function colocation() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Appartement T3" });
  const titulaire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com", civility: "MME" });
  const coloc = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", email: "binta@example.com", civility: "MME" });
  const etranger = await createTenant(manager.id, { firstName: "Zeina", lastName: "Ba", email: "zeina@example.com" });
  const contract = await createContract(property.id, titulaire.id, {
    status: "ACTIVE",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2027-12-31T00:00:00Z"),
  });
  await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
  const facture = await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date("2026-10-20T00:00:00Z") });
  return {
    manager,
    property,
    titulaire,
    coloc,
    contract,
    facture,
    hGestion: authHeader(tokenFor(manager)),
    hTitulaire: authHeader(await tokenLocataire(titulaire.id)),
    hColoc: authHeader(await tokenLocataire(coloc.id)),
    hEtranger: authHeader(await tokenLocataire(etranger.id)),
  };
}

const destinataires = () => envoi.mock.calls.map((c: unknown[]) => c[0] as string).sort();

describe("portail du colocataire", () => {
  it("voit le bail partagé (qualité COLOCATAIRE) et ses factures ; un autre locataire de l'agence non", async () => {
    const { contract, facture, hColoc, hTitulaire, hEtranger } = await colocation();

    const baux = await request(app).get("/api/contracts/mine").set(hColoc);
    expect(baux.status).toBe(200);
    expect(baux.body).toHaveLength(1);
    expect(baux.body[0]).toMatchObject({ id: contract.id, qualite: "COLOCATAIRE" });
    expect((await request(app).get("/api/contracts/mine").set(hTitulaire)).body[0].qualite).toBe("TITULAIRE");

    const factures = await request(app).get("/api/invoices/mine").set(hColoc);
    expect(factures.body.map((f: { id: string }) => f.id)).toEqual([facture.id]);
    expect((await request(app).get("/api/invoices/mine").set(hEtranger)).body).toEqual([]);
  });

  it("ouvre le bail imprimé et la quittance, qui nomme tous les locataires", async () => {
    const { contract, facture, hColoc, hEtranger } = await colocation();
    expect((await request(app).get(`/api/documents/lease/${contract.id}`).set(hColoc)).status).toBe(200);
    expect((await request(app).get(`/api/documents/lease/${contract.id}`).set(hEtranger)).status).toBe(403);

    await testDb.update(invoices).set({ status: "PAID", paidAt: new Date("2026-10-05T00:00:00Z"), amountPaid: 600 }).where(eq(invoices.id, facture.id));
    const quittance = await request(app).get(`/api/documents/receipt/${facture.id}`).set(hColoc);
    expect(quittance.status).toBe(200);
    expect(quittance.text).toContain("Madame Awa Sow et Madame Binta Kane");
    expect((await request(app).get(`/api/documents/receipt/${facture.id}`).set(hEtranger)).status).toBe(403);
  });

  it("peut payer une facture du bail ; un autre locataire non", async () => {
    const { facture, hColoc, hEtranger } = await colocation();
    expect((await request(app).post(`/api/invoices/${facture.id}/pay`).set(hEtranger).send({ method: "DEMO" })).status).toBe(403);
    const paiement = await request(app).post(`/api/invoices/${facture.id}/pay`).set(hColoc).send({ method: "DEMO" });
    expect(paiement.status).not.toBe(403);
    expect(paiement.status).toBeLessThan(300);
  });

  it("peut signaler un incident sur le bail", async () => {
    const { contract, hColoc, hEtranger } = await colocation();
    const signaler = (h: Record<string, string>) =>
      request(app)
        .post("/api/issues")
        .set(h)
        .field("contractId", contract.id)
        .field("title", "Fuite d'eau")
        .field("description", "Fuite sous l'évier de la cuisine")
        .attach("photo", fakeJpegBuffer("img"), { filename: "fuite.jpg", contentType: "image/jpeg" });
    expect((await signaler(hEtranger)).status).toBe(403);
    expect((await signaler(hColoc)).status).toBe(201);
  });

  it("ne signe pas électroniquement le bail et ne lit pas la messagerie du titulaire", async () => {
    const { contract, hColoc, hGestion } = await colocation();
    const signature = await request(app)
      .post(`/api/contracts/${contract.id}/sign`)
      .set(hColoc)
      .send({ signatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" });
    expect(signature.status).toBe(403);
    // Le colocataire a SON fil avec l'agence ; celui du titulaire lui reste fermé.
    await request(app).post(`/api/messages/${contract.id}`).set(hGestion).send({ content: "Message pour Awa" });
    const fil = await request(app).get(`/api/messages/${contract.id}`).set(hColoc);
    expect(fil.status).toBe(200);
    expect(fil.body.qualite).toBe("COLOCATAIRE");
    expect(fil.body.messages).toEqual([]);
  });

  it("retiré du bail, il perd l'accès", async () => {
    const { contract, hColoc } = await colocation();
    await testDb.delete(contractCotenants);
    expect((await request(app).get("/api/contracts/mine").set(hColoc)).body).toEqual([]);
    expect((await request(app).get(`/api/documents/lease/${contract.id}`).set(hColoc)).status).toBe(403);
  });
});

describe("envois au colocataire", () => {
  it("l'avis d'échéance part au titulaire et à chaque colocataire, nommé", async () => {
    const { manager } = await colocation();
    await runRentDueReminders(manager.id);
    expect(destinataires()).toEqual(["awa@example.com", "binta@example.com"]);
    const html = envoi.mock.calls.find((c: unknown[]) => c[0] === "binta@example.com")![2] as string;
    expect(html).toContain("Binta Kane");
  });

  it("un colocataire anonymisé ne reçoit plus rien", async () => {
    const { manager, coloc } = await colocation();
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, coloc.id));
    await runRentDueReminders(manager.id);
    expect(destinataires()).toEqual(["awa@example.com"]);
  });

  it("le rappel manuel part aussi au colocataire", async () => {
    const { manager, facture } = await colocation();
    await sendSingleInvoiceReminder(facture.id, manager.id);
    expect(destinataires()).toEqual(["awa@example.com", "binta@example.com"]);
  });

  it("la quittance, qui nomme tous les locataires, est envoyée à chacun avec le PDF", async () => {
    const { facture } = await colocation();
    await testDb.update(invoices).set({ status: "PAID", paidAt: new Date("2026-10-05T00:00:00Z"), amountPaid: 600 }).where(eq(invoices.id, facture.id));
    await sendPaymentReceiptEmail(facture.id);
    expect(destinataires()).toEqual(["awa@example.com", "binta@example.com"]);
    for (const appel of envoi.mock.calls) {
      expect(appel[2] as string).toContain("Madame Awa Sow et Madame Binta Kane");
      expect((appel[3] as Array<{ contentType: string }>)[0].contentType).toBe("application/pdf");
    }
  });

  it("le reçu de paiement partiel est copié au colocataire, à son nom", async () => {
    const { facture } = await colocation();
    await testDb.update(invoices).set({ amountPaid: 200 }).where(eq(invoices.id, facture.id));
    const [paiement] = await testDb
      .insert(invoicePayments)
      .values({ invoiceId: facture.id, amount: 200, paidAt: new Date("2026-10-05T00:00:00Z"), paymentMethod: "CASH" })
      .returning();
    await sendPartialPaymentReceiptEmail(facture.id, paiement.id);
    expect(destinataires()).toEqual(["awa@example.com", "binta@example.com"]);
    expect(envoi.mock.calls.find((c: unknown[]) => c[0] === "binta@example.com")![2] as string).toContain("Bonjour Madame Binta Kane");
  });

  it("le nom dans l'email de quittance est échappé", async () => {
    const { titulaire, facture } = await colocation();
    await testDb.update(tenants).set({ lastName: "<img src=x>" }).where(eq(tenants.id, titulaire.id));
    await testDb.update(invoices).set({ status: "PAID", paidAt: new Date("2026-10-05T00:00:00Z"), amountPaid: 600 }).where(eq(invoices.id, facture.id));
    await sendPaymentReceiptEmail(facture.id);
    const html = envoi.mock.calls[0][2] as string;
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img src=x>");
  });
});
