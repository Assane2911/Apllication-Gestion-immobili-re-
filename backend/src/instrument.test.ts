import multer from "multer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./utils/asyncHandler";
import { masquerJetonsAgenda, shouldReportToSentry } from "./instrument";

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
