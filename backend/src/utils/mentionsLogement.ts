import { z } from "zod";
import { MONTANT_MAXIMUM } from "./montant";

/**
 * Mentions du logement que le contrat type de bail de résidence principale demande en France (décret n° 2015-587 du 29 mai
 * 2015) : classe du diagnostic de performance énergétique, identifiant fiscal du logement, période de construction,
 * modalité de chauffage et d'eau chaude, et — en zone d'encadrement des loyers — loyer de référence, loyer de référence majoré
 * et montant du dernier loyer acquitté par le précédent locataire.
 *
 * Toutes sont FACULTATIVES : la plateforme les imprime sur le bail quand le gestionnaire les renseigne, et le lui rappelle
 * quand elles manquent, sans jamais bloquer. Elle n'atteste la conformité d'aucun bail. Stockées en JSON dans
 * `contracts.housing_mentions`, comme `deposit_deductions`.
 */
export const CLASSES_DPE = ["A", "B", "C", "D", "E", "F", "G"] as const;

const texte = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum, `Ce champ ne peut pas dépasser ${maximum} caractères`)
    .optional()
    .transform((v) => (v ? v : undefined));

const montant = z.number().finite().nonnegative().max(MONTANT_MAXIMUM, "Le montant est trop élevé").optional();

export const mentionsLogementSchema = z.object({
  dpe: z.enum(CLASSES_DPE).optional(),
  identifiantFiscal: texte(40),
  periodeConstruction: texte(60),
  chauffage: texte(100),
  loyerReference: montant,
  loyerReferenceMajore: montant,
  dernierLoyer: montant,
});

export type MentionsLogement = z.infer<typeof mentionsLogementSchema>;

/** Valeur stockée : le JSON des seules mentions renseignées, ou `null` quand il n'y en a aucune. */
export function serialiserMentions(mentions: Partial<MentionsLogement> | null | undefined): string | null {
  if (!mentions) return null;
  const renseignees = Object.fromEntries(Object.entries(mentions).filter(([, v]) => v !== undefined && v !== null));
  return Object.keys(renseignees).length > 0 ? JSON.stringify(renseignees) : null;
}

/** Relit la valeur stockée ; un JSON absent, illisible ou hors schéma donne `null` plutôt qu'une erreur. */
export function lireMentions(json: string | null | undefined): MentionsLogement | null {
  if (!json) return null;
  try {
    const lu = mentionsLogementSchema.safeParse(JSON.parse(json));
    return lu.success && Object.keys(lu.data).length > 0 ? lu.data : null;
  } catch {
    return null;
  }
}
