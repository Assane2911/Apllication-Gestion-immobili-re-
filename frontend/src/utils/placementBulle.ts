export type Cote = "haut" | "bas" | "droite" | "gauche";

interface Rectangle {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  cote: Cote;
  top: number;
  left: number;
  /** Position de la pointe, en pixels depuis le bord haut (côtés droite/gauche) ou gauche (haut/bas) de la bulle. */
  pointe: number;
}

/** Distance minimale entre la bulle et le bord de la fenêtre. */
export const MARGE_FENETRE = 8;
/** Espace entre la bulle et l'élément décrit (la pointe s'y loge). */
export const ECART = 10;
/** La pointe ne se colle jamais à un coin arrondi de la bulle. */
const MARGE_POINTE = 12;

const oppose: Record<Cote, Cote> = { haut: "bas", bas: "haut", droite: "gauche", gauche: "droite" };

function bornes(valeur: number, min: number, max: number): number {
  // Une bulle plus grande que la fenêtre : on garde son bord de départ visible.
  return max < min ? min : Math.min(Math.max(valeur, min), max);
}

/**
 * Où poser une bulle autour d'un élément sans qu'elle sorte de l'écran.
 *
 * Le côté demandé est gardé tant qu'il y a la place ; sinon la bulle passe de
 * l'autre côté si celui-ci en offre davantage. Sur l'autre axe, elle est
 * recentrée sur l'élément puis ramenée dans la fenêtre — la pointe, elle, reste
 * braquée sur l'élément, pour que la bulle désigne toujours ce qu'elle décrit.
 */
export function placerBulle(
  ancre: Rectangle,
  bulle: { width: number; height: number },
  prefere: Cote,
  fenetre: { width: number; height: number }
): Placement {
  const vertical = prefere === "haut" || prefere === "bas";

  const place = {
    haut: ancre.top - MARGE_FENETRE,
    bas: fenetre.height - ancre.bottom - MARGE_FENETRE,
    gauche: ancre.left - MARGE_FENETRE,
    droite: fenetre.width - ancre.right - MARGE_FENETRE,
  } satisfies Record<Cote, number>;
  const besoin = (vertical ? bulle.height : bulle.width) + ECART;

  let cote = prefere;
  if (place[prefere] < besoin && place[oppose[prefere]] > place[prefere]) cote = oppose[prefere];

  if (vertical) {
    const centre = (ancre.left + ancre.right) / 2;
    const left = bornes(centre - bulle.width / 2, MARGE_FENETRE, fenetre.width - MARGE_FENETRE - bulle.width);
    const top = cote === "haut" ? ancre.top - ECART - bulle.height : ancre.bottom + ECART;
    return { cote, top, left, pointe: bornes(centre - left, MARGE_POINTE, bulle.width - MARGE_POINTE) };
  }

  const centre = (ancre.top + ancre.bottom) / 2;
  const top = bornes(centre - bulle.height / 2, MARGE_FENETRE, fenetre.height - MARGE_FENETRE - bulle.height);
  const left = cote === "droite" ? ancre.right + ECART : ancre.left - ECART - bulle.width;
  return { cote, top, left, pointe: bornes(centre - top, MARGE_POINTE, bulle.height - MARGE_POINTE) };
}
