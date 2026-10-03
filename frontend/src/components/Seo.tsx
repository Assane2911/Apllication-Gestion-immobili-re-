interface SeoProps {
  title: string;
  description: string;
}

/**
 * Titre d'onglet et meta description propres à la page où ce composant est
 * monté. S'appuie sur le support natif de React 19 pour les métadonnées de
 * document : un <title>/<meta> rendu n'importe où dans l'arbre est remonté
 * automatiquement dans <head>, et retiré au démontage — pas besoin de
 * react-helmet-async ni de useEffect manuel.
 */
export default function Seo({ title, description }: SeoProps) {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
    </>
  );
}
