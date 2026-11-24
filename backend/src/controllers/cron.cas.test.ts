import crypto from "crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import * as finAcces from "../services/finAcces.service";
import * as reminders from "../services/reminder.service";
import * as recurring from "../services/recurringExpense.service";
import * as relances from "../services/relances.service";
import type { BudgetTemps } from "../utils/budgetTemps";

/**
 * Tâche planifiée (cron.controller.ts) : cas limites trouvés en sabotant le contrôleur, que les tests existants
 * laissaient passer. Réponses exactes des routes individuelles, budget de temps transmis aux travaux, messages
 * d'autorisation, comparaison du secret en temps constant et journalisation d'une étape en échec.
 */
const CRON_SECRET = process.env.CRON_SECRET!;
const autorise = { Authorization: `Bearer ${CRON_SECRET}` };
const empreinte = (valeur: string) => crypto.createHash("sha256").update(valeur).digest();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routes individuelles : réponse exacte", () => {
  it("fin de contrat : envois, échecs et interruption du travail sont rendus tels quels", async () => {
    vi.spyOn(reminders, "runContractEndingReminders").mockResolvedValue({ sent: 2, echecs: 3, interrompu: true } as never);

    const res = await request(app).get("/api/cron/contract-reminders").set(autorise);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, remindersSent: 2, echecs: 3, interrompu: true });
  });

  it("avis d'échéance : message, envois, échecs, interruption et détails", async () => {
    vi.spyOn(reminders, "runRentDueReminders").mockResolvedValue({ sent: 2, echecs: 3, interrompu: true, details: [{ contrat: "c1" }] } as never);

    const res = await request(app).get("/api/cron/rent-due-reminders").set(autorise);

    expect(res.body).toEqual({
      success: true,
      message: "2 avis d'échéance de loyer envoyé(s)",
      remindersSent: 2,
      echecs: 3,
      interrompu: true,
      details: [{ contrat: "c1" }],
    });
  });

  it("rappels avant échéance : message, envois, échecs, interruption et détails", async () => {
    vi.spyOn(reminders, "runUpcomingRentDueReminders").mockResolvedValue({ sent: 2, echecs: 3, interrompu: true, details: [{ contrat: "c2" }] } as never);

    const res = await request(app).get("/api/cron/rent-due-soon-reminders").set(autorise);

    expect(res.body).toEqual({
      success: true,
      message: '2 rappel(s) "avant échéance" envoyé(s)',
      remindersSent: 2,
      echecs: 3,
      interrompu: true,
      details: [{ contrat: "c2" }],
    });
  });

  it("dépenses récurrentes : message, nombre généré et interruption", async () => {
    vi.spyOn(recurring, "runRecurringExpenseGeneration").mockResolvedValue({ generees: 4, interrompu: true } as never);

    const res = await request(app).get("/api/cron/recurring-expenses").set(autorise);

    expect(res.body).toEqual({ success: true, message: "4 dépense(s) récurrente(s) générée(s)", generees: 4, interrompu: true });
  });

  it("rappels d'assurance : message, envois, échecs et interruption", async () => {
    vi.spyOn(reminders, "runInsurancePolicyExpiryReminders").mockResolvedValue({ sent: 2, echecs: 3, interrompu: true } as never);

    const res = await request(app).get("/api/cron/insurance-reminders").set(autorise);

    expect(res.body).toEqual({ success: true, message: "2 rappel(s) d'échéance d'assurance envoyé(s)", remindersSent: 2, echecs: 3, interrompu: true });
  });
});

describe("routes individuelles : budget de temps", () => {
  it.each([
    ["/api/cron/contract-reminders", reminders, "runContractEndingReminders", 0],
    ["/api/cron/rent-due-reminders", reminders, "runRentDueReminders", 1],
    ["/api/cron/rent-due-soon-reminders", reminders, "runUpcomingRentDueReminders", 0],
    ["/api/cron/recurring-expenses", recurring, "runRecurringExpenseGeneration", 0],
    ["/api/cron/insurance-reminders", reminders, "runInsurancePolicyExpiryReminders", 0],
  ] as const)("%s reçoit le budget de temps de la configuration", async (route, module, fonction, position) => {
    const espion = vi.spyOn(module as unknown as Record<string, (...args: unknown[]) => unknown>, fonction);
    espion.mockResolvedValue({ sent: 0, echecs: 0, interrompu: false, generees: 0, details: [] } as never);

    await request(app).get(route).set(autorise);

    const budget = espion.mock.calls[0][position] as BudgetTemps;
    expect(budget.epuise()).toBe(false);
    expect(budget.restant()).toBeGreaterThan(env.cronBudgetMs - 5000);
    expect(budget.restant()).toBeLessThanOrEqual(env.cronBudgetMs);
  });
});

describe("autorisation", () => {
  const originalCronSecret = env.cronSecret;
  const originalNodeEnv = env.nodeEnv;
  const originalVercel = process.env.VERCEL;
  afterEach(() => {
    env.cronSecret = originalCronSecret;
    env.nodeEnv = originalNodeEnv;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("un mauvais secret est refusé avec le message « Non autorisé »", async () => {
    const res = await request(app).get("/api/cron/daily").set({ Authorization: "Bearer mauvais" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Non autorisé");
  });

  it("sans secret configuré en production, la route est désactivée avec un message explicite", async () => {
    env.cronSecret = "";
    env.nodeEnv = "production";

    const res = await request(app).get("/api/cron/daily");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("CRON_SECRET non configuré : route désactivée par sécurité.");
  });

  it("sans secret configuré en développement local, la route s'ouvre en le signalant dans les journaux", async () => {
    env.cronSecret = "";
    env.nodeEnv = "development";
    delete process.env.VERCEL;
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(reminders, "runUpcomingRentDueReminders").mockResolvedValue({ sent: 0, echecs: 0, interrompu: false, details: [] } as never);

    const res = await request(app).get("/api/cron/rent-due-soon-reminders");

    expect(res.status).toBe(200);
    expect(avertissement).toHaveBeenCalledWith("[cron] CRON_SECRET non configuré (développement) : route non protégée.");
  });

  it("le secret est comparé en temps constant, sur les empreintes de 32 octets de l'en-tête reçu et du secret attendu", async () => {
    const comparer = vi.spyOn(crypto, "timingSafeEqual");

    await request(app).get("/api/cron/daily").set({ Authorization: "Bearer un-en-tete-bien-plus-long-que-le-secret-attendu" });

    expect(comparer).toHaveBeenCalledTimes(1);
    const [recu, attendu] = comparer.mock.calls[0] as unknown as [Buffer, Buffer];
    expect(recu).toHaveLength(32);
    expect(recu.equals(empreinte("Bearer un-en-tete-bien-plus-long-que-le-secret-attendu"))).toBe(true);
    expect(attendu.equals(empreinte(`Bearer ${CRON_SECRET}`))).toBe(true);
  });
});

describe("travail quotidien : étape en échec", () => {
  it("une étape en échec est journalisée avec son nom, puis consignée dans la réponse sans arrêter les autres", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(relances, "runOverdueReminders").mockRejectedValue(new Error("panne des relances"));
    vi.spyOn(finAcces, "runSubscriptionExpiryNotices").mockRejectedValue(new Error("panne des fins d'accès"));

    const res = await request(app).get("/api/cron/daily").set(autorise);

    expect(res.status).toBe(500);
    expect(res.body.etapesEnEchec).toEqual([
      { etape: "relances des impayés", message: "panne des relances" },
      { etape: "e-mails de fin d'essai et d'abonnement", message: "panne des fins d'accès" },
    ]);
    expect(erreur).toHaveBeenCalledWith("[cron] Étape « relances des impayés » en échec :", expect.anything());
  });
});
