/**
 * Écriture du nom d'une personne dans les documents et les messages.
 *
 * Le nom était concaténé à la main dans une douzaine d'endroits —
 * `${firstName} ${lastName}` recopié d'un contrôleur à l'autre. Tant qu'il n'y
 * avait rien à ajouter devant, la duplication ne coûtait rien ; le jour où la
 * civilité arrive, elle se paie en oublis. On la rassemble donc ici.
 *
 * Deux écritures, et la distinction est délibérée. Un document officiel — un
 * bail, une quittance, une mise en demeure — s'adresse à quelqu'un : il dit
 * « Monsieur ALIOU THIAM ». Une liste de travail du gestionnaire nomme des
 * gens : elle dit « ALIOU THIAM », parce que « 2 nouveaux messages de Monsieur
 * ALIOU THIAM » se lit mal et n'apporte rien.
 */
export const CIVILITES = ["M", "MME"] as const;
export type Civilite = (typeof CIVILITES)[number];

/**
 * Libellés français : ce sont les documents générés par le serveur — bail,
 * quittance, compte-rendu de gestion — qui les emploient, et ils sont rédigés
 * en français. L'interface, elle, traduit la civilité dans les quatre langues
 * à partir du code stocké.
 */
const LIBELLES: Record<string, string> = {
  M: "Monsieur",
  MME: "Madame",
};

export function estCiviliteConnue(valeur: string): boolean {
  return Object.prototype.hasOwnProperty.call(LIBELLES, valeur);
}

export interface Personne {
  civility?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** « ALIOU THIAM ». Sans civilité : listes, tableaux, notifications internes. */
export function nomComplet(personne: Personne): string {
  return `${personne.firstName ?? ""} ${personne.lastName ?? ""}`.trim();
}

/**
 * « Monsieur ALIOU THIAM », ou le nom seul si aucune civilité n'est
 * renseignée.
 *
 * L'absence n'est pas un défaut à corriger : un propriétaire peut être une
 * société, et une personne peut ne pas vouloir en donner. Le document reste
 * correct sans, ce qui est la condition pour que le champ puisse rester
 * facultatif.
 */
export function nomAvecCivilite(personne: Personne): string {
  const nom = nomComplet(personne);
  const libelle = personne.civility ? LIBELLES[personne.civility] : undefined;
  return libelle && nom ? `${libelle} ${nom}` : nom;
}
