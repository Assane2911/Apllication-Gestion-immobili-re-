import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { users } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { runSubscriptionExpiryNotices } from "./finAcces.service";

/**
 * Audit par sabotage de finAcces.service.ts : les cas que finAcces.test.ts ne tenait pas — limites exactes de la fenêtre et du
 * délai de reconduction, profils de comptes à dates croisées (jamais de message pour un abonnement lointain), portée des
 * marqueurs « déjà prévenu » (un compte ne touche jamais celui d'un autre), contenu du message, budget épuisé.
 *
 * Même horloge que finAcces.test.ts : le 12 octobre 2026, 10 h, figée. Aucun e-mail réel : `sendEmail` est remplacé.
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
const destinataires = () => messages().map((m: { a: string }) => m.a);
const essai = (jours: number, heures = 0, extra: Record<string, unknown> = {}) =>
  createManager({ subscriptionStatus: "TRIAL", trialEndsAt: dans(jours, heures), subscriptionEndsAt: null, ...extra });
const abonnement = (jours: number, heures = 0, extra: Record<string, unknown> = {}) =>
  createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: dans(jours, heures), trialEndsAt: null, ...extra });
const relire = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0];

describe("limites exactes de la fenêtre", () => {
  it("rattrapage : un essai terminé depuis exactement 3 jours est encore annoncé « terminé » ; une heure de plus, jamais", async () => {
    const limite = await essai(-3);
    await essai(-3, -1); // 3 jours et 1 heure : hors fenêtre

    await runSubscriptionExpiryNotices();

    expect(destinataires()).toEqual([limite.email]);
    expect(messages()[0].sujet).toBe("Votre essai gratuit est terminé");
  });

  it("l'essai qui se termine à l'instant précis du passage est « terminé », pas « bientôt »", async () => {
    await essai(0);

    await runSubscriptionExpiryNotices();

    expect(messages().map((m: { sujet: string }) => m.sujet)).toEqual(["Votre essai gratuit est terminé"]);
  });
});

describe("abonnement reconduit automatiquement : un jour de délai avant de dire « terminé »", () => {
  it("rien à 23 h 30 après l'échéance ; le message part à 24 h pile et au-delà", async () => {
    await abonnement(0, -23.5, { stripeSubscriptionId: "sub_1" });
    const pile = await abonnement(0, -24, { stripeSubscriptionId: "sub_2" });
    const plusTard = await abonnement(0, -24.5, { stripeSubscriptionId: "sub_3" });

    await runSubscriptionExpiryNotices();

    expect(destinataires().sort()).toEqual([pile.email, plusTard.email].sort());
    expect(messages()[0].sujet).toBe("Votre abonnement est arrivé à échéance");
  });

  it("un abonnement payé À LA MAIN, échu depuis 2 heures, est prévenu tout de suite (le délai ne le concerne pas)", async () => {
    const m = await abonnement(0, -2);

    await runSubscriptionExpiryNotices();

    expect(destinataires()).toEqual([m.email]);
    expect(messages()[0].sujet).toBe("Votre abonnement est arrivé à échéance");
  });

  it("un abonnement RÉSILIÉ (même avec un identifiant Stripe) ne se renouvelle plus : il est prévenu de sa fin", async () => {
    const m = await abonnement(2, 0, { subscriptionStatus: "CANCELLED", stripeSubscriptionId: "sub_resilie" });

    await runSubscriptionExpiryNotices();

    expect(destinataires()).toEqual([m.email]);
    expect(messages()[0].sujet).toBe("Votre abonnement se termine dans 2 jours");
  });
});

describe("profils à dates croisées : jamais de message pour un accès qui n'est pas près de finir", () => {
  it.each([
    ["un abonnement actif avec une ancienne date d'essai proche (souscrit pendant l'essai)", () => abonnement(30, 0, { trialEndsAt: dans(2) })],
    ["un essai lointain avec une ancienne date d'abonnement proche", () => essai(30, 0, { subscriptionEndsAt: dans(2) })],
    ["un compte au statut « expiré », même avec une date d'abonnement dans la fenêtre", () => abonnement(-1, 0, { subscriptionStatus: "EXPIRED" })],
    ["un abonnement manuel échu depuis 60 jours", () => abonnement(-60)],
    ["un abonnement résilié échu depuis 400 jours", () => abonnement(-400, 0, { subscriptionStatus: "CANCELLED" })],
    ["un abonnement qui se termine dans un mois", () => abonnement(30)],
    ["un abonnement qui se termine dans 300 jours", () => abonnement(300)],
    ["un abonnement qui se termine dans 4 jours (hors des 3 jours)", () => abonnement(4)],
  ])("%s", async (_nom, creer) => {
    await creer();

    const r = await runSubscriptionExpiryNotices();

    expect(r.sent).toBe(0);
    expect(messages()).toHaveLength(0);
  });
});

describe("marqueurs « déjà prévenu » : chaque compte ne touche que le sien", () => {
  it("deux comptes à la MÊME échéance reçoivent chacun leur message, et chacun garde son marqueur", async () => {
    const a = await essai(2);
    const b = await essai(2);

    const r = await runSubscriptionExpiryNotices();

    expect(r.sent).toBe(2);
    expect(destinataires().sort()).toEqual([a.email, b.email].sort());
    expect((await relire(a.id)).endingNoticeFor!.getTime()).toBe(dans(2).getTime());
    expect((await relire(b.id)).endingNoticeFor!.getTime()).toBe(dans(2).getTime());
  });

  it("si l'envoi échoue pour un compte, son marqueur est rendu — et celui d'un autre compte, à la même échéance, reste en place", async () => {
    const enPanne = await essai(2);
    const reussi = await essai(2);
    envoi.mockImplementation(async (a: unknown) => (a === enPanne.email ? { error: "panne" } : { simulated: true }) as never);

    const r = await runSubscriptionExpiryNotices();

    expect(r).toMatchObject({ sent: 1, echecs: 1 });
    expect((await relire(enPanne.id)).endingNoticeFor).toBeNull();
    expect((await relire(reussi.id)).endingNoticeFor!.getTime()).toBe(dans(2).getTime());
  });

  it("en cas d'échec d'un message « terminé », c'est le marqueur « terminé » qui est rendu, pas celui de « bientôt »", async () => {
    const ancienBientot = dans(-2);
    const m = await essai(-1, 0, { endingNoticeFor: ancienBientot }); // « bientôt » est déjà parti
    envoi.mockResolvedValueOnce({ error: "panne" } as never);

    await runSubscriptionExpiryNotices();

    const apres = await relire(m.id);
    expect(apres.endedNoticeFor).toBeNull();
    expect(apres.endingNoticeFor!.getTime()).toBe(ancienBientot.getTime());
  });

  it("en cas d'échec d'un message « bientôt », c'est le marqueur « bientôt » qui est rendu, pas celui de « terminé »", async () => {
    const ancienTermine = dans(-30);
    const m = await essai(2, 0, { endedNoticeFor: ancienTermine });
    envoi.mockResolvedValueOnce({ error: "panne" } as never);

    await runSubscriptionExpiryNotices();

    const apres = await relire(m.id);
    expect(apres.endingNoticeFor).toBeNull();
    expect(apres.endedNoticeFor!.getTime()).toBe(ancienTermine.getTime());
  });
});

describe("le message", () => {
  it("dit la date de fin, avec le lien complet vers l'abonnement de l'application", async () => {
    await essai(2); // le 14 octobre 2026

    await runSubscriptionExpiryNotices();

    const [msg] = messages();
    expect(msg.html).toContain("14 octobre 2026");
    expect(msg.html).toContain(`${env.frontendUrl}/subscription`);
  });

  it("un essai qui finit dans 2 heures, le jour même, est annoncé « demain » (jamais « aujourd'hui »)", async () => {
    await essai(0, 2);

    await runSubscriptionExpiryNotices();

    expect(messages()[0].html).toContain("(demain)");
  });
});

describe("budget de temps épuisé", () => {
  it("rien n'est réclamé ni envoyé, l'exécution se déclare interrompue, et la suivante reprend", async () => {
    const m = await essai(2);

    const interrompue = await runSubscriptionExpiryNotices({ epuise: () => true, restant: () => 0 });

    expect(interrompue).toEqual({ sent: 0, echecs: 0, interrompu: true });
    expect(messages()).toHaveLength(0);
    expect((await relire(m.id)).endingNoticeFor).toBeNull();

    const reprise = await runSubscriptionExpiryNotices();

    expect(reprise).toEqual({ sent: 1, echecs: 0, interrompu: false });
  });
});
