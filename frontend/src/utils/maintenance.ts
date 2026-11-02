/**
 * Maintenance planifiée, côté application : l'état annoncé par le serveur (voir backend/src/services/maintenance.service.ts) et son
 * interprétation. L'état vit dans un petit magasin hors de React : il est alimenté à la fois par l'interrogation régulière de
 * `/maintenance` et par l'intercepteur de l'API (une réponse 503 « MAINTENANCE » à n'importe quel appel), qui n'est pas un composant.
 */
export interface EtatMaintenance {
  /** Dates ISO. */
  debut: string;
  fin: string;
  message: string | null;
}

/** Une maintenance à venir n'est annoncée qu'à l'approche de son début : une opération prévue dans huit jours n'a rien à faire en bandeau. */
export const ANNONCE_AVANT_MS = 24 * 60 * 60 * 1000;

const ms = (iso: string) => new Date(iso).getTime();

/** La fenêtre est en cours (début inclus, fin exclue) : calculé sur les dates, pour basculer à la seconde sans attendre le serveur. */
export function enCours(etat: EtatMaintenance | null, maintenant: number = Date.now()): boolean {
  return etat !== null && ms(etat.debut) <= maintenant && maintenant < ms(etat.fin);
}

/** À annoncer : pas encore commencée, mais dans les prochaines 24 heures. */
export function aAnnoncer(etat: EtatMaintenance | null, maintenant: number = Date.now()): boolean {
  return etat !== null && ms(etat.debut) > maintenant && ms(etat.debut) - maintenant <= ANNONCE_AVANT_MS;
}

/** Minutes à attendre avant la fin, arrondies au-dessus (0 quand la fin est passée). */
export function minutesRestantes(etat: EtatMaintenance, maintenant: number = Date.now()): number {
  return Math.max(0, Math.ceil((ms(etat.fin) - maintenant) / 60_000));
}

/** Lit un état valide dans une réponse du serveur ; tout ce qui n'a pas la bonne forme est écarté (jamais une fenêtre à moitié lue). */
export function lireEtat(brut: unknown): EtatMaintenance | null {
  if (!brut || typeof brut !== "object") return null;
  const { debut, fin, message } = brut as { debut?: unknown; fin?: unknown; message?: unknown };
  if (typeof debut !== "string" || typeof fin !== "string") return null;
  if (Number.isNaN(ms(debut)) || Number.isNaN(ms(fin)) || ms(fin) <= ms(debut)) return null;
  return { debut, fin, message: typeof message === "string" && message.trim() !== "" ? message : null };
}

/** L'état annoncé par une réponse 503 « MAINTENANCE » (ses dates sont dans `params`). */
export function lireEtatDepuisErreur(corps: unknown): EtatMaintenance | null {
  if (!corps || typeof corps !== "object" || (corps as { code?: unknown }).code !== "MAINTENANCE") return null;
  return lireEtat((corps as { params?: unknown }).params);
}

// ───────────────────────────── Magasin ─────────────────────────────

let courant: EtatMaintenance | null = null;
const ecouteurs = new Set<() => void>();

export const lireEtatCourant = (): EtatMaintenance | null => courant;

export function definirEtat(etat: EtatMaintenance | null): void {
  const identique = etat === courant || (etat !== null && courant !== null && etat.debut === courant.debut && etat.fin === courant.fin && etat.message === courant.message);
  if (identique) return;
  courant = etat;
  ecouteurs.forEach((ecouteur) => ecouteur());
}

export function sAbonner(ecouteur: () => void): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

/** Remet le magasin à zéro (tests). */
export function reinitialiserEtat(): void {
  courant = null;
  ecouteurs.clear();
}

// ───────────────────────────── Saisie de l'administrateur ─────────────────────────────

/** Durée maximale d'une fenêtre : la même que celle du serveur (backend/src/services/maintenance.service.ts). */
export const DUREE_MAX_MAINTENANCE_MS = 24 * 60 * 60 * 1000;

/** Date → valeur d'un champ « datetime-local » (heure LOCALE de l'administrateur, sans fuseau). */
export function versChampLocal(date: string | Date): string {
  const d = new Date(date);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

export type ProblemeDeFenetre = "incomplete" | "order" | "past" | "tooLong" | null;

/** Contrôle de la saisie, avec les mêmes règles que le serveur (qui reste seul juge). */
export function problemeDeFenetre(debut: string, fin: string, maintenant: number = Date.now()): ProblemeDeFenetre {
  if (!debut || !fin) return "incomplete";
  const d = new Date(debut).getTime();
  const f = new Date(fin).getTime();
  if (Number.isNaN(d) || Number.isNaN(f)) return "incomplete";
  if (f <= d) return "order";
  if (f <= maintenant) return "past";
  if (f - d > DUREE_MAX_MAINTENANCE_MS) return "tooLong";
  return null;
}
