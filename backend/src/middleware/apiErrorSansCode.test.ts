import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Chaque `new ApiError(statut, message)` doit porter un CODE (3ᵉ argument) : c'est lui que le frontend traduit.
 * Sans code, un utilisateur en anglais, portugais ou espagnol lit le message en français, et rien ne le signale.
 *
 * Garde sur les sources (voir aussi frontend/src/api/codesErreur.test.ts, qui vérifie que chaque code a sa
 * traduction dans les quatre langues).
 */
const RACINE = join(__dirname, "..");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.ts$/.test(nom) && !/\.test\.ts$/.test(nom) ? [chemin] : [];
  });
}

/** `fichier:texte du message` → raison. Laissés sans code volontairement. */
const SANS_CODE: Record<string, string> = {
  "controllers/cron.controller.ts:\"Non autorisé\"": "route appelée par le planificateur de tâches, jamais par un utilisateur",
  "controllers/cron.controller.ts:\"CRON_SECRET non configuré : route désactivée par sécurité.\"": "route appelée par le planificateur, message pour l'exploitation",
  "services/payment.service.ts:detail": "message du fournisseur de paiement (Stripe), affiché tel quel : il dit pourquoi (carte refusée…) ; le repli a son code",
  "services/payment.service.ts:data.response_text": "message du fournisseur de paiement (PayDunya), affiché tel quel ; le repli a son code",
};

describe("ApiError sans code", () => {
  it("aucune erreur de l'API n'est laissée sans code, hors exceptions justifiées", () => {
    const sansCode: string[] = [];
    for (const f of fichiers(RACINE)) {
      if (f.includes(`${join(RACINE, "test")}`)) continue;
      const source = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
      const visiter = (n: ts.Node) => {
        if (ts.isNewExpression(n) && n.expression.getText() === "ApiError" && (n.arguments?.length ?? 0) < 3) {
          const message = n.arguments?.[1]?.getText().replace(/\s+/g, " ") ?? "";
          const cle = `${f.slice(RACINE.length + 1)}:${message}`;
          if (!(cle in SANS_CODE)) sansCode.push(cle);
        }
        ts.forEachChild(n, visiter);
      };
      visiter(source);
    }
    expect(sansCode).toEqual([]);
  });
});
