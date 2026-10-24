/**
 * Nom d'une devise dans la langue de l'interface (« US Dollar », « Dólar americano », « dollar des États-Unis »…),
 * tiré du navigateur (Intl.DisplayNames) plutôt que d'une liste écrite en français : le sélecteur de devise
 * affichait « Dollar US », « Livre Sterling » ou « Franc Guinéen » à un utilisateur anglais, portugais ou espagnol.
 *
 * `repli` : le nom écrit dans la configuration, si le navigateur ne sait pas traduire (très anciens appareils) ou
 * ne connaît pas cette devise.
 */
export function nomDevise(code: string, langue: string, repli: string): string {
  try {
    const nom = new Intl.DisplayNames([langue], { type: "currency" }).of(code);
    // Une devise inconnue d'Intl revient telle quelle (« XYZ »), et un navigateur sans données renvoie le code.
    if (!nom || nom.toUpperCase() === code.toUpperCase()) return repli;
    return nom.charAt(0).toLocaleUpperCase(langue) + nom.slice(1);
  } catch {
    return repli;
  }
}
