import crypto from "crypto";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { authHeader, createManager, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { estMotDePasseEvident, MOT_DE_PASSE_OCTETS_MAX, motDePasseSchema, reprendLAdresse } from "../utils/motDePasse";

/**
 * Un NOUVEAU mot de passe ne peut être ni un choix évident (liste de fuites, caractère répété), ni l'adresse e-mail du
 * compte, ni plus long que ce que bcrypt lit (72 octets : le reste serait ignoré sans que personne ne le sache).
 * La connexion, elle, n'applique aucune de ces règles : un compte créé avant ce durcissement doit continuer à se connecter.
 */
describe("règle du mot de passe — fonctions", () => {
  it("reconnaît les mots de passe évidents, quelle que soit la casse", () => {
    for (const evident of ["password", "PASSWORD123", "Azertyuiop", "12345678", "aaaaaaaa", "ZZZZZZZZZZ", "MotDePasse"]) {
      expect(estMotDePasseEvident(evident), evident).toBe(true);
    }
  });

  it("laisse passer un mot de passe ordinaire, y compris celui des tests", () => {
    for (const bon of ["Password123!", "Abcdef12", "correct-cheval-pile-agrafe", "Dakar#Plateau2026"]) {
      expect(estMotDePasseEvident(bon), bon).toBe(false);
    }
  });

  it("repère l'adresse entière ou sa partie locale, mais pas une partie locale trop courte", () => {
    expect(reprendLAdresse("Fatou.Ndiaye@Exemple.com", "fatou.ndiaye@exemple.com")).toBe(true);
    expect(reprendLAdresse("fatou.ndiaye", "fatou.ndiaye@exemple.com")).toBe(true);
    expect(reprendLAdresse("abc", "abc@exemple.com")).toBe(false);
    expect(reprendLAdresse("autre-chose-123", "fatou.ndiaye@exemple.com")).toBe(false);
  });

  it("compte les octets, pas les caractères : 72 octets passent, 73 non", () => {
    expect(motDePasseSchema.safeParse("a1".repeat(36)).success).toBe(true); // 72 octets
    expect(motDePasseSchema.safeParse("a1".repeat(36) + "b").success).toBe(false); // 73 octets
    // 40 caractères de 2 octets = 80 octets : refusé alors que la longueur en caractères est modeste.
    expect(motDePasseSchema.safeParse("é".repeat(40)).success).toBe(false);
    expect(MOT_DE_PASSE_OCTETS_MAX).toBe(72);
  });
});

describe("règle du mot de passe — inscription", () => {
  it("refuse un mot de passe évident, avec un code que l'interface traduit, sans créer le compte", async () => {
    const res = await request(app).post("/api/auth/register").send({ country: "SN", email: "evident@test.local", password: "azertyuiop" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_COMMON");
    const [absent] = await testDb.select().from(users).where(eq(users.email, "evident@test.local"));
    expect(absent).toBeUndefined();
  });

  it("refuse un mot de passe qui est l'adresse e-mail", async () => {
    const res = await request(app).post("/api/auth/register").send({ country: "SN", email: "jeanne.dupont@test.local", password: "jeanne.dupont@test.local" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_IS_EMAIL");
  });

  it("refuse plus de 72 octets en annonçant la limite, plutôt que d'ignorer la fin en silence", async () => {
    const res = await request(app).post("/api/auth/register").send({ country: "SN", email: "longue@test.local", password: "Ab1!".repeat(19) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_LONG");
    expect(res.body.params).toEqual({ max: 72 });
  });

  it("répond de la même façon que l'adresse soit libre ou déjà prise (pas de fuite sur l'existence du compte)", async () => {
    await createManager({ email: "deja.prise@test.local" });
    const prise = await request(app).post("/api/auth/register").send({ country: "SN", email: "deja.prise@test.local", password: "azertyuiop" });
    const libre = await request(app).post("/api/auth/register").send({ country: "SN", email: "libre.evident@test.local", password: "azertyuiop" });
    expect(prise.status).toBe(libre.status);
    expect(prise.body).toEqual(libre.body);
  });
});

describe("règle du mot de passe — réinitialisation", () => {
  async function demanderLien(email?: string) {
    const manager = await createManager(email ? { email } : {});
    const jeton = `jeton-${crypto.randomBytes(8).toString("hex")}`;
    await testDb
      .update(users)
      .set({ resetPasswordTokenHash: crypto.createHash("sha256").update(jeton).digest("hex"), resetPasswordExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(users.id, manager.id));
    return { manager, jeton };
  }

  it("refuse un mot de passe évident sans consommer le lien : le même lien sert ensuite à en choisir un bon", async () => {
    const { jeton } = await demanderLien();
    const evident = await request(app).post("/api/auth/reset-password").send({ token: jeton, password: "password123" });
    expect(evident.status).toBe(400);
    expect(evident.body.code).toBe("PASSWORD_TOO_COMMON");

    const bon = await request(app).post("/api/auth/reset-password").send({ token: jeton, password: "Nouveau-secret-2026" });
    expect(bon.status).toBe(200);
  });

  it("refuse l'adresse e-mail du compte comme nouveau mot de passe", async () => {
    const { jeton } = await demanderLien("reset.adresse@test.local");
    const res = await request(app).post("/api/auth/reset-password").send({ token: jeton, password: "reset.adresse@test.local" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_IS_EMAIL");
  });

  it("un jeton inventé reste « lien invalide », quel que soit le mot de passe proposé (rien ne se devine sur les comptes)", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "jeton-inconnu", password: "Nouveau-secret-2026" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESET_LINK_INVALID");
  });
});

describe("règle du mot de passe — accès portail créé par le gestionnaire", () => {
  it("refuse un mot de passe évident ou l'adresse du locataire", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { email: "locataire.portail@test.local" });
    for (const [password, code] of [
      ["12345678", "PASSWORD_TOO_COMMON"],
      ["locataire.portail@test.local", "PASSWORD_IS_EMAIL"],
    ] as const) {
      const res = await request(app).post(`/api/tenants/${tenant.id}/portal-account`).set(authHeader(tokenFor(manager))).send({ password });
      expect(res.status, password).toBe(400);
      expect(res.body.code, password).toBe(code);
    }
  });
});

describe("règle du mot de passe — la connexion n'est pas durcie", () => {
  it("un compte dont le mot de passe, aujourd'hui interdit pour un nouveau choix, a été posé avant, se connecte toujours", async () => {
    const manager = await createManager({ email: "ancien@test.local" });
    await testDb.update(users).set({ passwordHash: await bcrypt.hash("password", 10) }).where(eq(users.id, manager.id));
    const res = await request(app).post("/api/auth/login").send({ email: "ancien@test.local", password: "password" });
    expect(res.status).toBe(200);
  });
});
