/** Catégories de documents rangés par bien ou par locataire (voir la table stored_documents). */
export const CATEGORIES_DOCUMENT = ["DIAGNOSTIC", "INSURANCE", "IDENTITY", "INCOME", "GUARANTEE", "TAX", "OTHER"] as const;
export type CategorieDocument = (typeof CATEGORIES_DOCUMENT)[number];

/** Au-delà, on est dans l'erreur de manipulation (dépôt en boucle) plutôt que dans l'usage : la borne protège le stockage. */
export const MAX_DOCUMENTS_PAR_RATTACHEMENT = 100;

/**
 * Catégories de pièces personnelles : identité, justificatifs de revenus, garanties. Comme la pièce d'identité du locataire
 * (`/tenants/:id/id-document-url`, réservée à l'exploitation courante), elles ne s'ouvrent pas pour un collaborateur
 * comptable ou en lecture seule : voir `peutOuvrirPieceSensible` (utils/rolesEquipe.ts).
 */
export const CATEGORIES_DOCUMENT_SENSIBLES: readonly CategorieDocument[] = ["IDENTITY", "INCOME", "GUARANTEE"];
