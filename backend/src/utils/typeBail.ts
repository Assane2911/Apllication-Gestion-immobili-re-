/**
 * Types de bail. Le type adapte le TITRE et le vocabulaire du document remis au
 * locataire ; il ne change AUCUNE clause juridique : le droit applicable est
 * saisi par le gestionnaire (contracts.applicableLaw), la plateforme n'affirmant
 * pas la conformité d'un bail à une législation qu'elle ne connaît pas.
 */
export const TYPES_BAIL = ["HABITATION", "MEUBLE", "COMMERCIAL", "PROFESSIONNEL"] as const;
export type TypeBail = (typeof TYPES_BAIL)[number];

export const TYPE_BAIL_PAR_DEFAUT: TypeBail = "HABITATION";

const TITRES: Record<TypeBail, string> = {
  HABITATION: "CONTRAT DE BAIL D'HABITATION",
  MEUBLE: "CONTRAT DE BAIL D'HABITATION MEUBLÉE",
  COMMERCIAL: "CONTRAT DE BAIL COMMERCIAL",
  PROFESSIONNEL: "CONTRAT DE BAIL PROFESSIONNEL",
};

/** Titre du bail ; un type inconnu (donnée ancienne ou corrompue) retombe sur le titre d'habitation. */
export function titreDuBail(type: string | null | undefined): string {
  return TITRES[(type as TypeBail) ?? TYPE_BAIL_PAR_DEFAUT] ?? TITRES[TYPE_BAIL_PAR_DEFAUT];
}

/** « Surface habitable » pour un logement, « Surface » pour un local commercial ou professionnel. */
export function libelleSurface(type: string | null | undefined): string {
  return type === "COMMERCIAL" || type === "PROFESSIONNEL" ? "Surface" : "Surface habitable";
}
