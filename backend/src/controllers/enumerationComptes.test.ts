import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { createManager } from "../test/authHelpers";

/**
 * Une plateforme ne doit pas laisser vérifier de l'extérieur quelles adresses
 * email ont un compte chez elle. C'est un renseignement qui a de la valeur
 * pour qui prépare du hameçonnage ciblé, et qu'aucune fonctionnalité ne
 * réclame.
 *
 * /forgot-password était déjà muet. Deux autres chemins parlaient encore :
 * l'inscription, par son message d'erreur, et la connexion, par sa DURÉE.
 */
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
});
