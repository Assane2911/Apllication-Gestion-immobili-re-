import { useLocation } from "react-router-dom";
import { cheminDansLaLangue, langueDuChemin, versionsDeLaPage } from "../utils/langueUrl";

/**
 * Adresse canonique et versions dans chaque langue de la page affichée, pour <Seo>. La langue est celle de l'ADRESSE (« /en/vitrine »
 * → anglais), pas celle mémorisée dans le navigateur : un moteur de recherche n'a pas de langue mémorisée, et l'adresse sans préfixe
 * est le français.
 */
export function useSeoLangues(chemin: string) {
  const { pathname } = useLocation();
  const langue = langueDuChemin(pathname) ?? "fr";
  return { canonical: cheminDansLaLangue(chemin, langue), alternates: versionsDeLaPage(chemin) };
}

/**
 * Pour les liens d'une page traduite vers une autre (accueil → vitrine) : sur une adresse en « /en », « /es » ou « /pt », le lien
 * reste dans la langue (« /vitrine » → « /en/vitrine ») ; ailleurs, il garde l'adresse d'origine. Une page qui n'existe pas en
 * plusieurs langues (connexion, annonce…) est rendue telle quelle.
 */
export function useCheminPublic(): (chemin: string) => string {
  const { pathname } = useLocation();
  const langue = langueDuChemin(pathname);
  return (chemin: string) => (langue ? cheminDansLaLangue(chemin, langue) : chemin);
}
