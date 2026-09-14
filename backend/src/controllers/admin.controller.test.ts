import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, platformSubscriptions, users } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createPlatformSubscription,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { confirmBankTransfer, rejectBankTransfer } from "./admin.controller";

/**
 * Appelle un handler asyncHandler(...) directement (sans passer par
 * Express/supertest, dont l'envoi de requête est asynchrone et ne garantit
 * aucun ordre précis entre deux appels HTTP "concurrents") — nécessaire pour
 * contrôler exactement quand chaque appel atteint sa propre lecture en base,
 * condition du test de course ci-dessous.
 */
async function appelerHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: any, res: any, next: any) => void,
  params: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const req = { params };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    };
    const next = (err: unknown) => {
      const status = err instanceof ApiError ? err.statusCode : 500;
      resolve({ status, body: { error: (err as Error)?.message } });
    };
    handler(req, res, next);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function createPendingBankTransfer(managerId: string, overrides: Partial<typeof platformSubscriptions.$inferInsert> = {}) {
  const [record] = await testDb
    .insert(platformSubscriptions)
    .values({
      userId: managerId,
      plan: "PRO",
      amount: 29,
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentRef: "VIR-REF-001",
      startDate: new Date(2026, 5, 1),
      endDate: new Date(2026, 6, 1),
      ...overrides,
    })
    .returning();
  return record;
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Enveloppe récursivement un query builder Drizzle pour retarder de `ms`
 * L'EXÉCUTION RÉELLE (pas seulement la propagation de son résultat) — sert à
 * élargir artificiellement une fenêtre de course dans les tests : une simple
 * écriture (UPDATE) part dès que `.then()`/`await` est invoqué, donc retarder
 * seulement la propagation du résultat laisserait l'écriture déjà committée
 * avant même que le délai n'ait commencé. Ici, c'est l'appel à `.then()`
 * lui-même qui est différé.
 */
function retarderExecution<T>(valeur: T, ms: number): T {
  if (!valeur || (typeof valeur !== "object" && typeof valeur !== "function")) return valeur;
  return new Proxy(valeur as object, {
    get(cible, prop, recepteur) {
      const original = Reflect.get(cible, prop, recepteur);
      if (prop === "then" && typeof original === "function") {
        return (onFulfilled?: unknown, onRejected?: unknown) =>
          new Promise((resolve, reject) => {
            setTimeout(() => (original as Function).call(cible, resolve, reject), ms);
          }).then(onFulfilled as never, onRejected as never);
      }
      if (typeof original === "function") {
        return (...args: unknown[]) => retarderExecution(original.apply(cible, args), ms);
      }
      return original;
    },
  }) as T;
}

describe("GET /api/admin/subscriptions/pending-bank-transfers", () => {
  it("refuse l'accès à un gestionnaire (rôle non-admin)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .get("/api/admin/subscriptions/pending-bank-transfers")
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });

  it("liste les abonnements en attente de virement pour un administrateur", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);
    // Un abonnement déjà payé, ou payé par un autre moyen, ne doit pas apparaître.
    await createPendingBankTransfer(manager.id, { status: "PAID", paymentRef: "VIR-REF-002" });
    await createPendingBankTransfer(manager.id, { paymentMethod: "PAYDUNYA", paymentRef: "pd_token_999" });

    const res = await request(app)
      .get("/api/admin/subscriptions/pending-bank-transfers")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(record.id);
    expect(res.body[0].managerEmail).toBe(manager.email);
  });
});

describe("POST /api/admin/subscriptions/:id/confirm-bank-transfer", () => {
  it("refuse l'accès à un gestionnaire (rôle non-admin)", async () => {
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });

  it("confirme le virement : active l'abonnement du gestionnaire et marque l'historique PAID", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [updatedRecord] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(updatedRecord.status).toBe("PAID");

    const [updatedManager] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedManager.subscriptionStatus).toBe("ACTIVE");
    expect(updatedManager.subscriptionPlan).toBe("PRO");
  });

  it("renvoie 404 si l'abonnement n'existe pas", async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .post("/api/admin/subscriptions/introuvable/confirm-bank-transfer")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(404);
  });

  it("refuse de confirmer un abonnement qui n'est pas payé par virement bancaire", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id, { paymentMethod: "PAYDUNYA", paymentRef: "pd_token_888" });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(400);

    const [stillPending] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("est idempotent : confirmer deux fois le même virement ne fait rien la seconde fois", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  /**
   * Régression : rien n'empêchait de confirmer un virement pourtant déjà
   * rejeté par un administrateur (ex. reject-bank-transfer suivi, par erreur
   * ou par un second administrateur, de confirm-bank-transfer) — l'abonnement
   * se retrouvait activé alors même que le virement avait été explicitement
   * jugé invalide/jamais reçu.
   */
  it("refuse de confirmer un virement déjà rejeté", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const record = await createPendingBankTransfer(manager.id, { status: "REJECTED" });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(400);

    const [stillRejected] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(stillRejected.status).toBe("REJECTED");

    // Aucun accès ne doit avoir été accordé au gestionnaire.
    const [updatedManager] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedManager.subscriptionStatus).toBe("EXPIRED");
  });
});

/**
 * Régression : une demande de virement qui n'était finalement qu'un test (ou
 * un virement annoncé mais jamais reçu) n'avait aucune issue propre — la
 * seule action possible était "Confirmer", ce qui aurait activé à tort un
 * abonnement payant. Sans "rejeter", la ligne restait indéfiniment PENDING.
 */
describe("POST /api/admin/subscriptions/:id/reject-bank-transfer", () => {
  it("refuse l'accès à un gestionnaire (rôle non-admin)", async () => {
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/reject-bank-transfer`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });

  it("rejette le virement : marque l'enregistrement REJECTED sans activer l'abonnement", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/reject-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.record.status).toBe("REJECTED");

    const [updatedRecord] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(updatedRecord.status).toBe("REJECTED");

    // Aucun accès accordé : contrairement à la confirmation, le rejet ne doit
    // jamais activer l'abonnement du gestionnaire.
    const [updatedManager] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedManager.subscriptionStatus).toBe("EXPIRED");
  });

  it("disparaît de la liste des virements en attente une fois rejeté", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    await request(app)
      .post(`/api/admin/subscriptions/${record.id}/reject-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    const res = await request(app)
      .get("/api/admin/subscriptions/pending-bank-transfers")
      .set(authHeader(tokenFor(admin)));

    expect(res.body.find((r: { id: string }) => r.id === record.id)).toBeUndefined();
  });

  it("renvoie 404 si l'abonnement n'existe pas", async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .post("/api/admin/subscriptions/introuvable/reject-bank-transfer")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(404);
  });

  it("refuse de rejeter un abonnement qui n'est pas payé par virement bancaire", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id, { paymentMethod: "PAYDUNYA", paymentRef: "pd_token_777" });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/reject-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(400);
  });

  it("refuse de rejeter un virement déjà confirmé", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id, { status: "PAID" });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/reject-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(400);

    const [stillPaid] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(stillPaid.status).toBe("PAID");
  });

  // Régression : rejectBankTransfer ne faisait sa vérification "déjà PAID ?"
  // qu'à partir d'une lecture séparée de son écriture. Si confirmBankTransfer
  // committait ENTRE cette lecture et l'UPDATE de rejectBankTransfer (deux
  // administrateurs qui traitent la même ligne de la file d'attente au même
  // moment), l'UPDATE — jusqu'ici inconditionnel sur le statut — écrasait
  // silencieusement la confirmation déjà accordée en "REJECTED", alors même
  // que l'accès payant restait débloqué côté compte : l'historique de
  // facturation mentait, et plus aucune requête ne pouvait alors corriger cet
  // enregistrement (activateSubscriptionRecord refuse de réactiver un
  // REJECTED).
  it("ne rejette pas un virement confirmé par une requête concurrente entre sa lecture et son écriture", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL" });
    const record = await createPendingBankTransfer(manager.id, { plan: "STARTER" });

    // Ne retarde QUE l'écriture de REJET (set({status: "REJECTED"})), jamais
    // celle de la confirmation (set({status: "PAID", ...})) qui passe par le
    // même testDb.update(platformSubscriptions) — sans quoi les deux
    // écritures concurrentes se retrouveraient toutes deux différées, sans
    // garantie sur leur ordre relatif.
    const originalUpdate = testDb.update.bind(testDb);
    const spy = vi.spyOn(testDb, "update").mockImplementation((table: any) => {
      const builder = originalUpdate(table);
      if (table !== platformSubscriptions) return builder;
      return new Proxy(builder, {
        get(cible, prop, recepteur) {
          const original = Reflect.get(cible, prop, recepteur);
          if (prop !== "set" || typeof original !== "function") {
            return typeof original === "function" ? original.bind(cible) : original;
          }
          return (values: Record<string, unknown>) => {
            const setBuilder = original.call(cible, values);
            // Laisse le temps à la confirmation concurrente (déclenchée
            // juste après la lecture ci-dessus, voir plus bas) de committer
            // intégralement avant que cette écriture de rejet ne s'exécute.
            return values?.status === "REJECTED" ? retarderExecution(setBuilder, 30) : setBuilder;
          };
        },
      });
    });

    // Appel direct des handlers (pas de supertest/HTTP ici) : l'envoi d'une
    // requête HTTP est lui-même asynchrone et ne garantit aucun ordre précis
    // entre deux appels "concurrents" — on a besoin ici de savoir avec
    // certitude que la lecture du rejet a bien lieu AVANT la confirmation.
    const rejectPromise = appelerHandler(rejectBankTransfer, { id: record.id });

    // Un handler asyncHandler(...) s'exécute de façon synchrone jusqu'à son
    // premier `await` : au retour de l'appel ci-dessus, la lecture de
    // rejectBankTransfer a donc déjà été émise (pas nécessairement résolue).
    const confirmRes = await appelerHandler(confirmBankTransfer, { id: record.id });

    const rejectRes = await rejectPromise;
    spy.mockRestore();

    expect(confirmRes.status).toBe(200);
    // Le rejet, arrivé après coup, ne doit plus pouvoir écraser la confirmation.
    expect(rejectRes.status).toBe(409);

    const [finalRecord] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(finalRecord.status).toBe("PAID");

    const [finalManager] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(finalManager.subscriptionStatus).toBe("ACTIVE");
  });
});

describe("GET /api/admin/dashboard/stats", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/admin/dashboard/stats");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un gestionnaire (réservé aux administrateurs)", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("répartit les gestionnaires par statut réel d'abonnement (essai actif / payant actif / sans accès)", async () => {
    const admin = await createAdmin();
    // Essai en cours.
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(9) });
    // Abonnement payant en cours de validité.
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20) });
    // Essai expiré depuis longtemps, jamais passé payant : sans accès malgré
    // la colonne "subscriptionStatus" toujours à TRIAL (jamais réévaluée en
    // base, seulement à la connexion — computeSubscriptionInfo doit la
    // corriger côté lecture).
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(-5) });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.managers.total).toBe(3);
    expect(res.body.managers.trialActive).toBe(1);
    expect(res.body.managers.subscriptionActive).toBe(1);
    expect(res.body.managers.expired).toBe(1);
  });

  it("liste les essais se terminant dans les 7 jours, triés par urgence, en excluant les essais plus lointains", async () => {
    const admin = await createAdmin();
    const urgent = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(2) });
    const soonish = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(6) });
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(25) });
    await testDb.insert(agencySettings).values({ userId: urgent.id, agencyName: "Agence du Port" });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.trialsEndingSoon).toHaveLength(2);
    expect(res.body.trialsEndingSoon[0].userId).toBe(urgent.id);
    expect(res.body.trialsEndingSoon[0].agencyName).toBe("Agence du Port");
    expect(res.body.trialsEndingSoon[1].userId).toBe(soonish.id);
    expect(res.body.trialsEndingSoon[1].agencyName).toBeNull();
  });

  it("calcule le MRR à partir du dernier paiement confirmé de chaque abonnement payant actif, en ramenant l'annuel au mensuel", async () => {
    const admin = await createAdmin();

    const proManager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: daysFromNow(15) });
    await createPlatformSubscription(proManager.id, { plan: "PRO", amount: 29, billingCycle: "MONTHLY", status: "PAID" });

    const enterpriseManager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "ENTERPRISE",
      subscriptionEndsAt: daysFromNow(200),
    });
    // Un paiement PENDING plus récent ne doit pas être pris en compte (virement
    // bancaire pas encore validé) : seul le dernier paiement PAID compte.
    await createPlatformSubscription(enterpriseManager.id, { plan: "ENTERPRISE", amount: 470, billingCycle: "ANNUAL", status: "PAID" });
    await createPlatformSubscription(enterpriseManager.id, { plan: "ENTERPRISE", amount: 470, billingCycle: "ANNUAL", status: "PENDING" });

    // Essai en cours : ne contribue jamais au MRR.
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(5) });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.mrr.contributors).toBe(2);
    expect(res.body.mrr.byCurrency).toHaveLength(1);
    const eurMrr = res.body.mrr.byCurrency[0];
    expect(eurMrr.currency).toBe("EUR");
    expect(eurMrr.byPlan.PRO).toBe(29);
    expect(eurMrr.byPlan.ENTERPRISE).toBe(39.17);
    expect(eurMrr.total).toBe(68.17);
  });

  it("compte le volume global d'usage (biens, locataires, contrats actifs) tous gestionnaires confondus", async () => {
    const admin = await createAdmin();

    const managerA = await createManager();
    const propertyA = await createProperty(managerA.id);
    const tenantA = await createTenant(managerA.id);
    await createContract(propertyA.id, tenantA.id, { status: "ACTIVE" });

    const managerB = await createManager();
    const propertyB1 = await createProperty(managerB.id);
    await createProperty(managerB.id);
    const tenantB = await createTenant(managerB.id);
    await createContract(propertyB1.id, tenantB.id, { status: "ENDED" });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.usage.totalProperties).toBe(3);
    expect(res.body.usage.totalTenants).toBe(2);
    expect(res.body.usage.activeContracts).toBe(1);
  });
});
