import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app";

/**
 * Aucune route de l'API ne doit répondre sans jeton de connexion, sauf celles qui sont publiques PAR CONCEPTION et
 * listées ci-dessous, chacune avec sa raison.
 *
 * Toutes les routes protégées le sont par un `router.use(authenticate, …)` placé en tête de leur fichier. Retirer cette
 * ligne par erreur, ou ajouter une route avant elle, ouvrirait des données de locataires, de loyers ou de pièces
 * d'identité à n'importe qui, sans qu'aucun autre test ne s'en aperçoive (ils se connectent tous). Ce test parcourt les
 * routes réellement enregistrées dans l'application et les appelle SANS jeton : une route ajoutée demain sans
 * authentification et absente de la liste fait échouer la CI.
 *
 * Les routes de la liste ne sont jamais appelées ici (certaines ont des effets : déconnexion, envoi d'e-mails).
 */
const PUBLIQUES: Record<string, string> = {
  "GET /api/health": "sonde de disponibilité : la fonction démarre",
  "GET /api/health/ready": "sonde de disponibilité : la base répond (aucun détail renvoyé)",
  "POST /api/csp-report": "rapports de politique de sécurité envoyés par le navigateur, sans session",
  "POST /api/auth/register": "inscription d'un gestionnaire",
  "POST /api/auth/login": "connexion par e-mail et mot de passe",
  "POST /api/auth/2fa/verify-login": "seconde étape de connexion (jeton d'attente 2FA, pas encore de session)",
  "POST /api/auth/google": "connexion avec Google (le jeton d'identité Google est vérifié)",
  "POST /api/auth/verify-email": "confirmation d'adresse par le lien reçu (jeton à usage unique)",
  "POST /api/auth/resend-verification": "renvoi du lien de confirmation (réponse identique si l'adresse est inconnue)",
  "POST /api/auth/forgot-password": "demande de réinitialisation (réponse identique si l'adresse est inconnue)",
  "POST /api/auth/reset-password": "réinitialisation par le lien reçu (jeton à usage unique)",
  "POST /api/auth/logout": "déconnexion : efface le cookie de session, sans effet si aucune session",
  "GET /api/subscription/plans": "formules d'abonnement, affichées avant l'inscription",
  "GET /api/listings/public": "annonces publiées, visibles par les visiteurs",
  "GET /api/listings/public/countries": "pays des annonces publiées, pour le filtre public",
  "GET /api/listings/public/:p": "détail d'une annonce publiée",
  "POST /api/listings/public/:p/leads": "demande de contact d'un visiteur sur une annonce (limitée en fréquence)",
  "POST /api/payments/paydunya/ipn": "notification de paiement de PayDunya, authentifiée par sa signature et sa confirmation côté serveur",
};

interface Route {
  methode: string;
  chemin: string;
}

function cheminDepuisRegexp(source: string): string {
  return source.replace("^", "").replace("\\/?(?=\\/|$)", "").replace("(?:\\/(?=$))?", "").replace(/\\\//g, "/").replace("$", "");
}

function collecter(pile: any[], prefixe: string, sortie: Route[]) {
  for (const couche of pile) {
    if (couche.route) {
      for (const methode of Object.keys(couche.route.methods)) {
        const brut = typeof couche.route.path === "string" ? couche.route.path : "";
        sortie.push({ methode: methode.toUpperCase(), chemin: (prefixe + brut).replace(/:[A-Za-z]+/g, ":p").replace(/\/+$/, "") || "/" });
      }
    } else if (couche.name === "router" && couche.handle?.stack) {
      collecter(couche.handle.stack, prefixe + cheminDepuisRegexp(couche.regexp.source), sortie);
    }
  }
}

const routes: Route[] = [];
collecter((app as any)._router.stack, "", routes);
const api = routes.filter((r) => r.chemin.startsWith("/api"));
const cle = (r: Route) => `${r.methode} ${r.chemin}`;

describe("routes ouvertes sans jeton de connexion", () => {
  it("le parcours trouve bien les routes de l'application", () => {
    expect(api.length).toBeGreaterThan(150);
  });

  it("chaque route publique de la liste existe encore (pas de ligne périmée qui masquerait un oubli)", () => {
    const existantes = new Set(api.map(cle));
    const perimees = Object.keys(PUBLIQUES).filter((k) => !existantes.has(k));
    expect(perimees, `routes de la liste qui n'existent plus : ${perimees.join(", ")}`).toEqual([]);
  });

  it("toute autre route refuse une requête sans jeton (401)", async () => {
    const ouvertes: string[] = [];
    for (const route of api.filter((r) => !(cle(r) in PUBLIQUES))) {
      const res = await (request(app) as any)[route.methode.toLowerCase()](route.chemin.replace(/:p/g, "x")).send({});
      if (res.status !== 401) ouvertes.push(`${cle(route)} → ${res.status}`);
    }
    expect(ouvertes, `routes qui répondent sans jeton et ne figurent pas dans la liste des routes publiques :\n${ouvertes.join("\n")}`).toEqual([]);
  }, 120_000);

  it("chaque route publique a une raison écrite", () => {
    for (const [route, raison] of Object.entries(PUBLIQUES)) expect(raison.length, route).toBeGreaterThan(10);
  });
});
