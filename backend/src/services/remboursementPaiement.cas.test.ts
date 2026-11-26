import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { activityLogs } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { type EvenementPaiement, signalerRemboursementOuLitige } from "./remboursementPaiement.service";

/**
 * Audit par sabotage de remboursementPaiement.service.ts : ce que remboursementPaiement.signalement.test.ts ne tenait pas —
 * la portée de « un seul message par événement » (jamais d'une autre agence ni d'une autre nature d'événement), le texte exact de la
 * ligne de journal d'un litige, la date limite écrite sans zéro initial, la phrase de l'e-mail sur le retrait du montant.
 *
 * Sur 75 mutants : 68 attrapés par les tests existants, 5 de plus par ce fichier ; 2 sont équivalents (la sortie anticipée quand
 * Stripe ne retrouve aucune session — la suite ne trouve de toute façon aucune ligne —, et l'échappement d'une date, qui ne contient
 * aucun caractère HTML).
 */
let envoi: ReturnType<typeof vi.spyOn>;
let cleAvant: string;

beforeEach(() => {
  cleAvant = env.payments.stripeSecretKey;
  env.payments.stripeSecretKey = "sk_test_cle_de_test";
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: "cs_ok" }] }) }));
});
afterEach(() => {
  env.payments.stripeSecretKey = cleAvant;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loyer() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, {
    status: "PAID",
    paymentMethod: "STRIPE",
    paymentRef: "cs_ok",
    amount: 500,
    periodMonth: 3,
    periodYear: 2026,
    currency: "EUR",
  });
  return { manager, invoice };
}

const evenement = (nature: EvenementPaiement["nature"], extra: Partial<EvenementPaiement> = {}): EvenementPaiement => ({
  nature,
  referenceStripe: nature === "LITIGE" ? "dp_1" : "ch_1",
  paymentIntent: "pi_1",
  montantBrut: 50000,
  devise: "eur",
  ...extra,
});
const journal = (managerId: string) => testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));
const ligneDeJournal = (extra: Record<string, unknown>) => ({ entityType: "invoice", actorLabel: "Test", entityLabel: "Test", ...extra });

describe("un seul message par événement : jamais d'une autre agence, jamais d'une autre nature", () => {
  it("la ligne de journal d'une AUTRE agence, même pour la même facture et le même événement, ne compte pas comme « déjà signalé »", async () => {
    const { manager, invoice } = await loyer();
    const voisin = await createManager();
    await testDb.insert(activityLogs).values(
      ligneDeJournal({
        managerId: voisin.id,
        action: "paiement_en_ligne.rembourse",
        entityId: invoice.id,
        details: "… [REMBOURSEMENT:ch_1:50000]",
      }) as never
    );

    await signalerRemboursementOuLitige(evenement("REMBOURSEMENT"));

    expect(await journal(manager.id)).toHaveLength(1);
    expect(envoi).toHaveBeenCalledTimes(1);
  });

  it("une ligne d'une AUTRE action (ici un litige) portant la même clé ne compte pas non plus", async () => {
    const { manager, invoice } = await loyer();
    await testDb.insert(activityLogs).values(
      ligneDeJournal({
        managerId: manager.id,
        action: "paiement_en_ligne.litige",
        entityId: invoice.id,
        details: "… [REMBOURSEMENT:ch_1:50000]",
      }) as never
    );

    await signalerRemboursementOuLitige(evenement("REMBOURSEMENT"));

    expect(await journal(manager.id)).toHaveLength(2);
    expect(envoi).toHaveBeenCalledTimes(1);
  });
});

describe("litige : le texte exact", () => {
  it("journal : « Litige ouvert sur le paiement Stripe du loyer … », le motif, la date limite sans zéro initial, la clé", async () => {
    const { manager } = await loyer();

    await signalerRemboursementOuLitige(evenement("LITIGE", { motif: "fraudulent", reponseAvant: new Date("2026-11-05T12:00:00Z") }));

    const [ligne] = await journal(manager.id);
    expect(ligne.details).toBe(
      "Litige ouvert sur le paiement Stripe du loyer 03/2026 (500 €, motif : fraudulent, réponse avant le 5 novembre 2026). " +
        "La facture reste enregistrée comme payée : à vérifier. [LITIGE:dp_1:50000]"
    );
  });

  it("e-mail : dit que Stripe a retiré le montant en attendant l'issue, et donne la date limite", async () => {
    await loyer();

    await signalerRemboursementOuLitige(evenement("LITIGE", { motif: "fraudulent", reponseAvant: new Date("2026-11-05T12:00:00Z") }));

    const html = (envoi.mock.calls[0] as unknown[])[2] as string;
    expect(html).toContain("Stripe a retiré ce montant en attendant l'issue du litige.");
    expect(html).toContain("<strong>Vous avez jusqu'au 5 novembre 2026</strong>");
  });
});
