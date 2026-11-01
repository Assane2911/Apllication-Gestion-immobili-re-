import type { Listing } from "../types";

const CLE = "immo.favoris-vitrine";
/** Au-delà, on oublie les plus anciens : une liste de favoris n'est pas un entrepôt. */
const MAXIMUM = 50;

/** Ce qu'on garde d'une annonce pour la réafficher hors ligne de l'API : de quoi dessiner sa carte, rien de plus. */
export type AnnonceFavorite = Pick<
  Listing,
  "id" | "type" | "title" | "price" | "currency" | "pricePeriod" | "surface" | "rooms" | "location" | "country" | "imageUrl" | "featured" | "createdAt"
>;

export function resumeAnnonce(listing: Listing): AnnonceFavorite {
  const { id, type, title, price, currency, pricePeriod, surface, rooms, location, country, imageUrl, featured, createdAt } = listing;
  return { id, type, title, price, currency, pricePeriod, surface, rooms, location, country, imageUrl, featured, createdAt };
}

/** Lit les favoris enregistrés dans ce navigateur. Un contenu illisible ou un stockage indisponible donne une liste vide. */
export function lireFavoris(): AnnonceFavorite[] {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return [];
    const valeur: unknown = JSON.parse(brut);
    if (!Array.isArray(valeur)) return [];
    return valeur.filter((a): a is AnnonceFavorite => typeof a === "object" && a !== null && typeof (a as AnnonceFavorite).id === "string");
  } catch {
    return [];
  }
}

function ecrireFavoris(favoris: AnnonceFavorite[]) {
  try {
    localStorage.setItem(CLE, JSON.stringify(favoris.slice(0, MAXIMUM)));
  } catch {
    // Stockage plein ou indisponible (navigation privée) : les favoris restent pour la session, sans plus.
  }
}

/** Ajoute l'annonce en tête si elle n'y est pas, la retire sinon. Renvoie la nouvelle liste. */
export function basculerFavori(courants: AnnonceFavorite[], annonce: AnnonceFavorite): AnnonceFavorite[] {
  const suivants = courants.some((a) => a.id === annonce.id) ? courants.filter((a) => a.id !== annonce.id) : [annonce, ...courants];
  const gardes = suivants.slice(0, MAXIMUM);
  ecrireFavoris(gardes);
  return gardes;
}
