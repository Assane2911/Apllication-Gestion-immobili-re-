import multer from "multer";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./utils/asyncHandler";
import { shouldReportToSentry } from "./instrument";

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
