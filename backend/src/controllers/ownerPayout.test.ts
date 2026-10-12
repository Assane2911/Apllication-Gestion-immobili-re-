import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, expenses, ownerPayouts } from "../db/schema";
import * as emailService from "../services/email.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
  tokenProprietaire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Reversements aux propriétaires : l'agence enregistre ce qu'elle a versé au titre d'un mois, et le
 * CRG affiche « déjà reversé » et « reste à reverser ». Aujourd'hui (horloge figée) : 12 octobre 2026.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 10));
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Septembre 2026 : 1 000 € encaissés, 100 € de charges, 10 % de commission → 800 € à reverser. */
async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const owner = await createOwner(manager.id, { managementFeeRate: 10, iban: "FR7630006000011234567890189" });
  const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  await createInvoice(contract.id, { periodMonth: 9, amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });
  await testDb.insert(expenses).values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 100, expenseDate: new Date(2026, 8, 10) });
  return { manager, owner, property, h: authHeader(tokenFor(manager)) };
}

const reverser = (h: Record<string, string>, ownerId: string, corps: Record<string, unknown>) =>
  request(app)
    .post(`/api/crg/${ownerId}/payouts`)
    .set(h)
    .send({ month: 9, year: 2026, currency: "EUR", method: "BANK_TRANSFER", paidAt: "2026-10-05", ...corps });
const crg = (h: Record<string, string>, ownerId: string) => request(app).get(`/api/crg/${ownerId}?month=9&year=2026`).set(h);

describe("enregistrer un reversement", () => {
  it("le CRG affiche le net, ce qui a été reversé et ce qui reste, et l'enregistrement est journalisé", async () => {
    const { manager, owner, h } = await agence();
    const avant = await crg(h, owner.id);
    expect(avant.body).toMatchObject({ totalNetByCurrency: { EUR: 800 }, totalReverseByCurrency: {}, resteAReverserByCurrency: { EUR: 800 }, reversements: [] });

    const res = await reverser(h, owner.id, { amount: 500, reference: "VIR-0925" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 500, currency: "EUR", periodMonth: 9, periodYear: 2026, method: "BANK_TRANSFER", reference: "VIR-0925", emailEnvoye: false });

    const apres = await crg(h, owner.id);
    expect(apres.body.totalReverseByCurrency).toEqual({ EUR: 500 });
    expect(apres.body.resteAReverserByCurrency).toEqual({ EUR: 300 });
    expect(apres.body.reversements).toHaveLength(1);
    expect(apres.body.reversements[0]).toMatchObject({ amount: 500, reference: "VIR-0925" });

    // Le solde, en deux fois.
    expect((await reverser(h, owner.id, { amount: 300, method: "MOBILE_MONEY", paidAt: "2026-10-12" })).status).toBe(201);
    expect((await crg(h, owner.id)).body.resteAReverserByCurrency).toEqual({ EUR: 0 });

    const journal = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.filter((l: { action: string }) => l.action === "owner.payout")).toHaveLength(2);
  });

  it("refuse de verser plus que le reste (faute de frappe), ou quand il ne reste rien", async () => {
    const { owner, h } = await agence();
    const trop = await reverser(h, owner.id, { amount: 8000 });
    expect(trop.status).toBe(409);
    expect(trop.body.error).toContain("dépasse ce qui reste à reverser");
    expect(await testDb.select().from(ownerPayouts)).toHaveLength(0);

    await reverser(h, owner.id, { amount: 800 });
    const plusRien = await reverser(h, owner.id, { amount: 1 });
    expect(plusRien.status).toBe(409);
    expect(plusRien.body.error).toContain("ne reste rien");
  });

  it("deux saisies simultanées ne consomment pas deux fois le même reste", async () => {
    const { owner, h } = await agence();
    const [a, b] = await Promise.all([reverser(h, owner.id, { amount: 600 }), reverser(h, owner.id, { amount: 600 })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await testDb.select().from(ownerPayouts)).toHaveLength(1);
  });

  it("dates : ni mois futur, ni versement daté avant le mois soldé ou dans le futur", async () => {
    const { owner, h } = await agence();
    expect((await reverser(h, owner.id, { amount: 10, month: 11 })).body.error).toContain("pas encore commencé");
    expect((await reverser(h, owner.id, { amount: 10, paidAt: "2026-08-31" })).body.error).toContain("précéder");
    expect((await reverser(h, owner.id, { amount: 10, paidAt: "2026-10-13" })).body.error).toContain("futur");
    expect(await testDb.select().from(ownerPayouts)).toHaveLength(0);
  });

  it("refuse une devise sans activité, un montant nul et un moyen inconnu", async () => {
    const { owner, h } = await agence();
    expect((await reverser(h, owner.id, { amount: 10, currency: "XOF" })).status).toBe(400);
    expect((await reverser(h, owner.id, { amount: 0 })).status).toBe(400);
    expect((await reverser(h, owner.id, { amount: 10, method: "BITCOIN" })).status).toBe(400);
  });

  it("isole les agences : le propriétaire d'une autre agence est introuvable", async () => {
    const { owner } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE" });
    expect((await reverser(authHeader(tokenFor(autre)), owner.id, { amount: 10 })).status).toBe(404);
  });

  it("prévient le propriétaire par email quand c'est demandé", async () => {
    const { owner, h } = await agence();
    const res = await reverser(h, owner.id, { amount: 800, notifyOwner: true, reference: "VIR-0925" });
    expect(res.body.emailEnvoye).toBe(true);
    const [destinataire, sujet, html] = envoi.mock.calls[0] as [string, string, string];
    expect(destinataire).toBe(owner.email);
    expect(sujet).toContain("septembre 2026");
    expect(html).toContain("800");
    expect(html).toContain("VIR-0925");
    expect((await testDb.select().from(ownerPayouts))[0].ownerNotifiedAt).not.toBeNull();
  });
});

describe("supprimer un reversement", () => {
  it("rend le montant au reste à reverser, et journalise la suppression", async () => {
    const { manager, owner, h } = await agence();
    const r = await reverser(h, owner.id, { amount: 500 });
    expect((await request(app).delete(`/api/crg/${owner.id}/payouts/${r.body.id}`).set(h)).status).toBe(204);
    expect((await crg(h, owner.id)).body.resteAReverserByCurrency).toEqual({ EUR: 800 });
    expect((await request(app).delete(`/api/crg/${owner.id}/payouts/${r.body.id}`).set(h)).status).toBe(404);
    const journal = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.some((l: { action: string }) => l.action === "owner.payout_delete")).toBe(true);
  });

  it("ne supprime pas le reversement d'un autre propriétaire en passant par le sien", async () => {
    const { manager, owner, h } = await agence();
    const second = await createOwner(manager.id);
    const r = await reverser(h, owner.id, { amount: 500 });
    expect((await request(app).delete(`/api/crg/${second.id}/payouts/${r.body.id}`).set(h)).status).toBe(404);
    expect(await testDb.select().from(ownerPayouts)).toHaveLength(1);
  });
});

describe("synthèse et accès", () => {
  it("synthèse du mois : net, reversé et reste par propriétaire", async () => {
    const { manager, owner, h } = await agence();
    await createOwner(manager.id, { firstName: "Zeina", lastName: "Ba" });
    await reverser(h, owner.id, { amount: 300 });

    const res = await request(app).get("/api/crg/payouts/summary?month=9&year=2026").set(h);
    expect(res.status).toBe(200);
    expect(res.body.owners).toHaveLength(2);
    const ligne = res.body.owners.find((o: { ownerId: string }) => o.ownerId === owner.id);
    expect(ligne).toMatchObject({ hasIban: true, netByCurrency: { EUR: 800 }, reverseByCurrency: { EUR: 300 }, resteByCurrency: { EUR: 500 } });
    expect((await request(app).get("/api/crg/payouts/summary").set(h)).status).toBe(400);
  });

  it("le propriétaire voit ses reversements dans son CRG et dans l'export", async () => {
    const { owner, h } = await agence();
    await reverser(h, owner.id, { amount: 500, reference: "VIR-0925" });
    const hProprio = authHeader(await tokenProprietaire(owner));

    const mien = await request(app).get("/api/crg/mine?month=9&year=2026").set(hProprio);
    expect(mien.body).toMatchObject({ totalReverseByCurrency: { EUR: 500 }, resteAReverserByCurrency: { EUR: 300 } });

    const exporte = await request(app).get("/api/crg/mine/export?month=9&year=2026").set(hProprio);
    expect(exporte.text).toContain("Reversements au propriétaire");
    expect(exporte.text).toContain("VIR-0925");
    expect(exporte.text).toContain("Reste à reverser");
    // Le propriétaire ne peut pas enregistrer de reversement lui-même.
    expect((await reverser(hProprio, owner.id, { amount: 10 })).status).toBe(403);
  });

  it("équipe : le comptable enregistre et supprime ; l'agent ne fait ni l'un ni l'autre", async () => {
    const { manager, owner, h } = await agence();
    const comptable = await createTeamMember(manager.id, { teamRole: "ACCOUNTANT" });
    const agent = await createTeamMember(manager.id, { teamRole: "AGENT" });
    const hCompta = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, comptable.id));
    const hAgent = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, agent.id));

    expect((await reverser(hAgent, owner.id, { amount: 10 })).status).toBe(403);
    const r = await reverser(hCompta, owner.id, { amount: 10 });
    expect(r.status).toBe(201);
    expect((await request(app).delete(`/api/crg/${owner.id}/payouts/${r.body.id}`).set(hAgent)).status).toBe(403);
    expect((await request(app).delete(`/api/crg/${owner.id}/payouts/${r.body.id}`).set(hCompta)).status).toBe(204);
    expect((await crg(h, owner.id)).status).toBe(200);
  });
});
