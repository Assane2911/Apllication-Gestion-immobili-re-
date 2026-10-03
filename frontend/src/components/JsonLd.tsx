import { jsonLdScript } from "../utils/structuredData";

interface JsonLdProps {
  data: unknown;
}

/**
 * Bloc de données structurées schema.org. Contrairement aux balises Open
 * Graph (priorité 3 du plan SEO), Googlebot exécute le JavaScript et verra
 * donc bien ce script rendu dynamiquement par React — ce n'est pas le cas
 * des robots de partage social (Facebook, LinkedIn...), pour qui ce bloc
 * n'a aucune utilité.
 */
export default function JsonLd({ data }: JsonLdProps) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
