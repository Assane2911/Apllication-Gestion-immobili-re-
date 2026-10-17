/**
 * Modèle de clause d'engagement de caution (garant), à insérer dans les
 * « Clauses particulières » d'un bail. C'est un MODÈLE, pas un texte validé :
 * les passages entre crochets sont à compléter ou à choisir, et le texte doit
 * être relu par un juriste du pays concerné (nature de l'engagement, durée et
 * mention manuscrite attendues varient). Le bail est imprimé en français : le
 * modèle l'est aussi, quelle que soit la langue de l'interface.
 */
const TITRE = "Engagement de caution";

export const CLAUSE_CAUTION = `${TITRE}

1. Objet. Le Garant, [nom, prénom, adresse], se porte caution de [nom du locataire] envers le Bailleur, pour le paiement des loyers, des charges et des accessoires dus au titre du présent bail.

2. Montant maximal. L'engagement du Garant est limité à la somme de [montant en chiffres] ([montant en lettres]), tous accessoires compris.

3. Durée. [Option A : Le présent engagement vaut pour la durée initiale du bail, du [date de début] au [date de fin]. / Option B : Il vaut pour la durée initiale du bail et ses renouvellements.]

4. Nature. [Option A : caution simple : le Garant n'est tenu qu'après que le Bailleur a d'abord poursuivi le locataire. / Option B : caution solidaire : le Garant renonce à exiger que le Bailleur poursuive d'abord le locataire.]

5. Information du Garant. Le Bailleur ou son mandataire informe le Garant de tout loyer resté impayé après relance, à l'adresse email indiquée ci-dessous, et lui adresse copie de toute mise en demeure notifiée au locataire. Email du Garant : [email].

6. Mention manuscrite. Le Garant reproduit à la main, avant sa signature : « Lu et approuvé, bon pour caution à hauteur de [montant en lettres] ».`;

/** Ajoute la clause à la suite du texte existant, une seule fois. */
export function insererClause(existant: string, clause: string): string {
  if (existant.includes(clause)) return existant;
  const base = existant.trimEnd();
  return base ? `${base}\n\n${clause}` : clause;
}

/** Vrai tant que la clause de caution est présente avec des passages entre crochets non remplis. */
export function clauseCautionIncomplete(clauses: string): boolean {
  return clauses.includes(TITRE) && /\[[^\]]*\]/.test(clauses.slice(clauses.indexOf(TITRE)));
}
