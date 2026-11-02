/**
 * Signal « un fil vient d'être lu » : l'ouverture d'un fil (ou l'arrivée d'un message dans le fil ouvert) marque les messages reçus
 * comme lus côté serveur. La pastille du menu, qui compte les messages non lus, doit alors se recompter tout de suite plutôt
 * qu'à son prochain tour de minuteur : sans ce signal, elle resterait allumée une demi-minute sur un fil déjà ouvert.
 */
export const EVENEMENT_FIL_LU = "messagerie:fil-lu";

export function signalerFilLu(): void {
  window.dispatchEvent(new Event(EVENEMENT_FIL_LU));
}

/** « 3 », « 99+ » : au-delà, le chiffre exact n'apporte rien et élargirait la pastille. */
export function libellePastille(nombre: number): string {
  return nombre > 99 ? "99+" : String(nombre);
}
