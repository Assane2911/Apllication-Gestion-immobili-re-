import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Les étapes du travail quotidien (/api/cron/daily) s'enchaînaient sans
 * protection : une exception dans la première interrompait la route, et rien
 * de ce qui suivait — passage en retard des factures, avis d'échéance, dépenses
 * récurrentes, rappels d'assurance — ne s'exécutait ce jour-là.
 *
 * Ces tests mettent chaque étape en panne à tour de rôle et vérifient que
 * TOUTES les autres tournent quand même, que la panne est signalée (500 + nom de
 * l'étape) et que les compteurs des étapes réussies restent dans la réponse.
 */
const { pannes, appels, etat } = vi.hoisted(() => ({
  pannes: new Set<string>(),
  appels: [] as string[],
  // markOverdueInvoices est appelée deux fois par exécution : par SA PROPRE étape
  // (la première), puis en interne par les rappels « avant échéance » (voir
  // runUpcomingRentDueReminders). Seul le premier appel est une étape du cron.
  etat: { retardsDejaAppele: false },
}));

function surveille<T extends (...args: never[]) => Promise<unknown>>(nom: string, reel: T): T {
  return (async (...args: Parameters<T>) => {
    appels.push(nom);
    if (pannes.has(nom)) throw new Error(`panne simulée : ${nom}`);
    return reel(...args);
  }) as T;
}

vi.mock("../services/reminder.service", async () => {
  const actual = await vi.importActual<typeof import("../services/reminder.service")>("../services/reminder.service");
  return {
    ...actual,
    runContractEndingReminders: surveille("rappels de fin de contrat", actual.runContractEndingReminders),
    runUpcomingRentDueReminders: surveille("rappels avant échéance", actual.runUpcomingRentDueReminders),
    runRentDueReminders: surveille("avis d'échéance et facturation du mois", actual.runRentDueReminders),
    runInsurancePolicyExpiryReminders: surveille("rappels d'assurance", actual.runInsurancePolicyExpiryReminders),
  };
});
vi.mock("../services/recurringExpense.service", async () => {
  const actual = await vi.importActual<typeof import("../services/recurringExpense.service")>("../services/recurringExpense.service");
  return { ...actual, runRecurringExpenseGeneration: surveille("dépenses récurrentes", actual.runRecurringExpenseGeneration) };
});
vi.mock("../services/conservation.service", async () => {
  const actual = await vi.importActual<typeof import("../services/conservation.service")>("../services/conservation.service");
  return { ...actual, purgerDonneesDeLaPlateforme: surveille("purge des données de la plateforme", actual.purgerDonneesDeLaPlateforme) };
});
vi.mock("../services/invoice.service", async () => {
  const actual = await vi.importActual<typeof import("../services/invoice.service")>("../services/invoice.service");
  const nom = "passage en retard des factures échues";
  return {
    ...actual,
    markOverdueInvoices: async () => {
      if (!etat.retardsDejaAppele) {
        etat.retardsDejaAppele = true;
        appels.push(nom);
        if (pannes.has(nom)) throw new Error(`panne simulée : ${nom}`);
      }
      return actual.markOverdueInvoices();
    },
  };
});

import { app } from "../app";
import { invoices } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const CRON = () => ({ Authorization: `Bearer ${process.env.CRON_SECRET}` });
const lancer = () => request(app).get("/api/cron/daily").set(CRON());

const ETAPES = [
  "passage en retard des factures échues",
  "purge des données de la plateforme",
  "rappels de fin de contrat",
  "rappels avant échéance",
  "avis d'échéance et facturation du mois",
  "dépenses récurrentes",
  "rappels d'assurance",
];

beforeEach(() => {
  pannes.clear();
  appels.length = 0;
  etat.retardsDejaAppele = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/cron/daily — isolation des étapes", () => {
  it("sans panne : 200, aucune étape en échec, les sept étapes tournent dans l'ordre", async () => {
    const res = await lancer();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.etapesEnEchec).toEqual([]);
    expect(appels).toEqual(ETAPES);
  });

  it.each(ETAPES)("une panne de « %s » n'empêche aucune des autres étapes de tourner", async (etape) => {
    pannes.add(etape);

    const res = await lancer();

    // Toutes les étapes ont été tentées, y compris celles qui suivent la panne.
    expect(appels).toEqual(ETAPES);
    // La panne reste visible : 500 (Vercel marque l'exécution en erreur) et le nom de l'étape.
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.etapesEnEchec).toEqual([{ etape, message: `panne simulée : ${etape}` }]);
  });

  it("signale TOUTES les étapes en panne, pas seulement la première", async () => {
    pannes.add("rappels de fin de contrat");
    pannes.add("dépenses récurrentes");

    const res = await lancer();

    expect(res.status).toBe(500);
    expect(res.body.etapesEnEchec.map((e: { etape: string }) => e.etape)).toEqual([
      "rappels de fin de contrat",
      "dépenses récurrentes",
    ]);
    expect(appels).toEqual(ETAPES);
  });

  /**
   * Le scénario qui motivait ce correctif : l'étape 1 tombe en panne, une facture
   * échue depuis 20 jours restait « en attente » et n'était jamais déclarée en
   * retard (réponse 500 sans rien d'autre de fait).
   */
  it("passe quand même les factures échues en retard et envoie les avis du mois quand une étape tombe", async () => {
    pannes.add("rappels de fin de contrat");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      startDate: new Date(2020, 0, 1),
      endDate: new Date(2030, 0, 1),
    });
    const echue = await createInvoice(contract.id, {
      status: "PENDING",
      periodMonth: 1,
      periodYear: 2020,
      dueDate: new Date(Date.now() - 20 * 86_400_000),
    });

    const res = await lancer();

    expect(res.status).toBe(500);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, echue.id));
    expect(apres.status).toBe("LATE");
    expect(res.body.facturesPasseesEnRetard).toBeGreaterThanOrEqual(1);
    // L'étape suivante a livré son travail : l'avis d'échéance du mois est parti.
    expect(res.body.rentDueRemindersSent).toBe(1);
  });

  it("passe les factures en retard même quand les rappels « avant échéance » tombent en panne (plus de dépendance cachée)", async () => {
    pannes.add("rappels avant échéance");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const echue = await createInvoice(contract.id, {
      status: "PENDING",
      dueDate: new Date(Date.now() - 20 * 86_400_000),
    });

    await lancer();

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, echue.id));
    expect(apres.status).toBe("LATE");
  });

  it("garde les compteurs des étapes réussies dans la réponse d'une exécution partielle", async () => {
    pannes.add("purge des données de la plateforme");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      startDate: new Date(2020, 0, 1),
      endDate: new Date(2030, 0, 1),
    });

    const res = await lancer();

    expect(res.status).toBe(500);
    expect(res.body.purge).toBeNull();
    expect(res.body.rentDueRemindersSent).toBe(1);
    expect(typeof res.body.upcomingRentDueRemindersSent).toBe("number");
  });

  it("écrit une ligne de résumé dans les journaux, lisible sans le corps de la réponse", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      startDate: new Date(2020, 0, 1),
      endDate: new Date(2030, 0, 1),
    });

    await lancer();

    const resumes = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[cron] Résumé du jour"));
    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toContain("— OK |");
    expect(resumes[0]).toContain("avis d'échéance : 1");
    expect(resumes[0]).toContain("interrompu faute de temps : non");
    // Aucune donnée personnelle : ni l'email ni le nom du locataire.
    expect(resumes[0]).not.toContain(tenant.email);
    expect(resumes[0]).not.toContain(tenant.lastName);
  });

  it("en cas de panne, la ligne de résumé (en avertissement) nomme les étapes tombées, sans leur message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pannes.add("rappels de fin de contrat");
    pannes.add("purge des données de la plateforme");

    await lancer();

    const resumes = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[cron] Résumé du jour"));
    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toContain("ÉCHEC de 2 étape(s) : purge des données de la plateforme, rappels de fin de contrat");
    expect(resumes[0]).toContain("purge : non faite");
    expect(resumes[0]).not.toContain("panne simulée");
  });

  it("refuse toujours l'appel sans secret, avant d'exécuter la moindre étape", async () => {
    const res = await request(app).get("/api/cron/daily");

    expect(res.status).toBe(401);
    expect(appels).toEqual([]);
  });
});
