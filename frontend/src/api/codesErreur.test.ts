import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import fr from "../i18n/locales/fr";

/**
 * Chaque code d'erreur que le backend pose sur une `ApiError` doit avoir sa traduction (voir apiErrorMessage) :
 * sans elle, l'utilisateur anglophone, lusophone ou hispanophone lirait de nouveau le texte français du serveur,
 * et rien ne le signalerait. Garde croisée : lit les sources du backend.
 */
const RACINE_BACKEND = join(__dirname, "../../../backend/src");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.ts$/.test(nom) && !/\.test\.ts$/.test(nom) ? [chemin] : [];
  });
}

/** Codes laissés sans traduction volontairement, avec la raison. */
const SANS_TRADUCTION: Record<string, string> = {
  EMAIL_TAKEN: "traité par la page d'inscription, qui affiche son propre message",
};

function codesDuBackend(): string[] {
  const codes = new Set<string>();
  for (const f of fichiers(RACINE_BACKEND)) {
    const source = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const visiter = (n: ts.Node) => {
      if (ts.isNewExpression(n) && n.expression.getText() === "ApiError" && n.arguments && n.arguments[2]) {
        const arg = n.arguments[2];
        if (ts.isStringLiteral(arg)) codes.add(arg.text);
      }
      ts.forEachChild(n, visiter);
    };
    visiter(source);
  }
  return [...codes].sort();
}

describe.skipIf(!existsSync(RACINE_BACKEND))("codes d'erreur du backend", () => {
  it("le parcours trouve les codes du backend", () => {
    const codes = codesDuBackend();
    expect(codes).toContain("INVALID_CREDENTIALS");
    expect(codes).toContain("PLAN_REQUIRED");
  });

  it("chaque code a sa traduction, sauf exceptions justifiées", () => {
    const traduits = Object.keys((fr as unknown as { common: { serverErrors: Record<string, string> } }).common.serverErrors);
    const manquants = codesDuBackend().filter((c) => !traduits.includes(c) && !(c in SANS_TRADUCTION));
    expect(manquants).toEqual([]);
  });

  it("aucune traduction ne vise un code qui n'existe plus dans le backend", () => {
    const traduits = Object.keys((fr as unknown as { common: { serverErrors: Record<string, string> } }).common.serverErrors);
    const codes = codesDuBackend();
    expect(traduits.filter((c) => !codes.includes(c))).toEqual([]);
  });
});
