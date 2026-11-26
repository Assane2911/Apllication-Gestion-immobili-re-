import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { platformSubscriptions, users } from "../db/schema";
import { createManager, createPlatformSubscription } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { activateSubscriptionRecord, expireStripeSubscription, renewSubscriptionFromStripeInvoice } from "./subscriptionActivation.service";

/**
 * Activation d'un paiement différé (PayDunya, Stripe), renouvellement automatique Stripe et fin d'un abonnement
 * Stripe : c'est ce qui ouvre, prolonge ou ferme l'accès payant d'une agence. On vérifie surtout les cas où une période
 * serait fausse (cycle annuel, droits déjà payés reportés), où un paiement ne doit rien ouvrir (rejeté, compte supprimé,
 * montant faux) et où un rejeu ne doit rien prolonger une seconde fois.
 */

const JOUR = 24 * 3600 * 1000;
const MAINTENANT = new Date(2026, 7, 15, 12, 0, 0); // 15 août 2026

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const compte = (id: string) => testDb.select().from(users).where(eq(users.id, id)).then((r: Array<typeof users.$inferSelect>) => r[0]);
const ligne = (id: string) => testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id)).then((r: Array<typeof platformSubscriptions.$inferSelect>) => r[0]);
const lignesDe = (userId: string) => testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, userId));
const mois = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const demande = (userId: string | null, o: Partial<typeof platformSubscriptions.$inferInsert> = {}) =>
  createPlatformSubscription(userId as string, { status: "PENDING", paymentMethod: "PAYDUNYA", plan: "PRO", amount: 29, currency: "EUR", ...o });

describe("activateSubscriptionRecord", () => {
  it("un enregistrement inconnu ne fait rien (null)", async () => {
    expect(await activateSubscriptionRecord("inconnu")).toBeNull();
  });

  it("un enregistrement déjà confirmé est rendu tel quel : le compte n'est pas touché une seconde fois", async () => {
    const m = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER" });
    const v = await demande(m.id, { status: "PAID" });

    const res = await activateSubscriptionRecord(v.id);

    expect(res?.id).toBe(v.id);
    const apres = await compte(m.id);
    expect(apres.subscriptionStatus).toBe("TRIAL");
    expect(apres.subscriptionPlan).toBe("STARTER");
  });

  it("un paiement rejeté (ancienne demande de virement comprise) ne s'active jamais (400, SUBSCRIPTION_REJECTED_CANNOT_CONFIRM) : ni accès ouvert, ni statut changé", async () => {
    const m = await createManager({ subscriptionStatus: "EXPIRED", subscriptionPlan: "STARTER" });
    const v = await demande(m.id, { status: "REJECTED" });

    await expect(activateSubscriptionRecord(v.id)).rejects.toMatchObject({ statusCode: 400, code: "SUBSCRIPTION_REJECTED_CANNOT_CONFIRM" });

    expect((await ligne(v.id)).status).toBe("REJECTED");
    expect((await compte(m.id)).subscriptionStatus).toBe("EXPIRED");
  });

  it("un paiement dont le compte a été supprimé (ligne anonymisée) n'active rien : null, l'enregistrement reste en attente", async () => {
    const v = await testDb
      .insert(platformSubscriptions)
      .values({ userId: null, plan: "PRO", amount: 29, currency: "EUR", status: "PENDING", paymentMethod: "PAYDUNYA", startDate: MAINTENANT, endDate: new Date(MAINTENANT.getTime() + 30 * JOUR) })
      .returning()
      .then((r: Array<typeof platformSubscriptions.$inferSelect>) => r[0]);

    expect(await activateSubscriptionRecord(v.id)).toBeNull();
    expect((await ligne(v.id)).status).toBe("PENDING");
  });

  it("un paiement mensuel ouvre l'accès à partir d'AUJOURD'HUI, pas de la date de la demande, pour un mois", async () => {
    const m = await createManager({ subscriptionStatus: "EXPIRED", subscriptionPlan: "STARTER", subscriptionEndsAt: new Date(2026, 0, 1) });
    const v = await demande(m.id, { billingCycle: "MONTHLY", startDate: new Date(2026, 5, 1), endDate: new Date(2026, 6, 1) });

    const res = await activateSubscriptionRecord(v.id);

    expect(res?.status).toBe("PAID");
    expect(mois(res!.startDate)).toBe(mois(MAINTENANT));
    expect(mois(res!.endDate)).toBe(mois(MAINTENANT) + 1);
    const apres = await compte(m.id);
    expect(apres).toMatchObject({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionPaymentMethod: "PAYDUNYA" });
    expect(apres.subscriptionEndsAt?.getTime()).toBe(res!.endDate.getTime());
  });

  it("un paiement ANNUEL ouvre l'accès pour douze mois, pas un", async () => {
    const m = await createManager({ subscriptionStatus: "EXPIRED", subscriptionPlan: "STARTER", subscriptionEndsAt: new Date(2026, 0, 1) });
    const v = await demande(m.id, { billingCycle: "ANNUAL", amount: 290 });

    const res = await activateSubscriptionRecord(v.id);

    expect(mois(res!.endDate)).toBe(mois(MAINTENANT) + 12);
    expect(mois((await compte(m.id)).subscriptionEndsAt!)).toBe(mois(MAINTENANT) + 12);
  });

  it("les droits déjà payés du même plan sont reportés : la nouvelle période repart de l'ancienne fin, pas d'aujourd'hui", async () => {
    const finActuelle = new Date(MAINTENANT.getTime() + 20 * JOUR);
    const m = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: finActuelle });
    const v = await demande(m.id, { billingCycle: "MONTHLY" });

    const res = await activateSubscriptionRecord(v.id);

    expect(mois(res!.endDate)).toBe(mois(finActuelle) + 1);
    expect(res!.endDate.getTime()).toBeGreaterThan(finActuelle.getTime() + 25 * JOUR);
  });

  it("deux confirmations de suite (rejeu de webhook, double clic) : la seconde rend le même enregistrement sans reprolonger", async () => {
    const m = await createManager({ subscriptionStatus: "EXPIRED", subscriptionPlan: "STARTER", subscriptionEndsAt: new Date(2026, 0, 1) });
    const v = await demande(m.id);

    const premiere = await activateSubscriptionRecord(v.id);
    const finApresPremiere = (await compte(m.id)).subscriptionEndsAt!.getTime();
    const seconde = await activateSubscriptionRecord(v.id);

    expect(seconde?.id).toBe(premiere?.id);
    expect((await compte(m.id)).subscriptionEndsAt!.getTime()).toBe(finApresPremiere);
  });
});

describe("renewSubscriptionFromStripeInvoice", () => {
  async function abonneStripe(o: Partial<typeof platformSubscriptions.$inferInsert> = {}) {
    const fin = new Date(MAINTENANT.getTime() + 10 * JOUR);
    const m = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: fin, stripeSubscriptionId: "sub_test", stripeCustomerId: "cus_test" });
    const premier = await createPlatformSubscription(m.id, { plan: "PRO", amount: 29, currency: "EUR", billingCycle: "MONTHLY", paymentMethod: "STRIPE", paymentRef: "cs_premier", ...o });
    return { m, fin, premier };
  }
  const renouveler = (o: Partial<Parameters<typeof renewSubscriptionFromStripeInvoice>[0]> = {}) =>
    renewSubscriptionFromStripeInvoice({ stripeSubscriptionId: "sub_test", stripeInvoiceId: "in_cycle_2", montantPaye: 29, devise: "EUR", ...o });

  it("un abonnement Stripe inconnu ne prolonge rien (null)", async () => {
    const { m } = await abonneStripe();

    expect(await renouveler({ stripeSubscriptionId: "sub_inconnu" })).toBeNull();
    expect(await lignesDe(m.id)).toHaveLength(1);
  });

  it("un compte sans aucun paiement confirmé ne se renouvelle pas (null) : rien à reconduire", async () => {
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", stripeSubscriptionId: "sub_test" });

    expect(await renouveler()).toBeNull();
  });

  it("un compte qui n'a qu'un paiement en attente ou rejeté ne se renouvelle pas (null) : seul un paiement CONFIRMÉ sert de modèle", async () => {
    const m = await createManager({ subscriptionStatus: "EXPIRED", subscriptionPlan: "PRO", stripeSubscriptionId: "sub_test" });
    await createPlatformSubscription(m.id, { status: "PENDING", plan: "PRO", amount: 29, currency: "EUR", paymentMethod: "STRIPE", paymentRef: "cs_attente" });
    await createPlatformSubscription(m.id, { status: "REJECTED", plan: "PRO", amount: 29, currency: "EUR", paymentMethod: "BANK_TRANSFER" });

    expect(await renouveler()).toBeNull();
    expect(await lignesDe(m.id)).toHaveLength(2);
    expect((await compte(m.id)).subscriptionStatus).toBe("EXPIRED");
  });

  it("un renouvellement mensuel crée une ligne payée par Stripe, au même plan, montant et devise, et prolonge d'un mois à partir de la fin actuelle", async () => {
    const { m, fin } = await abonneStripe();

    const res = await renouveler();

    expect(res).toMatchObject({ status: "PAID", paymentMethod: "STRIPE", paymentRef: "in_cycle_2", plan: "PRO", amount: 29, currency: "EUR", billingCycle: "MONTHLY" });
    expect(mois(res!.endDate)).toBe(mois(fin) + 1);
    expect(res!.endDate.getDate()).toBe(fin.getDate()); // le 25 du mois suivant, pas le 15 : on repart de l'ancienne fin
    const apres = await compte(m.id);
    expect(apres.subscriptionStatus).toBe("ACTIVE");
    expect(apres.subscriptionEndsAt?.getTime()).toBe(res!.endDate.getTime());
    expect(await lignesDe(m.id)).toHaveLength(2);
  });

  it("un renouvellement d'un abonnement ANNUEL prolonge de douze mois et garde le cycle annuel", async () => {
    const { m, fin } = await abonneStripe({ billingCycle: "ANNUAL", amount: 290 });

    const res = await renouveler({ montantPaye: 290 });

    expect(res?.billingCycle).toBe("ANNUAL");
    expect(mois(res!.endDate)).toBe(mois(fin) + 12);
    expect(res!.endDate.getDate()).toBe(fin.getDate());
    expect(mois((await compte(m.id)).subscriptionEndsAt!)).toBe(mois(fin) + 12);
  });

  it("le renouvellement d'un compte dont l'accès était expiré le rouvre (ACTIVE) et repart d'aujourd'hui", async () => {
    const m = await createManager({ subscriptionStatus: "EXPIRED", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(2026, 5, 1), stripeSubscriptionId: "sub_test" });
    await createPlatformSubscription(m.id, { plan: "PRO", amount: 29, currency: "EUR", billingCycle: "MONTHLY", paymentMethod: "STRIPE", paymentRef: "cs_premier" });

    const res = await renouveler();

    expect(res?.status).toBe("PAID");
    const apres = await compte(m.id);
    expect(apres.subscriptionStatus).toBe("ACTIVE");
    expect(mois(apres.subscriptionEndsAt!)).toBe(mois(MAINTENANT) + 1);
  });

  it("un rejeu de la même facture rend la ligne déjà créée : pas de seconde prolongation, pas de seconde ligne", async () => {
    const { m } = await abonneStripe();
    const premiere = await renouveler();
    const finApres = (await compte(m.id)).subscriptionEndsAt!.getTime();

    const rejeu = await renouveler();

    expect(rejeu?.id).toBe(premiere?.id);
    expect((await compte(m.id)).subscriptionEndsAt!.getTime()).toBe(finApres);
    expect(await lignesDe(m.id)).toHaveLength(2);
  });

  it("un montant ou une devise qui ne correspondent pas, ou un montant illisible, ne prolongent rien (null, avertissement)", async () => {
    const { m, fin } = await abonneStripe();

    for (const faux of [{ montantPaye: 28.9 }, { montantPaye: 29.01 }, { montantPaye: 0 }, { montantPaye: Number.NaN }, { devise: "XOF" }]) {
      expect(await renouveler({ stripeInvoiceId: `in_${JSON.stringify(faux)}`, ...faux }), JSON.stringify(faux)).toBeNull();
    }

    expect(await lignesDe(m.id)).toHaveLength(1);
    expect((await compte(m.id)).subscriptionEndsAt?.getTime()).toBe(fin.getTime());
    expect(console.warn).toHaveBeenCalled();
  });

  it("l'écart d'arrondi de moins d'un centime et la casse de la devise sont tolérés", async () => {
    const { m } = await abonneStripe();

    const res = await renouveler({ montantPaye: 29.005, devise: "eur" });

    expect(res?.status).toBe("PAID");
    expect(await lignesDe(m.id)).toHaveLength(2);
  });

  it("le renouvellement s'appuie sur le DERNIER paiement confirmé : un ancien tarif ne sert plus", async () => {
    const { m } = await abonneStripe({ amount: 9, plan: "STARTER", createdAt: new Date(MAINTENANT.getTime() - 60 * JOUR) });
    await createPlatformSubscription(m.id, { plan: "PRO", amount: 29, currency: "EUR", paymentMethod: "STRIPE", paymentRef: "cs_second", createdAt: new Date(MAINTENANT.getTime() - 30 * JOUR) });

    expect(await renouveler({ montantPaye: 9, stripeInvoiceId: "in_ancien_tarif" })).toBeNull();
    expect((await renouveler({ montantPaye: 29, stripeInvoiceId: "in_dernier_tarif" }))?.plan).toBe("PRO");
  });
});

describe("expireStripeSubscription", () => {
  it("efface la référence de l'abonnement Stripe de ce compte seulement, et laisse le client Stripe, le statut et la fin d'accès", async () => {
    const fin = new Date(MAINTENANT.getTime() + 10 * JOUR);
    const concerne = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: fin, stripeSubscriptionId: "sub_a", stripeCustomerId: "cus_a" });
    const autre = await createManager({ subscriptionStatus: "ACTIVE", stripeSubscriptionId: "sub_b", stripeCustomerId: "cus_b" });

    await expireStripeSubscription("sub_a");

    const apres = await compte(concerne.id);
    expect(apres.stripeSubscriptionId).toBeNull();
    expect(apres.stripeCustomerId).toBe("cus_a");
    expect(apres.subscriptionStatus).toBe("ACTIVE");
    expect(apres.subscriptionEndsAt?.getTime()).toBe(fin.getTime());
    expect((await compte(autre.id)).stripeSubscriptionId).toBe("sub_b");
  });

  it("un abonnement inconnu ne touche personne", async () => {
    const m = await createManager({ stripeSubscriptionId: "sub_c" });

    await expireStripeSubscription("sub_inconnu");

    expect((await compte(m.id)).stripeSubscriptionId).toBe("sub_c");
  });
});
