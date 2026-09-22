import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { users } from "../db/schema";
import { calculerJoursCredit, calculerPeriode } from "../services/subscriptionPeriod.service";
import { authHeader, createManager, createPlatformSubscription, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import {
  DEVISE_PAR_DEFAUT,
  SUBSCRIPTION_PLANS,
  deviseFacturee,
  devisesTarifees,
  tarifPourDevise,
} from "./subscription.controller";

describe("GET /api/subscription/plans", () => {
  it("est accessible sans authentification et renvoie les 3 formules", async () => {
    const res = await request(app).get("/api/subscription/plans");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual(["STARTER", "PRO", "ENTERPRISE"]);
  });

  it("sans paramètre currency, tarife dans la devise par défaut", async () => {
    const res = await request(app).get("/api/subscription/plans");

    for (const plan of res.body) {
      expect(plan.currency).toBe(DEVISE_PAR_DEFAUT);
    }
  });

  it("renvoie les tarifs XOF quand la devise demandée est tarifée", async () => {
    const res = await request(app).get("/api/subscription/plans?currency=XOF");

    expect(res.status).toBe(200);
    for (const plan of res.body) {
      expect(plan.currency).toBe("XOF");
    }
    const pro = res.body.find((p: { id: string }) => p.id === "PRO");
    expect(pro.monthlyPrice).toBe(15000);
    expect(pro.annualPrice).toBe(144000);
  });

  it("tarife chacune des devises proposées par le sélecteur de l'interface", async () => {
    // Le sélecteur de devise du frontend (frontend/src/context/currency.ts)
    // propose ces neuf codes. Une devise proposée à l'écran mais absente de
    // TARIFS retomberait sur l'euro : l'utilisateur choisirait une devise et
    // verrait ses prix dans une autre. Ce test échoue si l'une d'elles perd
    // sa tarification.
    const devisesDuSelecteur = ["EUR", "USD", "XOF", "XAF", "STN", "GBP", "CAD", "CHF", "MAD"];

    for (const devise of devisesDuSelecteur) {
      const res = await request(app).get(`/api/subscription/plans?currency=${devise}`);

      expect(res.status).toBe(200);
      for (const plan of res.body) {
        expect(plan.currency).toBe(devise);
        expect(plan.monthlyPrice).toBeGreaterThan(0);
        expect(plan.annualPrice).toBeGreaterThan(0);
      }
    }
  });

  it("retombe silencieusement sur EUR pour une devise qui n'est toujours pas tarifée (users.currency n'a pas de liste blanche)", async () => {
    // Rien n'empêche users.currency de contenir n'importe quoi :
    // updateCurrency accepte toute chaîne de 1 à 10 caractères. Ce test
    // verrouille le repli, pour qu'un tel compte reçoive toujours un prix
    // cohérent (EUR), jamais un prix à 0 ni une réponse incohérente.
    for (const devise of ["JPY", "AUD", "N_IMPORTE_QUOI"]) {
      const res = await request(app).get(`/api/subscription/plans?currency=${devise}`);

      expect(res.status).toBe(200);
      for (const plan of res.body) {
        expect(plan.currency).toBe("EUR");
      }
      const pro = res.body.find((p: { id: string }) => p.id === "PRO");
      expect(pro.monthlyPrice).toBe(29);
      expect(pro.annualPrice).toBe(278);
    }
  });
});

describe("deviseFacturee / tarifPourDevise — résolution de la devise facturée", () => {
  it("retourne telle quelle chaque devise tarifée, insensible à la casse", () => {
    for (const devise of devisesTarifees()) {
      expect(deviseFacturee(devise)).toBe(devise);
      expect(deviseFacturee(devise.toLowerCase())).toBe(devise);
    }
  });

  it("retombe sur la devise par défaut pour une devise non tarifée, une entrée vide ou absente", () => {
    for (const devise of ["JPY", "AUD", "SEK", ""]) {
      expect(deviseFacturee(devise)).toBe(DEVISE_PAR_DEFAUT);
    }
    expect(deviseFacturee(null)).toBe(DEVISE_PAR_DEFAUT);
    expect(deviseFacturee(undefined)).toBe(DEVISE_PAR_DEFAUT);
  });

  it("tarifPourDevise renvoie null (jamais un tarif inventé) pour une devise non tarifée", () => {
    expect(tarifPourDevise("STARTER", "JPY")).toBeNull();
    expect(tarifPourDevise("PLAN_INEXISTANT", "EUR")).toBeNull();
  });

  it("chaque formule est tarifée dans chaque devise annoncée : aucun trou dans la grille", () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      for (const devise of devisesTarifees()) {
        const tarif = tarifPourDevise(plan.id, devise);
        expect(tarif, `${plan.id} en ${devise}`).not.toBeNull();
        expect(tarif!.monthly).toBeGreaterThan(0);
        expect(tarif!.annual).toBeGreaterThan(0);
      }
    }
  });

  it("l'annuel coûte toujours moins que douze mensualités, dans chaque devise", () => {
    for (const plan of SUBSCRIPTION_PLANS) {
      for (const devise of devisesTarifees()) {
        const tarif = tarifPourDevise(plan.id, devise)!;
        expect(tarif.annual, `${plan.id} en ${devise}`).toBeLessThan(tarif.monthly * 12);
      }
    }
  });
});

describe("TARIFS — la remise annuelle de -20% annoncée par l'interface reste vraie pour chaque formule et chaque devise", () => {
  // Garde-fou : SubscriptionPage.tsx calcule désormais son badge "-X%" depuis
  // ces mêmes tarifs plutôt que de l'annoncer en dur, mais rien n'empêcherait
  // TARIFS lui-même de dériver d'une formule à l'autre si un prix est changé
  // à la main sans recalculer l'annuel correspondant. Ce test échoue
  // immédiatement dans ce cas, plutôt que de laisser passer un badge (et une
  // promesse commerciale) devenus faux.
  // Toutes les devises tarifées, pas une liste écrite à la main : une devise
  // ajoutée à TARIFS est ainsi couverte d'office par cet invariant.
  const casDeTest = SUBSCRIPTION_PLANS.flatMap((plan) =>
    devisesTarifees().map((devise) => [plan.id, devise] as const)
  );

  it.each(casDeTest)("%s en %s respecte ~20%% de remise annuelle (12 × mensuel × 0,8, arrondi)", (planId, devise) => {
    const tarif = tarifPourDevise(planId, devise);
    expect(tarif).not.toBeNull();

    const remise = 1 - tarif!.annual / (tarif!.monthly * 12);
    // Tolérance d'arrondi (les montants restent ronds et lisibles) : ±1 point
    // de pourcentage autour de 20 %.
    expect(remise).toBeGreaterThan(0.19);
    expect(remise).toBeLessThan(0.21);
  });
});

describe("GET /api/subscription/status", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/subscription/status");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/subscription/status")
      .set(authHeader(tokenFor({ id: "t1", role: "TENANT" }, "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("renvoie l'état de l'essai en cours pour un gestionnaire", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/subscription/status").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe("TRIAL");
    expect(res.body.subscription.isTrialActive).toBe(true);
    expect(res.body.userEmail).toBe(manager.email);
    expect(res.body.history).toEqual([]);
  });
});

describe("POST /api/subscription/subscribe", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).post("/api/subscription/subscribe").send({});
    expect(res.status).toBe(401);
  });

  it("rejette un plan invalide avec une erreur 400 explicite", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PLATINUM", paymentMethod: "DEMO" });

    expect(res.status).toBe(400);
  });

  it("active immédiatement l'abonnement quand le paiement est confirmé (mode démo)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription.status).toBe("ACTIVE");
    expect(res.body.subscription.plan).toBe("PRO");
    expect(res.body.record.status).toBe("PAID");
    expect(res.body.record.amount).toBe(29);

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("ACTIVE");
    expect(updated.subscriptionPlan).toBe("PRO");
    expect(updated.subscriptionEndsAt).not.toBeNull();
  });

  it("prolonge la date de fin d'un an pour un cycle de facturation annuel", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "STARTER", billingCycle: "ANNUAL", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.record.amount).toBe(86);
    expect(res.body.record.billingCycle).toBe("ANNUAL");

    const endDate = new Date(res.body.subscription.subscriptionEndsAt);
    const now = new Date();
    const daysUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysUntilEnd).toBeGreaterThan(360); // ~1 an, pas ~1 mois
  });

  // Régression du bug corrigé précédemment (activation d'un abonnement sans
  // paiement réellement vérifié, voir subscription.controller.ts) : un
  // virement bancaire déclaré doit rester en attente et ne JAMAIS accorder
  // l'accès tant qu'un administrateur ne l'a pas validé manuellement.
  it("NE PAS activer l'abonnement pour un virement bancaire déclaré tant qu'il n'est pas validé", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", paymentMethod: "BANK_TRANSFER", bankReference: "VIR-2026-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.record.status).toBe("PENDING");
    // Le statut d'abonnement du gestionnaire ne doit pas avoir bougé de TRIAL.
    expect(res.body.subscription.status).toBe("TRIAL");

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("TRIAL");
    expect(updated.subscriptionPlan).not.toBe("PRO");
  });

  // Régression. La date de fin repartait systématiquement de l'instant de la
  // demande : un gestionnaire abonné jusqu'à la fin du mois qui renouvelait en
  // avance perdait purement et simplement les jours restants. Or renouveler
  // avant l'échéance est exactement ce que l'interface encourage, et le seul
  // moyen d'éviter une coupure d'accès.
  it("reporte les jours déjà payés lors d'un renouvellement anticipé", async () => {
    const finEnCours = new Date();
    finEnCours.setDate(finEnCours.getDate() + 20);

    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
      subscriptionEndsAt: finEnCours,
    });

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);

    // La nouvelle période démarre à la fin de l'ancienne, pas aujourd'hui.
    expect(new Date(res.body.record.startDate).getTime()).toBe(finEnCours.getTime());

    // Et l'accès court donc environ 50 jours (20 restants + 1 mois), pas 30.
    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const joursRestants =
      (updated.subscriptionEndsAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(joursRestants).toBeGreaterThan(45);
  });

  /**
   * Régression : un changement de plan (upgrade ou downgrade) reportait les
   * jours restants TELS QUELS sur le nouveau plan, comme pour un
   * renouvellement du même plan — alors que les deux plans n'ont pas le
   * même tarif journalier. Un upgrade STARTER (9€/mois) -> PRO (29€/mois)
   * avec 10 jours restants donnait ainsi 10 jours de PRO OFFERTS (valant
   * ~9,67€ au tarif PRO), pour une valeur réellement non consommée de
   * seulement 3€ (9€ × 10/30) sur l'ancien plan.
   */
  it("proratise (ne reporte pas tel quel) les jours restants lors d'un upgrade de plan", async () => {
    const now = new Date();
    const ancienStart = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    const ancienEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "STARTER",
      subscriptionEndsAt: ancienEnd,
    });
    await createPlatformSubscription(manager.id, {
      plan: "STARTER",
      amount: 9,
      billingCycle: "MONTHLY",
      startDate: ancienStart,
      endDate: ancienEnd,
    });

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);

    const base = calculerPeriode({ maintenant: now, cycle: "MONTHLY", finActuelle: null });
    const nouveauCycleJours = (base.endDate.getTime() - base.startDate.getTime()) / 86_400_000;
    // Durée NOMINALE du cycle de l'ancien plan, dérivée du même startDate que
    // le fixture (voir calculerPeriodeActivation) — et non un 30 fixe : le
    // mois calendaire réel depuis ancienStart peut compter 28 à 31 jours.
    const ancienNominal = calculerPeriode({ maintenant: ancienStart, cycle: "MONTHLY", finActuelle: null });
    const ancienCycleJours = (ancienNominal.endDate.getTime() - ancienNominal.startDate.getTime()) / 86_400_000;
    const joursCreditAttendus = calculerJoursCredit({
      ancienMontant: 9,
      ancienCycleJours,
      joursRestants: 10,
      nouveauMontant: 29,
      nouveauCycleJours,
    });

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const joursTotal = (updated.subscriptionEndsAt!.getTime() - now.getTime()) / 86_400_000;

    expect(joursTotal).toBeCloseTo(nouveauCycleJours + joursCreditAttendus, 0);
    // Un report brut des jours restants (le bug) aurait donné environ
    // nouveauCycleJours + 10 jours — nettement plus que la proratisation
    // (~3 jours de crédit ici).
    expect(joursTotal).toBeLessThan(nouveauCycleJours + 8);
  });

  /** Symétrique : un downgrade doit au contraire créditer PLUS de jours (le
   * gestionnaire avait payé pour un plan plus cher que celui vers lequel il
   * bascule), jamais moins que ce que ses jours restants valaient réellement. */
  it("proratise (crédite davantage) les jours restants lors d'un downgrade de plan", async () => {
    const now = new Date();
    const ancienStart = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    const ancienEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
      subscriptionEndsAt: ancienEnd,
    });
    await createPlatformSubscription(manager.id, {
      plan: "PRO",
      amount: 29,
      billingCycle: "MONTHLY",
      startDate: ancienStart,
      endDate: ancienEnd,
    });

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "STARTER", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);

    const base = calculerPeriode({ maintenant: now, cycle: "MONTHLY", finActuelle: null });
    const nouveauCycleJours = (base.endDate.getTime() - base.startDate.getTime()) / 86_400_000;
    // Durée NOMINALE du cycle de l'ancien plan, dérivée du même startDate que
    // le fixture (voir calculerPeriodeActivation) — et non un 30 fixe : le
    // mois calendaire réel depuis ancienStart peut compter 28 à 31 jours.
    const ancienNominal = calculerPeriode({ maintenant: ancienStart, cycle: "MONTHLY", finActuelle: null });
    const ancienCycleJours = (ancienNominal.endDate.getTime() - ancienNominal.startDate.getTime()) / 86_400_000;
    const joursCreditAttendus = calculerJoursCredit({
      ancienMontant: 29,
      ancienCycleJours,
      joursRestants: 10,
      nouveauMontant: 9,
      nouveauCycleJours,
    });

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const joursTotal = (updated.subscriptionEndsAt!.getTime() - now.getTime()) / 86_400_000;

    expect(joursCreditAttendus).toBeGreaterThan(10);
    expect(joursTotal).toBeCloseTo(nouveauCycleJours + joursCreditAttendus, 0);
  });
});

/**
 * Régression : subscribe() ne protégeait que l'écriture finale en base — deux
 * requêtes concurrentes (double clic, deux onglets) passaient toutes les deux
 * jusqu'à l'appel PayDunya, créant deux paiements réels distincts pour un seul
 * clic d'abonnement. Même bug, et même correctif, que celui déjà appliqué à
 * payInvoice (voir paiementIdempotence.test.ts).
 */
describe("POST /api/subscription/subscribe — anti-double-paiement", () => {
  const original = { paydunya: { ...env.payments.paydunya } };

  afterEach(() => {
    env.payments.demoMode = true;
    env.payments.paydunya = { ...original.paydunya };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function activerPaydunya() {
    env.payments.demoMode = false;
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk" };
  }

  function reponsePaydunyaOk() {
    return { ok: true, json: async () => ({ response_code: "00", response_text: "https://paydunya.test/abc", token: "tok" }) };
  }

  it("refuse (409) une seconde demande d'abonnement pendant qu'une première est en cours, sans jamais appeler PayDunya", async () => {
    const manager = await createManager();
    activerPaydunya();
    // Réclamation posée directement, comme le ferait le premier des deux clics
    // simultanés — la première étape de subscribe() pour cette requête-ci,
    // sans dépendre d'un minutage réel entre deux appels HTTP concurrents.
    await testDb
      .update(users)
      .set({ subscriptionPaymentAttemptStartedAt: new Date() })
      .where(eq(users.id, manager.id));

    const fetchMock = vi.fn().mockResolvedValue(reponsePaydunyaOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", paymentMethod: "PAYDUNYA" });

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();

    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.subscriptionStatus).toBe("TRIAL");
  });

  it("une réclamation périmée (crash passé) n'empêche pas un nouvel essai légitime", async () => {
    // Devise XOF : requise pour que PAYDUNYA passe le contrôle de devise de
    // indisponibilite() (voir payment.service.ts) et parte réellement en
    // réseau au lieu d'être refusé en amont.
    const manager = await createManager({ currency: "XOF" });
    activerPaydunya();
    const perimee = new Date(Date.now() - 5 * 60 * 1000); // 5 min, largement > le seuil de 60 s
    await testDb.update(users).set({ subscriptionPaymentAttemptStartedAt: perimee }).where(eq(users.id, manager.id));

    const fetchMock = vi.fn().mockResolvedValue(reponsePaydunyaOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", paymentMethod: "PAYDUNYA" });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("lève la réclamation même si l'appel au prestataire échoue, pour ne pas bloquer un nouvel essai légitime", async () => {
    const manager = await createManager({ currency: "XOF" });
    activerPaydunya();
    const fetchMock = vi.fn().mockRejectedValue(new Error("réseau indisponible"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", paymentMethod: "PAYDUNYA" });

    expect(res.status).toBe(502);

    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.subscriptionPaymentAttemptStartedAt).toBeNull();
  });
});

describe("POST /api/subscription/cancel", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).post("/api/subscription/cancel").send({});
    expect(res.status).toBe(401);
  });

  it("annule le renouvellement automatique d'un abonnement actif", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE" });

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // computeSubscriptionInfo() renvoie "EXPIRED" dès que ni l'essai ni un
    // abonnement ACTIVE ne sont valides — "CANCELLED" n'est donc jamais
    // renvoyé tel quel dans le statut calculé, seulement en base.
    expect(res.body.subscription.status).toBe("EXPIRED");

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("CANCELLED");
  });
});
