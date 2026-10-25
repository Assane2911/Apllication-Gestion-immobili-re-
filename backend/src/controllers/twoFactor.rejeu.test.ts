import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit de l'authentification (octobre 2026).
 *
 *  1. Un code de double authentification accepté ne doit pas l'être une seconde fois (RFC 6238, § 5.2) : le même code
 *     ouvrait deux connexions successives, tant qu'il était dans sa fenêtre de validité (30 à 60 secondes). Le dernier
 *     pas de temps accepté est retenu par compte ; un code de ce pas, ou d'un pas plus ancien, est refusé. Cela rend
 *     aussi inutile le rejeu du jeton intermédiaire (« mot de passe prouvé ») : il faut un code neuf à chaque fois.
 *  2. La déconnexion n'exigeait pas l'en-tête anti-CSRF : un site tiers pouvait faire effacer le cookie de session de
 *     son visiteur. Comme les autres routes, elle l'exige maintenant dès que la requête s'authentifie par cookie.
 */
const PASSWORD = "Password123!";
const PAS_MS = 30_000;

afterEach(() => vi.useRealTimers());

/** Enrôle et confirme la 2FA du compte ; renvoie le secret. */
async function activerDeuxFa(email: string) {
  const manager = await createManager({ email });
  const token = tokenFor(manager);
  const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
  const confirm = await request(app).post("/api/auth/2fa/confirm").set(authHeader(token)).send({ code: await genererCodeTotp(setup.body.secret) });
  expect(confirm.status).toBe(200);
  return { manager, secret: setup.body.secret as string, token };
}

const connexion = (email: string) => request(app).post("/api/auth/login").send({ email, password: PASSWORD });
const verifier = (pendingToken: string, code: string) => request(app).post("/api/auth/2fa/verify-login").send({ pendingToken, code });

/** Fige l'horloge au milieu d'un pas de TOTP, pour que « le pas suivant » soit sans ambiguïté. */
function figerAu(pas: number, decalageMs = 5_000) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(pas * PAS_MS + decalageMs);
}
const PAS_FIXE = 58_000_000; // un pas de temps quelconque (année 2025)

describe("réutilisation d'un code de double authentification", () => {
  it("accepté une fois, le même code est refusé à la connexion suivante", async () => {
    const { secret } = await activerDeuxFa("rejeu-1@test.local");
    figerAu(PAS_FIXE);
    const code = await genererCodeTotp(secret);

    const p1 = await connexion("rejeu-1@test.local");
    expect((await verifier(p1.body.pendingToken, code)).status).toBe(200);

    const p2 = await connexion("rejeu-1@test.local");
    const rejeu = await verifier(p2.body.pendingToken, code);
    expect(rejeu.status).toBe(401);
    expect(rejeu.body.code).toBe("TWO_FACTOR_CODE_INVALID");
    expect(rejeu.headers["set-cookie"]).toBeUndefined();
  });

  it("le code du pas suivant est accepté : le refus ne vaut que pour un code déjà utilisé", async () => {
    const { secret } = await activerDeuxFa("rejeu-2@test.local");
    figerAu(PAS_FIXE);
    const code1 = await genererCodeTotp(secret);
    const p1 = await connexion("rejeu-2@test.local");
    expect((await verifier(p1.body.pendingToken, code1)).status).toBe(200);

    figerAu(PAS_FIXE + 1);
    const code2 = await genererCodeTotp(secret);
    expect(code2).not.toBe(code1);
    const p2 = await connexion("rejeu-2@test.local");
    expect((await verifier(p2.body.pendingToken, code2)).status).toBe(200);
  });

  it("un code d'un pas plus ancien que le dernier accepté est refusé aussi (tolérance d'horloge comprise)", async () => {
    const { secret } = await activerDeuxFa("rejeu-3@test.local");
    figerAu(PAS_FIXE - 1);
    const ancien = await genererCodeTotp(secret);
    figerAu(PAS_FIXE);
    const courant = await genererCodeTotp(secret);

    const p1 = await connexion("rejeu-3@test.local");
    expect((await verifier(p1.body.pendingToken, courant)).status).toBe(200);

    // Le code du pas précédent est encore dans la tolérance de 30 s, mais il est antérieur au dernier accepté.
    const p2 = await connexion("rejeu-3@test.local");
    expect((await verifier(p2.body.pendingToken, ancien)).status).toBe(401);
  });

  it("un code de la tolérance d'horloge, accepté une fois, ne l'est pas deux", async () => {
    const { secret } = await activerDeuxFa("rejeu-4@test.local");
    figerAu(PAS_FIXE - 1);
    const precedent = await genererCodeTotp(secret);
    figerAu(PAS_FIXE);

    const p1 = await connexion("rejeu-4@test.local");
    expect((await verifier(p1.body.pendingToken, precedent)).status).toBe(200);
    const p2 = await connexion("rejeu-4@test.local");
    expect((await verifier(p2.body.pendingToken, precedent)).status).toBe(401);
  });

  it("rejouer le jeton intermédiaire ne sert à rien : chaque ouverture de session exige un code neuf", async () => {
    const { secret } = await activerDeuxFa("rejeu-5@test.local");
    figerAu(PAS_FIXE);
    const code = await genererCodeTotp(secret);
    const p1 = await connexion("rejeu-5@test.local");
    expect((await verifier(p1.body.pendingToken, code)).status).toBe(200);
    // Même jeton intermédiaire, même code : refusé.
    expect((await verifier(p1.body.pendingToken, code)).status).toBe(401);
    // Même jeton intermédiaire, code du pas suivant : c'est un code neuf, donc légitime.
    figerAu(PAS_FIXE + 1);
    expect((await verifier(p1.body.pendingToken, await genererCodeTotp(secret))).status).toBe(200);
  });

  it("les codes de secours restent utilisables une fois, comme avant", async () => {
    const manager = await createManager({ email: "rejeu-6@test.local" });
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));
    const confirm = await request(app).post("/api/auth/2fa/confirm").set(authHeader(tokenFor(manager))).send({ code: await genererCodeTotp(setup.body.secret) });
    const [secours] = confirm.body.backupCodes as string[];

    const p1 = await connexion("rejeu-6@test.local");
    expect((await verifier(p1.body.pendingToken, secours)).status).toBe(200);
    const p2 = await connexion("rejeu-6@test.local");
    expect((await verifier(p2.body.pendingToken, secours)).status).toBe(401);
  });

  it("mémorise le dernier pas accepté, par compte", async () => {
    const { manager, secret } = await activerDeuxFa("rejeu-7@test.local");
    const autre = await activerDeuxFa("rejeu-7b@test.local");
    figerAu(PAS_FIXE);
    const p1 = await connexion("rejeu-7@test.local");
    await verifier(p1.body.pendingToken, await genererCodeTotp(secret));

    const [moi] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const [autreCompte] = await testDb.select().from(users).where(eq(users.id, autre.manager.id));
    expect(moi.totpLastUsedStep).toBe(PAS_FIXE);
    expect(autreCompte.totpLastUsedStep).toBeNull();
  });
});

describe("régénération des codes de secours", () => {
  it("refuse le code qui vient de servir à la connexion, accepte celui du pas suivant", async () => {
    const { secret, token } = await activerDeuxFa("rejeu-8@test.local");
    figerAu(PAS_FIXE);
    const code = await genererCodeTotp(secret);
    const p1 = await connexion("rejeu-8@test.local");
    expect((await verifier(p1.body.pendingToken, code)).status).toBe(200);

    const refuse = await request(app).post("/api/auth/2fa/backup-codes/regenerate").set(authHeader(token)).send({ code });
    expect(refuse.status).toBe(401);

    figerAu(PAS_FIXE + 1);
    const accepte = await request(app).post("/api/auth/2fa/backup-codes/regenerate").set(authHeader(token)).send({ code: await genererCodeTotp(secret) });
    expect(accepte.status).toBe(200);
    expect(accepte.body.backupCodes).toHaveLength(8);
  });

  it("un code accepté pour régénérer ne peut pas servir une deuxième fois", async () => {
    const { secret, token } = await activerDeuxFa("rejeu-9@test.local");
    figerAu(PAS_FIXE);
    const code = await genererCodeTotp(secret);
    expect((await request(app).post("/api/auth/2fa/backup-codes/regenerate").set(authHeader(token)).send({ code })).status).toBe(200);
    expect((await request(app).post("/api/auth/2fa/backup-codes/regenerate").set(authHeader(token)).send({ code })).status).toBe(401);
  });

  it("la confirmation de l'enrôlement ne consomme pas le code : on peut se connecter aussitôt après", async () => {
    const manager = await createManager({ email: "rejeu-10@test.local" });
    const token = tokenFor(manager);
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    figerAu(PAS_FIXE);
    const code = await genererCodeTotp(setup.body.secret);
    expect((await request(app).post("/api/auth/2fa/confirm").set(authHeader(token)).send({ code })).status).toBe(200);

    const p = await connexion("rejeu-10@test.local");
    expect((await verifier(p.body.pendingToken, code)).status).toBe(200);
  });
});

describe("POST /api/auth/logout — protection CSRF", () => {
  async function cookieDeSession(email: string) {
    await createManager({ email });
    const res = await connexion(email);
    expect(res.status).toBe(200);
    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    return { cookie: cookies.map((c) => c.split(";")[0]).join("; "), token: res.body.token as string | undefined };
  }
  const efface = (res: request.Response) => ((res.headers["set-cookie"] as unknown as string[]) ?? []).some((c) => /^token=;/.test(c) || /Expires=Thu, 01 Jan 1970/.test(c));

  it("refuse la déconnexion par cookie seul, sans l'en-tête que seul notre frontend pose, et n'efface rien", async () => {
    const { cookie } = await cookieDeSession("csrf-1@test.local");
    const res = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_REFUSED");
    expect(efface(res)).toBe(false);
  });

  it("déconnecte quand l'en-tête anti-CSRF accompagne le cookie, et efface le cookie", async () => {
    const { cookie } = await cookieDeSession("csrf-2@test.local");
    const res = await request(app).post("/api/auth/logout").set("Cookie", cookie).set("X-Requested-With", "XMLHttpRequest");
    expect(res.status).toBe(204);
    expect(efface(res)).toBe(true);
  });

  it("accepte un client à jeton Bearer (application mobile), sans en-tête anti-CSRF", async () => {
    const { token } = await cookieDeSession("csrf-3@test.local");
    const res = await request(app).post("/api/auth/logout").set(authHeader(token!));
    expect(res.status).toBe(204);
  });

  it("reste inoffensive sans aucune session : 204, comme avant", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
  });
});
