import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { users } from "../db/schema";
import { calculerJoursCredit, calculerPeriode } from "../services/subscriptionPeriod.service";
import { authHeader, createManager, createPlatformSubscription, createProperty, tokenFor,
  createPortalUser,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import {
  DEVISE_PAR_DEFAUT,
  SUBSCRIPTION_PLANS,
  deviseFacturee,
  devisesTarifees,
  tarifPourDevise,
} from "./subscription.controller";


const CHEMIN_SELECTEUR = path.resolve(__dirname, "../../../frontend/src/context/currency.ts");

/** Les codes réellement proposés par le sélecteur de l'interface. */
function devisesDuSelecteurFrontend(): string[] {
  const source = fs.readFileSync(CHEMIN_SELECTEUR, "utf-8");
  const bloc = source.match(/export const CURRENCIES[^{]*\{([\s\S]*?)\n\};/);
  if (!bloc) throw new Error(`Bloc CURRENCIES introuvable dans ${CHEMIN_SELECTEUR}`);
  return Array.from(bloc[1].matchAll(/^\s{2}([A-Z]{3}):\s*\{/gm)).map((m) => m[1]);
}

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
    // La liste était écrite à la main ici, et c'est exactement ce qui a permis
    // au trou de s'ouvrir : trois devises ont été ajoutées au sélecteur sans
    // l'être à TARIFS, et ce test — qui ne connaissait que les neuf anciennes
    // — est resté vert pendant que l'utilisateur voyait ses prix en euros.
    // On lit donc le fichier du frontend, comme le fait déjà
    // utils/devises.test.ts. Une devise proposée à l'écran mais non tarifée
    // fait désormais échouer ce test le jour où elle est ajoutée.
    const devisesDuSelecteur = devisesDuSelecteurFrontend();
    expect(devisesDuSelecteur.length).toBeGreaterThan(0);

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
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")));
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

  it("signale le dépassement du plafond de biens après un passage à une formule inférieure", async () => {
    // Le plafond n'est contrôlé qu'à la création d'un bien : un gestionnaire
    // redescendu de PRO (25 biens) à STARTER (5) garde ses biens et continue
    // de les exploiter sans que rien ne le lui signale. On ne lui retire pas
    // l'accès à des biens réellement loués — on le lui dit.
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "STARTER",
      trialEndsAt: null,
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    for (let i = 0; i < 6; i++) {
      await createProperty(manager.id, { title: `Bien ${i + 1}` });
    }

    const res = await request(app).get("/api/subscription/status").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.propertyUsage).toEqual({ count: 6, max: 5, exceeded: true });
  });

  it("ne signale aucun dépassement tant que le plafond n'est pas franchi", async () => {
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "STARTER",
      trialEndsAt: null,
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await createProperty(manager.id);

    const res = await request(app).get("/api/subscription/status").set(authHeader(tokenFor(manager)));

    expect(res.body.propertyUsage).toEqual({ count: 1, max: 5, exceeded: false });
  });

  it("pendant l'essai, le plafond appliqué est celui de la formule PRO", async () => {
    // Même règle qu'à la création d'un bien : l'essai donne les
    // fonctionnalités PRO, quelle que soit la formule par défaut (STARTER).
    const manager = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER" });

    const res = await request(app).get("/api/subscription/status").set(authHeader(tokenFor(manager)));

    expect(res.body.propertyUsage.max).toBe(25);
    expect(res.body.propertyUsage.exceeded).toBe(false);
  });

  it("n'annonce aucun plafond pour la formule illimitée", async () => {
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "ENTERPRISE",
      trialEndsAt: null,
      subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get("/api/subscription/status").set(authHeader(tokenFor(manager)));

    expect(res.body.propertyUsage.max).toBeNull();
    expect(res.body.propertyUsage.exceeded).toBe(false);
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
    // Aucune date de fin sur ce compte : il n'y a donc aucun jour déjà payé à
    // honorer après la résiliation, et le statut calculé retombe à EXPIRED.
    // Le cas d'une période payée encore en cours est couvert juste en dessous.
    expect(res.body.subscription.status).toBe("EXPIRED");

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("CANCELLED");
  });

  it("laisse l'abonnement résilié actif jusqu'au terme de la période déjà payée", async () => {
    // Le cas qui coûtait cher : une année réglée d'avance, résiliée le
    // lendemain. Le gestionnaire renonce à la reconduction, pas aux onze mois
    // qu'il a payés — cancelSubscription ne touche d'ailleurs jamais
    // subscriptionEndsAt.
    const finPayee = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
      trialEndsAt: null,
      subscriptionEndsAt: finPayee,
    });

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe("CANCELLED");
    expect(res.body.subscription.isSubscriptionActive).toBe(true);
    expect(res.body.subscription.isExpired).toBe(false);

    // Et l'accès reste réellement ouvert, pas seulement l'affichage.
    const acces = await request(app).get("/api/properties").set(authHeader(tokenFor(manager)));
    expect(acces.status).toBe(200);
  });
});
