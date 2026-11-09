import type { IssueReport } from "../types";

/**
 * Reconstitue la liste complète des photos d'un signalement d'incident :
 * la photo principale (`photoUrl`) suivie des photos additionnelles ajoutées
 * après coup (`additionalPhotos`, un tableau JSON de chemins). Partagé entre
 * la vue gestionnaire et la vue locataire des incidents, qui affichent toutes
 * deux cette même galerie.
 */
export function getAllIssuePhotos(issue: IssueReport): string[] {
  const list = [issue.photoUrl];
  if (issue.additionalPhotos) {
    try {
      const extra = JSON.parse(issue.additionalPhotos);
      if (Array.isArray(extra)) {
        list.push(...extra);
      }
    } catch {}
  }
  return list;
}

/** Photos d'un même incident, la photo principale comprise (même plafond que le serveur : voir issue.controller.ts). */
export const MAX_PHOTOS_PAR_INCIDENT = 10;

/** Vrai tant que l'incident peut recevoir une photo de plus. */
export function peutAjouterUnePhoto(issue: IssueReport): boolean {
  return getAllIssuePhotos(issue).length < MAX_PHOTOS_PAR_INCIDENT;
}
