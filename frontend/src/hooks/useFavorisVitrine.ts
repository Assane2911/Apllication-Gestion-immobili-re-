import { useCallback, useState } from "react";
import { basculerFavori, lireFavoris, type AnnonceFavorite } from "../utils/favorisVitrine";

/** Les annonces mises de côté par le visiteur, mémorisées dans son navigateur (aucun compte, aucune donnée envoyée). */
export function useFavorisVitrine() {
  const [favoris, setFavoris] = useState<AnnonceFavorite[]>(lireFavoris);
  const basculer = useCallback((annonce: AnnonceFavorite) => setFavoris((courants) => basculerFavori(courants, annonce)), []);
  const estFavori = useCallback((id: string) => favoris.some((a) => a.id === id), [favoris]);
  return { favoris, basculer, estFavori };
}
