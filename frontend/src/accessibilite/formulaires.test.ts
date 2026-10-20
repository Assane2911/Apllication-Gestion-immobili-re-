import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Deux règles d'accessibilité des formulaires, vérifiées sur le code source de toutes les pages et de tous les
 * composants (analyse syntaxique, pas de simple recherche de texte) :
 *
 * 1. Un message d'erreur doit être annoncé : sans `role="alert"`, un lecteur d'écran ne dit rien quand une
 *    connexion, un enregistrement ou un envoi échoue — l'utilisateur croit que rien ne s'est passé.
 * 2. Un `<label>` doit désigner un champ (`htmlFor` ou champ imbriqué) : un intitulé de groupe n'est pas un label.
 * 3. Un champ doit avoir un nom : un `placeholder` disparaît dès la première lettre saisie et n'est pas un nom
 *    fiable ; il faut un `<label>`, un `id` relié à un `<label htmlFor>`, ou un `aria-label`.
 */

const RACINE = join(__dirname, "..");

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    return /\.tsx$/.test(nom) && !/\.test\.tsx$/.test(nom) ? [chemin] : [];
  });
}

type Element = ts.JsxElement | ts.JsxSelfClosingElement;

function balise(n: Element): string {
  return (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText();
}

function attributs(n: Element): Map<string, ts.JsxAttribute> {
  const ouverture = ts.isJsxElement(n) ? n.openingElement : n;
  return new Map(ouverture.attributes.properties.filter(ts.isJsxAttribute).map((a) => [a.name.getText(), a]));
}

function aUnSpread(n: Element): boolean {
  const ouverture = ts.isJsxElement(n) ? n.openingElement : n;
  return ouverture.attributes.properties.some(ts.isJsxSpreadAttribute);
}

const NOM_D_ERREUR = /(^|[a-z])(error|erreur)s?$/i;

function affichePuUneErreur(n: ts.JsxElement): boolean {
  return n.children.some((enfant) => {
    if (!ts.isJsxExpression(enfant) || !enfant.expression) return false;
    const e = enfant.expression;
    const nom = ts.isPropertyAccessExpression(e) ? e.name.getText() : ts.isIdentifier(e) ? e.getText() : "";
    return NOM_D_ERREUR.test(nom);
  });
}

function parcourir(visiteur: (n: Element, dansLabel: boolean, fichier: string, ligne: number) => void) {
  for (const fichier of fichiersSource(RACINE)) {
    const source = ts.createSourceFile(fichier, readFileSync(fichier, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visiter = (n: ts.Node, dansLabel: boolean) => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const ligne = source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        visiteur(n, dansLabel, fichier.replace(RACINE, "src"), ligne);
        dansLabel = dansLabel || balise(n) === "label";
      }
      ts.forEachChild(n, (enfant) => visiter(enfant, dansLabel));
    };
    visiter(source, false);
  }
}

describe("accessibilité des formulaires", () => {
  it("tout message d'erreur affiché est annoncé aux lecteurs d'écran (role=alert)", () => {
    const sansAnnonce: string[] = [];
    parcourir((n, _dansLabel, fichier, ligne) => {
      if (!ts.isJsxElement(n) || !/^(p|div|span|li)$/.test(balise(n))) return;
      const a = attributs(n);
      const classes = a.get("className")?.initializer?.getText() ?? "";
      if (!/red-/.test(classes) || !affichePuUneErreur(n)) return;
      if (!a.has("role") && !a.has("aria-live")) sansAnnonce.push(`${fichier}:${ligne}`);
    });

    expect(sansAnnonce).toEqual([]);
  });

  it("tout <label> désigne un champ ; un intitulé de groupe (boutons radio, bouton Google) n'en est pas un", () => {
    const orphelins: string[] = [];
    parcourir((n, _dansLabel, fichier, ligne) => {
      if (!ts.isJsxElement(n) || balise(n) !== "label" || attributs(n).has("htmlFor")) return;
      let contientUnChamp = false;
      const chercher = (x: ts.Node) => {
        if ((ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) && /^(input|select|textarea)$/.test(balise(x))) contientUnChamp = true;
        ts.forEachChild(x, chercher);
      };
      chercher(n);
      if (!contientUnChamp) orphelins.push(`${fichier}:${ligne}`);
    });

    expect(orphelins).toEqual([]);
  });

  it("tout champ de saisie a un nom : label, id relié à un label, ou aria-label", () => {
    const sansNom: string[] = [];
    parcourir((n, dansLabel, fichier, ligne) => {
      if (!/^(input|select|textarea)$/.test(balise(n))) return;
      const a = attributs(n);
      const type = a.get("type")?.initializer?.getText().replace(/"/g, "");
      const classes = a.get("className")?.initializer?.getText() ?? "";
      if (type === "hidden" || /(^|[\s"'`])(hidden|sr-only)([\s"'`]|$)/.test(classes)) return;
      if (dansLabel || aUnSpread(n)) return;
      if (a.has("id") || a.has("aria-label") || a.has("aria-labelledby")) return;
      sansNom.push(`${fichier}:${ligne}`);
    });

    expect(sansNom).toEqual([]);
  });
});
