import { describe, expect, it } from "vitest";
import { CURRENCIES } from "../context/currency";
import { countryLabel, SUPPORTED_COUNTRY_CODES } from "../utils/countries";
import { PAYS_TELEPHONE } from "../utils/telephone";
import { CODES_PAYS, DEVISES_DES_PAYS, DEVISES_HORS_TABLE, PAYS } from "./pays";

/**
 * Le garde-fou de la table des pays.
 *
 * Un rangement ponctuel se défait au premier ajout distrait : on ajoute un
 * pays et on oublie sa devise, ou l'inverse. Ces tests échouent alors au lieu
 * de laisser la plateforme proposer un pays qu'elle ne sait pas facturer, ou
 * une devise qui ne correspond à personne.
 *
 * Ils décrivent donc une règle de conception, pas un comportement d'écran :
 * un pays se déclare une fois, entièrement, et tout ce qui en dérive doit
 * suivre.
 */
describe("Cohérence de la table des pays", () => {
  it("décrit chaque pays entièrement : code, indicatif, exemple, devise", () => {
    for (const pays of PAYS) {
      expect(pays.code, `code manquant dans ${JSON.stringify(pays)}`).toMatch(/^[A-Z]{2}$/);
      expect(pays.indicatif, `indicatif de ${pays.code}`).toMatch(/^[1-9]\d{0,3}$/);
      expect(pays.exempleTelephone.replace(/\D/g, "").length, `exemple de ${pays.code}`).toBeGreaterThanOrEqual(6);
      expect(pays.devise, `devise de ${pays.code}`).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("ne déclare jamais deux fois le même pays", () => {
    // Un doublon passerait inaperçu à l'œil — vingt lignes se relisent mal —
    // et produirait deux entrées identiques dans chaque sélecteur.
    expect(new Set(CODES_PAYS).size).toBe(CODES_PAYS.length);
  });

  it("n'utilise que des codes pays que le navigateur sait nommer", () => {
    // `countryLabel` délègue la traduction à Intl.DisplayNames : un code
    // inventé ou périmé ne planterait pas, il s'afficherait brut — « XK » au
    // milieu de noms de pays. Le test le voit, l'utilisateur non.
    for (const code of CODES_PAYS) {
      expect(countryLabel(code, "fr"), `code inconnu d'Intl.DisplayNames : ${code}`).not.toBe(code);
    }
  });

  it("n'annonce un préfixe national que là où il en existe un", () => {
    for (const pays of PAYS) {
      if (pays.prefixeNational !== null) {
        expect(pays.prefixeNational, `préfixe de ${pays.code}`).toMatch(/^0$/);
      }
    }
  });
});

describe("Cohérence entre les pays et les devises", () => {
  it("donne une configuration d'affichage à la devise de chaque pays", () => {
    // Le manque exact que cette table est venue corriger : la Guinée, la
    // Mauritanie et la RDC étaient proposées à l'annonce sans que leur monnaie
    // existe, donc sans qu'on puisse y fixer un loyer.
    for (const devise of DEVISES_DES_PAYS) {
      expect(CURRENCIES[devise], `devise sans configuration d'affichage : ${devise}`).toBeDefined();
    }
  });

  it("n'expose aucune devise orpheline qui ne soit assumée par écrit", () => {
    // USD, GBP et STN ne correspondent à aucun pays de la table. Les garder se
    // défend ; les garder sans dire pourquoi, non. Une orpheline non déclarée
    // fait échouer ce test, de sorte qu'un ajout distrait se voit et qu'un
    // ajout réfléchi coûte une ligne d'explication.
    const orphelines = Object.keys(CURRENCIES).filter((code) => !DEVISES_DES_PAYS.includes(code));

    for (const code of orphelines) {
      expect(DEVISES_HORS_TABLE[code], `devise orpheline non justifiée : ${code}`).toBeTruthy();
    }
  });

  it("ne justifie pas une devise qui n'existe plus dans la liste d'affichage", () => {
    // Contre-épreuve du test précédent : une justification laissée derrière
    // une devise supprimée décrirait une décision qui n'a plus d'objet.
    for (const code of Object.keys(DEVISES_HORS_TABLE)) {
      expect(CURRENCIES[code], `justification sans devise : ${code}`).toBeDefined();
    }
  });
});

describe("Les anciennes listes dérivent bien de la table", () => {
  it("expose les mêmes pays aux annonces et au champ téléphone", () => {
    // Le cœur du sujet. Ces deux listes étaient écrites séparément ; elles ne
    // sont plus que deux vues de la même table, et ce test le vérifie plutôt
    // que de l'espérer.
    expect([...SUPPORTED_COUNTRY_CODES]).toEqual(CODES_PAYS);
    expect(PAYS_TELEPHONE.map((p) => p.code)).toEqual(CODES_PAYS);
  });

  it("garde le Sénégal en tête, marché principal de la plateforme", () => {
    expect(CODES_PAYS[0]).toBe("SN");
  });
});
