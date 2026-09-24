import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Une plateforme ne doit pas laisser vérifier de l'extérieur quelles adresses
 * email ont un compte chez elle. C'est un renseignement qui a de la valeur
 * pour qui prépare du hameçonnage ciblé, et qu'aucune fonctionnalité ne
 * réclame.
 *
 * /forgot-password était déjà muet. Deux autres chemins parlaient encore :
 * l'inscription, par son message d'erreur, et la connexion, par sa DURÉE.
 */
/** Attend que le mock d'envoi ait été appelé, sans parier sur un délai fixe. */
async function attendreEnvoi(lire: () => (() => void) | undefined) {
  for (let i = 0; i < 200; i += 1) {
    if (lire()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("L'envoi d'email n'a jamais été engagé");
}

describe("énumération des comptes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/auth/register", () => {
    it("répond exactement la même chose pour une adresse libre et une adresse déjà prise", async () => {
      // Régression : l'adresse prise recevait un 409 « Un compte existe déjà
      // avec cet email ». Il suffisait donc d'essayer de s'inscrire pour
      // savoir qui est client.
      const existant = await createManager();

      const surAdressePrise = await request(app)
        .post("/api/auth/register")
        .send({ email: existant.email, password: "MotDePasse123" });

      const surAdresseLibre = await request(app)
        .post("/api/auth/register")
        .send({ email: `libre-${Date.now()}@exemple.fr`, password: "MotDePasse123" });

      expect(surAdressePrise.status).toBe(surAdresseLibre.status);
      expect(surAdressePrise.body).toEqual(surAdresseLibre.body);

      // Et la réponse ne contient plus l'adresse : la renvoyer depuis la base
      // aurait suffi à distinguer les deux cas (normalisation, casse...).
      expect(JSON.stringify(surAdressePrise.body)).not.toContain(existant.email);
    });

    it("ne touche pas au compte existant", async () => {
      // Une tentative d'inscription sur une adresse prise ne doit RIEN
      // écrire : ni nouveau compte, ni jeton de vérification écrasé sur
      // l'ancien, qui invaliderait un lien légitime en cours de route.
      const existant = await createManager();

      await request(app)
        .post("/api/auth/register")
        .send({ email: existant.email, password: "UnAutreMotDePasse123" });

      const connexion = await request(app)
        .post("/api/auth/login")
        .send({ email: existant.email, password: "UnAutreMotDePasse123" });

      // Le mot de passe du compte n'a pas été remplacé par celui du visiteur.
      expect(connexion.status).toBe(401);
    });

    /**
     * Régression mineure, même famille que le test bcrypt de /login
     * ci-dessous. Le message et le statut étaient déjà identiques dans les
     * deux cas, mais le chemin "adresse libre" hache le mot de passe (bcrypt,
     * ~100 ms) avant de créer le compte, alors que le chemin "adresse prise"
     * ne le faisait pas — un écart de temps de réponse mesurable.
     */
    it("passe par bcrypt.hash même pour une adresse déjà prise", async () => {
      const existant = await createManager();
      const espion = vi.spyOn(bcrypt, "hash");

      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: existant.email, password: "UnAutreMotDePasse123" });

      expect(res.status).toBe(201);
      expect(espion).toHaveBeenCalledTimes(1);
    });

    /**
     * Cette propriété a CHANGÉ, et le changement est délibéré.
     *
     * Les deux chemins détachaient l'envoi pour que la réponse ne dépende pas
     * de la durée SMTP. Sur Vercel, l'exécution peut s'arrêter dès la réponse
     * envoyée : la promesse en vol était alors perdue, et un compte créé sans
     * email de confirmation devient inutilisable, `login` refusant tout
     * gestionnaire non confirmé.
     *
     * Ce qui protège de l'énumération n'est pas l'absence d'attente, c'est la
     * SYMÉTRIE : les deux chemins envoient exactement un email à la même
     * adresse. Le temps de réponse ne distingue donc plus une adresse prise
     * d'une adresse libre, même en attendant. C'est cette symétrie que le test
     * vérifie désormais.
     *
     * (Distinction avec forgotPassword et resendVerification, plus bas : là,
     * une adresse inconnue n'a rien à envoyer. L'attente y créerait un écart
     * réel, donc l'envoi y reste détaché.)
     */
    it("attend l'envoi de la même façon, adresse prise ou libre", async () => {
      const existant = await createManager();
      let resoudre: (() => void) | undefined;
      const envoiSuspendu = () =>
        new Promise<void>((r) => {
          resoudre = r;
        }) as unknown as ReturnType<typeof emailService.sendEmail>;
      const espion = vi.spyOn(emailService, "sendEmail").mockImplementation(envoiSuspendu);

      // Adresse déjà prise : la réponse ne doit pas arriver avant l'envoi.
      const surPrise = request(app)
        .post("/api/auth/register")
        .send({ email: existant.email, password: "UnAutreMotDePasse123" })
        .then((r) => r.status);
      let termine = false;
      void surPrise.then(() => {
        termine = true;
      });
      // bcrypt hache avant d'en arriver à l'email : on attend que l'envoi soit
      // réellement engagé plutôt que de parier sur un délai fixe.
      await attendreEnvoi(() => resoudre);
      expect(termine).toBe(false);
      resoudre!();
      expect(await surPrise).toBe(201);

      // Adresse libre : exactement le même comportement.
      resoudre = undefined;
      const surLibre = request(app)
        .post("/api/auth/register")
        .send({ email: `libre-${Date.now()}@exemple.fr`, password: "UnAutreMotDePasse123" })
        .then((r) => r.status);
      let termine2 = false;
      void surLibre.then(() => {
        termine2 = true;
      });
      await attendreEnvoi(() => resoudre);
      expect(termine2).toBe(false);
      resoudre!();
      expect(await surLibre).toBe(201);

      expect(espion).toHaveBeenCalledTimes(2);
    }, 5000);
  });

  describe("POST /api/auth/login", () => {
    it("passe par bcrypt même pour une adresse inconnue", async () => {
      // Régression. Le message d'erreur était déjà identique dans les deux
      // cas, mais pas le temps de réponse : une adresse inconnue repartait
      // immédiatement, une adresse connue après un bcrypt.compare (~100 ms).
      // L'écart se mesure de l'extérieur.
      //
      // On vérifie la cause plutôt que la durée : un test chronométré serait
      // instable en intégration continue, alors que la propriété à garantir
      // est précisément que le hachage a lieu dans les deux cas.
      const espion = vi.spyOn(bcrypt, "compare");

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "personne@exemple.fr", password: "peu-importe" });

      expect(res.status).toBe(401);
      expect(espion).toHaveBeenCalledTimes(1);
    });

    it("renvoie le même message pour une adresse inconnue et un mot de passe faux", async () => {
      const manager = await createManager();

      const inconnue = await request(app)
        .post("/api/auth/login")
        .send({ email: "personne@exemple.fr", password: "peu-importe" });

      const mauvaisMotDePasse = await request(app)
        .post("/api/auth/login")
        .send({ email: manager.email, password: "mauvais-mot-de-passe" });

      expect(inconnue.status).toBe(mauvaisMotDePasse.status);
      expect(inconnue.body).toEqual(mauvaisMotDePasse.body);
    });
  });

  /**
   * Régression. Le message était déjà identique dans les deux cas (adresse
   * connue ou non), mais pas le temps de réponse : seule une adresse à qui
   * il restait quelque chose à renvoyer attendait un envoi SMTP réel — une
   * opération réseau, bien plus longue et bien plus variable que tout le
   * reste de la route. Un chronomètre serait instable en intégration
   * continue ; on vérifie donc la cause directement, en bloquant l'envoi
   * d'email et en s'assurant que la réponse arrive quand même. Si le code
   * attend encore l'envoi avant de répondre, ce test expire (timeout) au
   * lieu d'aboutir.
   */
  describe("POST /api/auth/forgot-password", () => {
    it("répond sans attendre l'envoi de l'email de réinitialisation", async () => {
      const manager = await createManager();
      const envoiBloque = new Promise<void>(() => {
        /* volontairement jamais résolue : simule un SMTP très lent/injoignable */
      });
      const espion = vi
        .spyOn(emailService, "sendEmail")
        .mockReturnValue(envoiBloque as unknown as ReturnType<typeof emailService.sendEmail>);

      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: manager.email });

      expect(res.status).toBe(200);
      expect(espion).toHaveBeenCalledTimes(1);

      const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
      expect(apres.resetPasswordTokenHash).not.toBeNull();
    }, 1000);
  });

  describe("POST /api/auth/resend-verification", () => {
    it("répond sans attendre l'envoi de l'email de confirmation", async () => {
      // createManager() vérifie l'email par défaut : on force le compte à
      // l'état "en attente de confirmation" que cette route est censée traiter.
      const manager = await createManager({ emailVerifiedAt: null });
      const envoiBloque = new Promise<void>(() => {
        /* volontairement jamais résolue */
      });
      const espion = vi
        .spyOn(emailService, "sendEmail")
        .mockReturnValue(envoiBloque as unknown as ReturnType<typeof emailService.sendEmail>);

      const res = await request(app)
        .post("/api/auth/resend-verification")
        .send({ email: manager.email });

      expect(res.status).toBe(200);
      expect(espion).toHaveBeenCalledTimes(1);

      const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
      expect(apres.emailVerificationTokenHash).not.toBeNull();
    }, 1000);
  });
});
