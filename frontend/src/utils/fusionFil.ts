import type { Message } from "../types";

/**
 * Fusion des messages reçus d'une actualisation dans le fil affiché.
 *
 * - Un message déjà affiché n'est jamais dupliqué (le serveur peut renvoyer, ou l'envoi renvoyer, le même message) ; ses
 *   champs qui évoluent sont mis à jour : l'état « Lu », et le lien signé du vocal quand l'actualisation en apporte un neuf
 *   (un lien expire au bout d'une heure).
 * - Un message nouveau s'ajoute en fin de fil, dans l'ordre reçu.
 * - `luesIds` : mes messages que l'autre partie vient de lire.
 *
 * Quand rien ne change, la MÊME liste est rendue : l'écran ne se redessine pas, et le fil ne défile pas pour rien.
 */
export function fusionnerFil(existants: Message[], recus: Message[], luesIds: string[] = []): Message[] {
  if (recus.length === 0 && luesIds.length === 0) return existants;
  const lues = new Set(luesIds);
  const recusParId = new Map(recus.map((m) => [m.id, m]));
  let change = false;

  const miseAJour = existants.map((m) => {
    const frais = recusParId.get(m.id);
    const devientLu = !m.isRead && (lues.has(m.id) || frais?.isRead === true);
    const nouveauLien = frais?.audioUrl && frais.audioUrl !== m.audioUrl ? frais.audioUrl : null;
    if (!devientLu && !nouveauLien) return m;
    change = true;
    return { ...m, ...(devientLu ? { isRead: true } : {}), ...(nouveauLien ? { audioUrl: nouveauLien } : {}) };
  });

  const presents = new Set(existants.map((m) => m.id));
  const nouveaux = recus.filter((m) => !presents.has(m.id));
  if (nouveaux.length === 0) return change ? miseAJour : existants;
  return [...miseAJour, ...nouveaux];
}

/** Ajoute un message envoyé par soi, sauf s'il est déjà là (une actualisation a pu le rapporter avant la fin de l'envoi). */
export function ajouterSiAbsent(existants: Message[], message: Message): Message[] {
  return existants.some((m) => m.id === message.id) ? existants : [...existants, message];
}
