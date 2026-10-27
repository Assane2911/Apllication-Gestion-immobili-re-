/**
 * Les pays couverts par la plateforme — source unique : la France et les huit pays de l'UEMOA.
 *
 * Le périmètre est volontairement restreint (le choix du pays à l'inscription fixe ensuite les règles de location
 * applicables à l'agence, pays par pays). Les autres pays d'Afrique et d'Europe en ont été retirés ; en ajouter un,
 * c'est d'abord disposer de ses règles de location, pas seulement d'un indicatif téléphonique.
 *
 * Contexte historique :
 *
 * Trois listes indépendantes décrivaient le même marché : les codes pays des
 * annonces et de la vitrine, les indicatifs téléphoniques, et les devises.
 * Rien ne les obligeait à s'accorder, et elles ne s'accordaient déjà plus : la
 * Guinée, la Mauritanie et la RDC pouvaient recevoir une annonce mais pas un
 * loyer dans leur monnaie, tandis que trois devises n'avaient aucun pays
 * derrière elles.
 *
 * Un pays est désormais décrit une fois, avec tout ce qui le concerne. Les
 * anciennes listes en dérivent (voir utils/countries.ts, utils/telephone.ts)
 * et ne peuvent donc plus diverger par construction. Ce qu'un test seul ne
 * garantirait pas : il constate une divergence, il ne l'empêche pas.
 *
 * Ajouter un pays, c'est ajouter UNE ligne ici — et si sa monnaie est
 * nouvelle, lui donner sa configuration d'affichage dans context/currency.ts,
 * ce que le test de cohérence rappellera.
 */
export interface Pays {
  /** ISO 3166-1 alpha-2. Le libellé affiché vient de `countryLabel`, donc traduit. */
  code: string;
  /** Indicatif téléphonique international, sans le « + ». */
  indicatif: string;
  /**
   * Chiffre de mise en route composé à l'intérieur du pays et qui DISPARAÎT au
   * format international : le « 0 » de « 06 12 34 56 78 » devenant
   * « +33 6 12 34 56 78 ». Renseigné uniquement là où c'est certain — ailleurs
   * `null`, et rien n'est retiré. En Côte d'Ivoire ou au Bénin le zéro de tête
   * fait partie du numéro depuis le passage à dix chiffres : l'enlever
   * appellerait quelqu'un d'autre.
   */
  prefixeNational: string | null;
  /** Numéro local plausible, écrit comme on l'écrit sur place. Sert de repère de saisie. */
  exempleTelephone: string;
  /** ISO 4217. Plusieurs pays partagent la même — huit sont en XOF ici. */
  devise: string;
}

export const PAYS = [
  { code: "SN", indicatif: "221", prefixeNational: null, exempleTelephone: "77 123 45 67", devise: "XOF" },
  { code: "CI", indicatif: "225", prefixeNational: null, exempleTelephone: "07 01 23 45 67", devise: "XOF" },
  { code: "ML", indicatif: "223", prefixeNational: null, exempleTelephone: "70 12 34 56", devise: "XOF" },
  { code: "BF", indicatif: "226", prefixeNational: null, exempleTelephone: "70 12 34 56", devise: "XOF" },
  { code: "BJ", indicatif: "229", prefixeNational: null, exempleTelephone: "01 97 12 34 56", devise: "XOF" },
  { code: "TG", indicatif: "228", prefixeNational: null, exempleTelephone: "90 12 34 56", devise: "XOF" },
  { code: "NE", indicatif: "227", prefixeNational: null, exempleTelephone: "90 12 34 56", devise: "XOF" },
  { code: "GW", indicatif: "245", prefixeNational: null, exempleTelephone: "955 123 456", devise: "XOF" },
  { code: "FR", indicatif: "33", prefixeNational: "0", exempleTelephone: "06 12 34 56 78", devise: "EUR" },
] as const satisfies readonly Pays[];

export type CodePays = (typeof PAYS)[number]["code"];

/** Codes pays, dans l'ordre de la table : marché principal en tête. */
export const CODES_PAYS: CodePays[] = PAYS.map((p) => p.code);

/** Devises effectivement utilisées par au moins un pays de la table. */
export const DEVISES_DES_PAYS: string[] = Array.from(new Set(PAYS.map((p) => p.devise)));

/**
 * Devises proposées sans qu'aucun pays de la table ne les emploie.
 *
 * Elles ne sont pas des oublis, et c'est pourquoi la raison est écrite ici
 * plutôt que sous-entendue : le test de cohérence refuse toute devise
 * orpheline qui ne figure pas dans cette liste, de sorte qu'un ajout distrait
 * échoue, tandis qu'un ajout réfléchi coûte une ligne d'explication.
 */
export const DEVISES_HORS_TABLE: Record<string, string> = {};

/** Le pays d'un code, ou `undefined` — utile aux dérivations et aux tests. */
export function paysParCode(code: string): Pays | undefined {
  return PAYS.find((p) => p.code === code);
}
