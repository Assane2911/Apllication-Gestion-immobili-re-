import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "../db/schema";
import { createManager, createTeamMember } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { runSubscriptionExpiryNotices } from "./finAcces.service";

/**
 * E-mails de fin d'essai gratuit et de fin d'abonnement. Horloge figée au 12 octobre 2026, 10 h.
 * Aucun e-mail réel : `sendEmail` est remplacé.
 */
const MAINTENANT = new Date(2026, 9, 12, 10);
const dans = (jours: number, heures = 0) => new Date(MAINTENANT.getTime() + jours * 86_400_000 + heures * 3_600_000);

let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const messages = () => envoi.mock.calls.map((c: unknown[]) => ({ a: c[0] as string, sujet: c[1] as string, html: c[2] as string }));
const essai = (jours: number, extra: Record<string, unknown> = {}) =>
  createManager({ subscriptionStatus: "TRIAL", trialEndsAt: dans(jours), subscriptionEndsAt: null, ...extra });
const abonnement = (jours: number, extra: Record<string, unknown> = {}) =>
  createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: dans(jours), trialEndsAt: null, ...extra });

describe("fin d'essai gratuit", () => {
  it("prévient 3 jours avant la fin, avec la date et le lien vers l'abonnement", async () => {
    const m = await essai(2);

    const r = await runSubscriptionExpiryNotices();

    expect(r.sent).toBe(1);
    const [msg] = messages();
    expect(msg.a).toBe(m.email);
    expect(msg.sujet).toBe("Votre essai gratuit se termine dans 2 jours");
    expect(msg.html).toContain("/subscription");
    expect(msg.html).toContain("Choisir une formule");
  });

  it("n'envoie pas deux fois le même message, même si le cron repasse", async () => {
    await essai(2);

    await runSubscriptionExpiryNotices();
    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(1);
  });

  it("deux exécutions simultanées n'envoient qu'un seul message", async () => {
    await essai(1);

    await Promise.all([runSubscriptionExpiryNotices(), runSubscriptionExpiryNotices()]);

    expect(messages()).toHaveLength(1);
  });

  it("dit « demain » à la veille de la fin", async () => {
    await essai(1);

    await runSubscriptionExpiryNotices();

    expect(messages()[0].sujet).toBe("Votre essai gratuit se termine demain");
  });

  it("annonce la fin le lendemain de l'échéance (accès suspendu)", async () => {
    await essai(-1);

    await runSubscriptionExpiryNotices();

    expect(messages()[0].sujet).toBe("Votre essai gratuit est terminé");
  });

  it("l'avertissement « bientôt » puis le message « terminé » partent chacun une fois", async () => {
    const m = await essai(2);
    await runSubscriptionExpiryNotices();
    vi.setSystemTime(dans(3));
    await runSubscriptionExpiryNotices();
    await runSubscriptionExpiryNotices();

    expect(messages().map((x: { sujet: string }) => x.sujet)).toEqual(["Votre essai gratuit se termine dans 2 jours", "Votre essai gratuit est terminé"]);
    expect(messages().every((x: { a: string }) => x.a === m.email)).toBe(true);
  });

  it("ne relance JAMAIS un compte expiré depuis plus de 3 jours (pas d'envoi massif aux anciens comptes)", async () => {
    await essai(-4);
    await essai(-60);
    await essai(-400);

    const r = await runSubscriptionExpiryNotices();

    expect(r.sent).toBe(0);
    expect(messages()).toHaveLength(0);
  });

  it("ne dit rien quand la fin est encore lointaine", async () => {
    await essai(4);
    await essai(30);

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(0);
  });

  it("une échéance prolongée (parrainage, jours offerts) relance le cycle pour la nouvelle date", async () => {
    const m = await essai(2);
    await runSubscriptionExpiryNotices();
    await testDb.update(users).set({ trialEndsAt: dans(2, 5) }).where(eq(users.id, m.id));

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(2);
  });
});

describe("fin d'abonnement", () => {
  it("prévient 3 jours avant la fin d'un abonnement à renouveler à la main", async () => {
    await abonnement(2);

    await runSubscriptionExpiryNotices();

    const [msg] = messages();
    expect(msg.sujet).toBe("Votre abonnement se termine dans 2 jours");
    expect(msg.html).toContain("Renouveler mon abonnement");
  });

  it("annonce l'échéance d'un abonnement passé depuis un jour", async () => {
    await abonnement(-1);

    await runSubscriptionExpiryNotices();

    expect(messages()[0].sujet).toBe("Votre abonnement est arrivé à échéance");
  });

  it("couvre aussi l'abonnement résilié dont la période payée se termine", async () => {
    await abonnement(2, { subscriptionStatus: "CANCELLED" });

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(1);
  });

  it("n'avertit PAS d'une fin pour un abonnement à reconduction automatique (il se renouvelle seul)", async () => {
    await abonnement(2, { stripeSubscriptionId: "sub_test_1" });

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(0);
  });

  it("laisse un jour au renouvellement automatique avant de dire « terminé »", async () => {
    await abonnement(0, { stripeSubscriptionId: "sub_test_2", subscriptionEndsAt: dans(0, -1) });

    await runSubscriptionExpiryNotices();
    expect(messages()).toHaveLength(0);

    vi.setSystemTime(dans(1, 2));
    await runSubscriptionExpiryNotices();
    expect(messages().map((x: { sujet: string }) => x.sujet)).toEqual(["Votre abonnement est arrivé à échéance"]);
  });

  it("un accès sans date de fin (illimité) ne reçoit rien", async () => {
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null, trialEndsAt: null });

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(0);
  });
});

describe("qui ne reçoit rien", () => {
  it("un compte suspendu : rien, et le message part à la réactivation tant que l'échéance est dans la fenêtre", async () => {
    const m = await essai(2, { suspendedAt: new Date() });
    await runSubscriptionExpiryNotices();
    expect(messages()).toHaveLength(0);

    await testDb.update(users).set({ suspendedAt: null }).where(eq(users.id, m.id));
    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(1);
  });

  it("une adresse non confirmée", async () => {
    await essai(2, { emailVerifiedAt: null });

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(0);
  });

  it("un collaborateur invité (seul le propriétaire de l'agence est prévenu)", async () => {
    const agence = await createManager();
    const collaborateur = await createTeamMember(agence.id);
    // createTeamMember met le propriétaire en formule Entreprise : on le remet en essai qui se termine, collaborateur compris.
    await testDb.update(users).set({ subscriptionStatus: "TRIAL", trialEndsAt: dans(2), subscriptionEndsAt: null }).where(eq(users.id, agence.id));
    await testDb.update(users).set({ subscriptionStatus: "TRIAL", trialEndsAt: dans(2), subscriptionEndsAt: null }).where(eq(users.id, collaborateur.id));

    await runSubscriptionExpiryNotices();

    expect(messages().map((x: { a: string }) => x.a)).toEqual([agence.email]);
  });

  it("les locataires et les propriétaires (comptes portail)", async () => {
    await testDb.update(users).set({ role: "TENANT" }).where(eq(users.id, (await essai(2)).id));

    await runSubscriptionExpiryNotices();

    expect(messages()).toHaveLength(0);
  });
});

describe("langue et échec d'envoi", () => {
  it("écrit dans la langue du gestionnaire", async () => {
    const m = await essai(2);
    await testDb.update(users).set({ language: "en" }).where(eq(users.id, m.id));

    await runSubscriptionExpiryNotices();

    expect(messages()[0].sujet).toBe("Your free trial ends in 2 days");
  });

  it("une langue inconnue retombe sur le français", async () => {
    const m = await essai(2);
    await testDb.update(users).set({ language: "de" }).where(eq(users.id, m.id));

    await runSubscriptionExpiryNotices();

    expect(messages()[0].sujet).toContain("Votre essai gratuit");
  });

  it("si l'envoi échoue, le marqueur est rendu et l'exécution suivante réessaie", async () => {
    await essai(2);
    envoi.mockResolvedValueOnce({ error: "panne" } as never);

    const premiere = await runSubscriptionExpiryNotices();
    const seconde = await runSubscriptionExpiryNotices();

    expect(premiere).toMatchObject({ sent: 0, echecs: 1 });
    expect(seconde.sent).toBe(1);
    expect(messages()).toHaveLength(2);
  });
});
