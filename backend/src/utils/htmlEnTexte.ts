/**
 * Version texte d'un e-mail HTML, pour la partie « texte brut » du message.
 *
 * Un message qui ne contient QUE du HTML est une des marques classiques du courrier indésirable (la règle
 * MIME_HTML_ONLY de SpamAssassin, reprise par la plupart des filtres) : la partie texte fait gagner des points auprès
 * des filtres, et sert aussi aux lecteurs qui n'affichent pas le HTML (montres, aperçus, clients en mode texte).
 *
 * Volontairement simple : les e-mails de l'application sont écrits à la main avec des balises ordinaires. Les liens
 * deviennent « texte (adresse) », les blocs deviennent des lignes, le reste des balises disparaît.
 */
const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", rarr: "→", larr: "←", hellip: "…", mdash: "—", ndash: "–" };

function decoderEntites(texte: string): string {
  return texte
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nom: string) => ENTITES[nom.toLowerCase()] ?? m);
}

export function htmlEnTexte(html: string): string {
  const sansBalisesInutiles = html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const avecLiens = sansBalisesInutiles.replace(/<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, intitule: string) => {
    const nom = intitule.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const adresse = decoderEntites(href);
    if (/^mailto:/i.test(adresse)) return nom || adresse.replace(/^mailto:/i, "");
    return !nom || nom === adresse ? adresse : `${nom} (${adresse})`;
  });
  const lignes = avecLiens
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|section)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "  ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decoderEntites(lignes)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
