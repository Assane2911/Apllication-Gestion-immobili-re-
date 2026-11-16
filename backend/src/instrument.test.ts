import multer from "multer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OrigineNonAutorisee } from "./middleware/errorHandler";
import { ApiError } from "./utils/asyncHandler";
import { masquerDonneesSensibles, masquerJetonsAgenda, retenirSiMasquageImpossible, shouldReportToSentry } from "./instrument";

// Ce prédicat décide de ce qui atteint Sentry. Il est branché sur
// expressIntegration() et s'applique donc AVANT errorHandler : c'est le seul
// endroit de la chaîne où l'on peut empêcher qu'une erreur du client soit
// comptée comme un défaut applicatif.
//
// Il reconnaît ZodError et MulterError par leur `name` et non par
// `instanceof`, pour ne pas charger zod ni multer depuis instrument.ts (chargé
// en tout premier, avant l'instrumentation d'express). Ces tests utilisent de
// VRAIES instances de ces classes : si l'une d'elles changeait de `name` lors
// d'une mise à jour, ils échoueraient au lieu de laisser le bruit revenir
// silencieusement.

function zodError() {
  const result = z.object({ email: z.string().email() }).safeParse({ email: "pas-un-email" });
  if (result.success) throw new Error("le schéma aurait dû rejeter cette valeur");
  return result.error;
}

describe("shouldReportToSentry", () => {
  it("ignore une requête mal formée (vraie ZodError)", () => {
    expect(zodError().name).toBe("ZodError");
    expect(shouldReportToSentry(zodError())).toBe(false);
  });

  it("ignore un upload refusé (vraie MulterError)", () => {
    const erreur = new multer.MulterError("LIMIT_FILE_SIZE");
    expect(erreur.name).toBe("MulterError");
    expect(shouldReportToSentry(erreur)).toBe(false);
  });

  it("ignore une origine CORS refusée (vraie OrigineNonAutorisee) : réponse 403 attendue, 294 faux défauts en 15 jours", () => {
    const erreur = new OrigineNonAutorisee();
    expect(erreur.name).toBe("OrigineNonAutorisee");
    expect(shouldReportToSentry(erreur)).toBe(false);
  });

  it("ignore les erreurs métier attendues (4xx)", () => {
    expect(shouldReportToSentry(new ApiError(401, "Authentification requise"))).toBe(false);
    expect(shouldReportToSentry(new ApiError(402, "Abonnement expiré"))).toBe(false);
    expect(shouldReportToSentry(new ApiError(404, "Bien introuvable"))).toBe(false);
    expect(shouldReportToSentry(new ApiError(429, "Trop de tentatives"))).toBe(false);
  });

  it("remonte les erreurs serveur (5xx), y compris une ApiError explicite", () => {
    expect(shouldReportToSentry(new ApiError(500, "Échec de l'upload vers Supabase"))).toBe(true);
    expect(shouldReportToSentry(new ApiError(503, "Paiement Stripe indisponible"))).toBe(true);
  });

  it("remonte une erreur inattendue sans statut, comme le fait Sentry par défaut", () => {
    expect(shouldReportToSentry(new Error("connexion à la base perdue"))).toBe(true);
  });

  it("interprète un statut fourni sous forme de chaîne", () => {
    // MiddlewareError autorise `status`/`statusCode` en string : sans
    // conversion, la comparaison numérique serait toujours fausse et une vraie
    // panne 500 passerait inaperçue.
    expect(shouldReportToSentry({ name: "Error", status: "503" })).toBe(true);
    expect(shouldReportToSentry({ name: "Error", statusCode: "404" })).toBe(false);
  });

  it("remonte une erreur dont le statut est illisible plutôt que de la perdre", () => {
    expect(shouldReportToSentry({ name: "Error", statusCode: "inconnu" })).toBe(true);
  });

  it("préfère statusCode à status quand les deux sont présents", () => {
    expect(shouldReportToSentry({ name: "Error", statusCode: 404, status: 500 })).toBe(false);
  });
});

/**
 * Audit de sécurité : le jeton du lien de calendrier est dans l'adresse. Sentry reçoit l'adresse de la requête, ses fils d'Ariane et le
 * nom des opérations : le jeton ne doit figurer dans aucun de ces champs.
 */
describe("masquerJetonsAgenda", () => {
  const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde".slice(0, 43);

  it("masque le jeton partout dans l'événement : adresse, fil d'Ariane, nom de transaction, tags", () => {
    const evenement = {
      request: { url: `https://api.example.test/api/agenda/ics/${JETON}.ics`, method: "GET" },
      transaction: `GET /api/agenda/ics/${JETON}.ics`,
      breadcrumbs: [{ category: "http", data: { url: `https://api.example.test/api/agenda/ics/${JETON}.ics?x=1` } }],
      tags: { chemin: `/agenda/ics/${JETON}.ics` },
    };

    const sortie = masquerJetonsAgenda(evenement);

    expect(JSON.stringify(sortie)).not.toContain(JETON);
    expect(sortie.request.url).toBe("https://api.example.test/api/agenda/ics/[masqué].ics");
    expect(sortie.breadcrumbs[0].data.url).toBe("https://api.example.test/api/agenda/ics/[masqué].ics?x=1");
    expect(sortie.request.method).toBe("GET");
  });

  it("masque plusieurs jetons dans le même événement", () => {
    const autre = JETON.split("").reverse().join("");
    const sortie = masquerJetonsAgenda({ a: `/agenda/ics/${JETON}.ics`, b: `/agenda/ics/${autre}.ics` });

    expect(JSON.stringify(sortie)).not.toContain(JETON);
    expect(JSON.stringify(sortie)).not.toContain(autre);
  });

  it("ne touche pas un événement sans jeton (même objet rendu)", () => {
    const evenement = { request: { url: "https://api.example.test/api/agenda/summary" }, message: "Erreur ordinaire" };

    expect(masquerJetonsAgenda(evenement)).toBe(evenement);
  });

  it("ne masque pas les autres routes de l'agenda", () => {
    const evenement = { request: { url: "https://api.example.test/api/agenda/feed" } };

    expect(masquerJetonsAgenda(evenement).request.url).toBe("https://api.example.test/api/agenda/feed");
  });
});

/**
 * Les transactions de Sentry transportent parfois des objets Node non sérialisables tels quels (un `Timeout` référence la liste
 * de minuteries qui le référence en retour). `JSON.stringify` y levait « Converting circular structure to JSON » : 533 fois en
 * quatre jours en production, chaque transaction concernée étant perdue. Le masquage doit tolérer les références circulaires,
 * continuer à masquer, et — en cas d'échec quelconque — retenir l'événement plutôt que de l'envoyer non masqué.
 */
describe("masquage des événements Sentry", () => {
  it("tolère une référence circulaire (comme un Timeout Node) sans lever d'erreur", () => {
    const minuterie: Record<string, unknown> = { nom: "Timeout" };
    const liste: Record<string, unknown> = { premier: minuterie };
    minuterie._idlePrev = liste;
    liste._idleNext = minuterie;
    const evenement = { transaction: "GET /api/listings/public", contexts: { timer: minuterie } };

    expect(() => masquerDonneesSensibles(evenement)).not.toThrow();
    const resultat = masquerDonneesSensibles(evenement) as typeof evenement;
    expect(resultat.transaction).toBe("GET /api/listings/public");
  });

  it("masque toujours le jeton d'agenda, même dans un événement qui contient une référence circulaire", () => {
    const jeton = "abcdefghijklmnopqrstuvwxyz0123456789";
    const boucle: Record<string, unknown> = {};
    boucle.soi = boucle;
    const evenement = { request: { url: `https://api.exemple.test/api/agenda/ics/${jeton}.ics` }, boucle };

    const texte = JSON.stringify(masquerDonneesSensibles(evenement));

    expect(texte).not.toContain(jeton);
    expect(texte).toContain("[masqué]");
  });

  it("ne remplace pas par « circulaire » une référence simplement partagée à deux endroits", () => {
    const partage = { valeur: 42 };
    const resultat = masquerDonneesSensibles({ a: partage, b: partage }) as { a: { valeur: number }; b: { valeur: number } };

    expect(resultat.a.valeur).toBe(42);
    expect(resultat.b.valeur).toBe(42);
  });

  it("retient l'événement (null) plutôt que de lever ou d'envoyer du non masqué quand le masquage échoue", () => {
    const piege = { get dangereux(): never { throw new Error("boum"); } };

    expect(retenirSiMasquageImpossible(piege)).toBeNull();
    expect(retenirSiMasquageImpossible({ ok: true })).toEqual({ ok: true });
  });
});
