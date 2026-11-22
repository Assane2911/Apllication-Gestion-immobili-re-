import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Compte rendu de la tâche quotidienne (/api/cron/daily) : chaque compteur de la réponse vient de SA propre étape, les échecs
 * s'additionnent, une étape tombée rend zéro, l'interruption d'une seule étape suffit, l'erreur qui n'en est pas une est consignée telle
 * quelle, et la ligne de résumé des journaux dit la même chose. Les huit travaux sont remplacés par des doublures qui rendent des
 * valeurs distinctes : un compteur lu sur la mauvaise étape, ou une somme qui en oublie une, change la valeur attendue.
 */
const { etapes, ordre, budgets, sentry } = vi.hoisted(() => ({
  etapes: {} as Record<string, { resultat: unknown; panne: unknown }>,
  ordre: [] as string[],
  budgets: [] as unknown[],
  sentry: { captureException: vi.fn(), echoue: false },
}));

function doublure(nom: string, ...positionBudget: [number]) {
  return async (...args: unknown[]) => {
    ordre.push(nom);
    budgets.push(args[positionBudget[0]]);
    const etape = etapes[nom];
    if (etape.panne !== undefined) throw etape.panne;
    return etape.resultat;
  };
}

vi.mock("@sentry/node", async () => {
  const actual = await vi.importActual<typeof import("@sentry/node")>("@sentry/node");
  return {
    ...actual,
    captureException: (...args: unknown[]) => {
      sentry.captureException(...args);
      if (sentry.echoue) throw new Error("Sentry indisponible");
    },
  };
});
vi.mock("../services/reminder.service", async () => {
  const actual = await vi.importActual<typeof import("../services/reminder.service")>("../services/reminder.service");
  return {
    ...actual,
    runContractEndingReminders: doublure("fin de contrat", 0),
    runUpcomingRentDueReminders: doublure("avant échéance", 0),
    runRentDueReminders: doublure("avis d'échéance", 1),
    runInsurancePolicyExpiryReminders: doublure("assurance", 0),
    runStoredDocumentExpiryReminders: doublure("documents", 0),
  };
});
vi.mock("../services/relances.service", async () => {
  const actual = await vi.importActual<typeof import("../services/relances.service")>("../services/relances.service");
  return { ...actual, runOverdueReminders: doublure("relances", 0) };
});
vi.mock("../services/recurringExpense.service", async () => {
  const actual = await vi.importActual<typeof import("../services/recurringExpense.service")>("../services/recurringExpense.service");
  return { ...actual, runRecurringExpenseGeneration: doublure("récurrentes", 0) };
});
vi.mock("../services/finAcces.service", async () => {
  const actual = await vi.importActual<typeof import("../services/finAcces.service")>("../services/finAcces.service");
  return { ...actual, runSubscriptionExpiryNotices: doublure("fin d'accès", 0) };
});
vi.mock("../services/conservation.service", async () => {
  const actual = await vi.importActual<typeof import("../services/conservation.service")>("../services/conservation.service");
  return { ...actual, purgerDonneesDeLaPlateforme: doublure("purge", 99) };
});
vi.mock("../services/invoice.service", async () => {
  const actual = await vi.importActual<typeof import("../services/invoice.service")>("../services/invoice.service");
  return { ...actual, markOverdueInvoices: doublure("retards", 99) };
});

import { app } from "../app";
import { ligneDeResume } from "./cron.controller";

const lancer = () => request(app).get("/api/cron/daily").set({ Authorization: `Bearer ${process.env.CRON_SECRET}` });
const NOMS = ["retards", "purge", "fin de contrat", "avant échéance", "relances", "avis d'échéance", "récurrentes", "assurance", "documents", "fin d'accès"];
const ETAPES_AVEC_ECHECS = ["fin de contrat", "avant échéance", "relances", "avis d'échéance", "assurance", "documents", "fin d'accès"];

const PURGE = { jetonsEffaces: 3, journauxEffaces: 4, journauxAdminEfface: 5, compteursEfface: 6 };
function remettre() {
  etapes["retards"] = { resultat: 17, panne: undefined };
  etapes["purge"] = { resultat: PURGE, panne: undefined };
  // Un compteur (sent) distinct par étape, et un nombre d'échecs en puissances de dix pour que la somme dise lesquelles y entrent.
  etapes["fin de contrat"] = { resultat: { sent: 2, echecs: 1, interrompu: false }, panne: undefined };
  etapes["avant échéance"] = { resultat: { sent: 3, echecs: 10, interrompu: false, details: [{ contrat: "c1" }] }, panne: undefined };
  etapes["relances"] = { resultat: { sent: 4, echecs: 100, interrompu: false }, panne: undefined };
  etapes["avis d'échéance"] = { resultat: { sent: 5, echecs: 1000, interrompu: false, details: [{ contrat: "autre" }] }, panne: undefined };
  etapes["récurrentes"] = { resultat: { generees: 6, interrompu: false }, panne: undefined };
  etapes["assurance"] = { resultat: { sent: 7, echecs: 10000, interrompu: false }, panne: undefined };
  etapes["documents"] = { resultat: { sent: 8, echecs: 100000, interrompu: false }, panne: undefined };
  etapes["fin d'accès"] = { resultat: { sent: 9, echecs: 1000000, interrompu: false }, panne: undefined };
}

beforeEach(() => {
  remettre();
  ordre.length = 0;
  budgets.length = 0;
  sentry.captureException.mockClear();
  sentry.echoue = false;
  vi.restoreAllMocks();
});

describe("compteurs de la réponse : chacun vient de sa propre étape", () => {
  it("rend chaque compteur, les échecs additionnés (sans les dépenses récurrentes, qui n'en ont pas) et les détails des rappels avant échéance", async () => {
    const res = await lancer();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      etapesEnEchec: [],
      facturesPasseesEnRetard: 17,
      purge: PURGE,
      contractEndingRemindersSent: 2,
      upcomingRentDueRemindersSent: 3,
      overdueRemindersSent: 4,
      rentDueRemindersSent: 5,
      recurringExpensesGenerated: 6,
      insuranceRemindersSent: 7,
      documentRemindersSent: 8,
      accessEndEmailsSent: 9,
      echecs: 1111111,
      interrompu: false,
      details: [{ contrat: "c1" }],
    });
  });

  it("enchaîne les dix étapes dans l'ordre, avec UN SEUL budget de temps partagé", async () => {
    await lancer();

    expect(ordre).toEqual(NOMS);
    // Les huit travaux à budget reçoivent la même instance ; les deux premières étapes (retards, purge) n'en reçoivent aucune.
    const partages = budgets.filter((b) => typeof b === "object" && b !== null);
    expect(partages).toHaveLength(8);
    for (const b of partages) expect(b).toBe(partages[0]);
    expect(typeof (partages[0] as { epuise: unknown }).epuise).toBe("function");
  });
});

describe("interruption faute de temps", () => {
  for (const nom of ["fin de contrat", "avant échéance", "relances", "avis d'échéance", "récurrentes", "assurance", "documents", "fin d'accès"]) {
    it(`« ${nom} » interrompue suffit à déclarer l'exécution interrompue`, async () => {
      const etape = etapes[nom];
      etape.resultat = { ...(etape.resultat as object), interrompu: true };

      const res = await lancer();

      expect(res.status).toBe(200);
      expect(res.body.interrompu).toBe(true);
      expect(res.body.success).toBe(true);
    });
  }
});

describe("une étape en échec", () => {
  for (const nom of ETAPES_AVEC_ECHECS) {
    it(`« ${nom} » : son compteur et ses échecs tombent à zéro, les autres restent, et la réponse est une 500`, async () => {
      etapes[nom].panne = new Error("panne simulée");
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const res = await lancer();

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.etapesEnEchec).toHaveLength(1);
      expect(res.body.etapesEnEchec[0].message).toBe("panne simulée");
      // Les autres étapes tournent toutes (les dix, dans l'ordre).
      expect(ordre).toEqual(NOMS);
    });
  }

  it("toutes les étapes en échec : tout retombe à zéro, la purge à null, les détails à vide", async () => {
    for (const nom of NOMS) etapes[nom].panne = new Error(`panne ${nom}`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await lancer();

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      facturesPasseesEnRetard: 0,
      purge: null,
      contractEndingRemindersSent: 0,
      upcomingRentDueRemindersSent: 0,
      overdueRemindersSent: 0,
      rentDueRemindersSent: 0,
      recurringExpensesGenerated: 0,
      insuranceRemindersSent: 0,
      documentRemindersSent: 0,
      accessEndEmailsSent: 0,
      echecs: 0,
      interrompu: false,
      details: [],
    });
    expect(res.body.etapesEnEchec.map((e: { etape: string }) => e.etape)).toHaveLength(10);
  });

  it("une erreur qui n'est pas une Error est consignée sous forme de texte", async () => {
    etapes["relances"].panne = "chaîne lancée telle quelle";
    etapes["assurance"].panne = 42;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await lancer();

    expect(res.body.etapesEnEchec).toEqual([
      { etape: "relances des impayés", message: "chaîne lancée telle quelle" },
      { etape: "rappels d'assurance", message: "42" },
    ]);
  });

  it("signale l'erreur à Sentry avec le nom de l'étape ; un Sentry en panne n'arrête ni les étapes suivantes ni la consignation", async () => {
    const panne = new Error("panne de base");
    etapes["purge"].panne = panne;
    sentry.echoue = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await lancer();

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(panne, { tags: { source: "cron.daily", etape: "purge des données de la plateforme" } });
    expect(res.status).toBe(500);
    expect(res.body.etapesEnEchec).toEqual([{ etape: "purge des données de la plateforme", message: "panne de base" }]);
    expect(ordre).toEqual(NOMS);
    expect(res.body.contractEndingRemindersSent).toBe(2);
  });
});

describe("ligne de résumé des journaux", () => {
  const base = {
    success: true,
    etapesEnEchec: [] as { etape: string; message: string }[],
    facturesPasseesEnRetard: 17,
    purge: PURGE as { jetonsEffaces: number; journauxEffaces: number; journauxAdminEfface?: number; compteursEfface: number } | null,
    contractEndingRemindersSent: 2,
    upcomingRentDueRemindersSent: 3,
    overdueRemindersSent: 4,
    rentDueRemindersSent: 5,
    recurringExpensesGenerated: 6,
    insuranceRemindersSent: 7,
    documentRemindersSent: 8,
    accessEndEmailsSent: 9 as number | undefined,
    echecs: 11,
    interrompu: false,
  };

  it("dit tout sur une ligne, dans l'ordre", () => {
    expect(ligneDeResume(base)).toBe(
      "[cron] Résumé du jour — OK | factures passées en retard : 17 | purge : 3 jeton(s), 4 journal(aux), 5 journal(aux) d'administration, 6 compteur(s)" +
        " | fins de contrat : 2 | rappels avant échéance : 3 | relances d'impayés : 4 | avis d'échéance : 5 | dépenses récurrentes : 6" +
        " | rappels d'assurance : 7 | rappels de documents : 8 | e-mails de fin d'essai ou d'abonnement : 9 | envois en échec : 11 | interrompu faute de temps : non"
    );
  });

  it("nomme les étapes en échec (jamais leur message), annonce une purge non faite et une interruption", () => {
    const ligne = ligneDeResume({
      ...base,
      success: false,
      etapesEnEchec: [
        { etape: "purge des données de la plateforme", message: "contient un e-mail awa@test.local" },
        { etape: "relances des impayés", message: "autre" },
      ],
      purge: null,
      interrompu: true,
    });

    expect(ligne).toContain("ÉCHEC de 2 étape(s) : purge des données de la plateforme, relances des impayés |");
    expect(ligne).toContain("purge : non faite");
    expect(ligne).toContain("interrompu faute de temps : oui");
    expect(ligne).not.toContain("awa@test.local");
  });

  it("une purge sans journal d'administration, et sans compteur d'e-mails de fin d'accès, compte zéro", () => {
    const ligne = ligneDeResume({ ...base, purge: { jetonsEffaces: 1, journauxEffaces: 2, compteursEfface: 3 }, accessEndEmailsSent: undefined });

    expect(ligne).toContain("purge : 1 jeton(s), 2 journal(aux), 0 journal(aux) d'administration, 3 compteur(s)");
    expect(ligne).toContain("e-mails de fin d'essai ou d'abonnement : 0");
  });

  it("la route écrit cette ligne dans les journaux : en information après un succès, en avertissement après un échec", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await lancer();
    const lignesInfo = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[cron] Résumé du jour"));
    expect(lignesInfo).toEqual([expect.stringContaining("Résumé du jour — OK | factures passées en retard : 17 |")]);
    expect(avertissement.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[cron] Résumé du jour"))).toEqual([]);

    info.mockClear();
    etapes["documents"].panne = new Error("x");
    await lancer();
    expect(avertissement.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[cron] Résumé du jour"))).toEqual([
      expect.stringContaining("ÉCHEC de 1 étape(s) : rappels d'expiration des documents |"),
    ]);
    expect(info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[cron] Résumé du jour"))).toEqual([]);
  });
});
