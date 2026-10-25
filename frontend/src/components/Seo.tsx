import { SITE_URL } from "../utils/structuredData";

interface SeoProps {
  title: string;
  /** Absente pour une page hors de l'index (`noindex`), qui n'a rien à décrire dans des résultats de recherche. */
  description?: string;
  /**
   * Chemin canonique de la page (« / », « /vitrine »…), complété par l'adresse du site. À poser sur toute page qui
   * peut s'afficher à plusieurs adresses (l'accueil sert `/`, `/landing` et toute adresse inconnue ; la vitrine, ses
   * filtres) : sans lui, un moteur de recherche indexe chaque copie séparément.
   */
  canonical?: string;
  /** Page à ne pas indexer (jeton dans l'adresse, écran de passage). */
  noindex?: boolean;
}

/**
 * Titre d'onglet et meta description propres à la page où ce composant est
 * monté. S'appuie sur le support natif de React 19 pour les métadonnées de
 * document : un <title>/<meta>/<link> rendu n'importe où dans l'arbre est
 * remonté automatiquement dans <head>, et retiré au démontage — pas besoin de
 * react-helmet-async ni de useEffect manuel.
 */
export default function Seo({ title, description, canonical, noindex }: SeoProps) {
  return (
    <>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={`${SITE_URL}${canonical}`} />}
      {noindex && <meta name="robots" content="noindex" />}
    </>
  );
}
