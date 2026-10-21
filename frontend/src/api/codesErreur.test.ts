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
      // avecCode(message, code, valeurs) : le message explicite d'un `.refine()` zod (utils/validationExplicite.ts).
      if (ts.isCallExpression(n) && n.expression.getText() === "avecCode" && n.arguments[1] && ts.isStringLiteral(n.arguments[1])) {
        codes.add(n.arguments[1].text);
      }
      // Messages ligne par ligne de l'aperçu d'import : messages.push(texte, code, valeurs) et unMessage(texte, code, valeurs).
      if (
        ts.isCallExpression(n) &&
        ["messages.push", "unMessage"].includes(n.expression.getText()) &&
        n.arguments[1] &&
        ts.isStringLiteral(n.arguments[1])
      ) {
        codes.add(n.arguments[1].text);
      }
      // Même cas quand le code dépend d'une condition : messages.push(texte, cond ? "CODE_A" : "CODE_B", valeurs).
      if (ts.isCallExpression(n) && n.expression.getText() === "messages.push" && n.arguments[1] && ts.isConditionalExpression(n.arguments[1])) {
        for (const branche of [n.arguments[1].whenTrue, n.arguments[1].whenFalse]) if (ts.isStringLiteral(branche)) codes.add(branche.text);
      }
      // Erreurs de lecture d'un fichier d'import : new CsvInvalide(message, code, valeurs).
      if (
        ts.isNewExpression(n) &&
        ["CsvInvalide", "ImportInvalide"].includes(n.expression.getText()) &&
        n.arguments?.[1] &&
        ts.isStringLiteral(n.arguments[1])
      ) {
        codes.add(n.arguments[1].text);
      }
      // Propriété `code: "CODE_EN_MAJUSCULES"` : refus de paiement (Indisponibilite), réponses du gestionnaire
      // d'erreurs et des middlewares.
      if (ts.isPropertyAssignment(n) && n.name.getText() === "code" && ts.isStringLiteral(n.initializer) && /^[A-Z][A-Z0-9_]{2,}$/.test(n.initializer.text)) {
        codes.add(n.initializer.text);
      }
      // assertOwnership(entité, accesseur, gestionnaire, message, statut, code) : le code est le sixième argument.
      if (ts.isCallExpression(n) && n.expression.getText() === "assertOwnership" && n.arguments[5] && ts.isStringLiteral(n.arguments[5])) {
        codes.add(n.arguments[5].text);
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

  it("les langues portent les mêmes codes et les mêmes valeurs à insérer que le français", async () => {
    const [en, pt, es] = (await Promise.all([import("../i18n/locales/en"), import("../i18n/locales/pt"), import("../i18n/locales/es")])).map(
      (m) => (m.default as unknown as { common: { serverErrors: Record<string, string> } }).common.serverErrors
    );
    const frErr = (fr as unknown as { common: { serverErrors: Record<string, string> } }).common.serverErrors;
    const valeurs = (texte: string) => [...texte.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [nom, langue] of [["en", en], ["pt", pt], ["es", es]] as const) {
      expect(Object.keys(langue).sort(), `codes de ${nom}`).toEqual(Object.keys(frErr).sort());
      for (const code of Object.keys(frErr)) expect(valeurs(langue[code]), `${nom}.${code}`).toEqual(valeurs(frErr[code]));
    }
  });

  it("aucune traduction ne vise un code qui n'existe plus dans le backend", () => {
    const traduits = Object.keys((fr as unknown as { common: { serverErrors: Record<string, string> } }).common.serverErrors);
    const codes = codesDuBackend();
    expect(traduits.filter((c) => !codes.includes(c))).toEqual([]);
  });
});
