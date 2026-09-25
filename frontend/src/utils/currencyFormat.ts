/**
 * Formate un total groupé par devise (ex: {EUR: 150, XOF: 50000}) en chaîne
 * lisible ("150 € + 50 000 FCFA").
 *
 * La plateforme gère des gestionnaires réglés dans des devises différentes
 * (EUR/XOF/...) : une simple somme à travers ces devises produirait un
 * nombre sans signification, affiché comme si c'était homogène. Les
 * contrôleurs backend (dashboard, résumé financier...) renvoient donc leurs
 * totaux déjà groupés par devise ; ce helper est le pendant côté affichage,
 * partagé pour rester cohérent partout où un tel total est montré.
 *
 * `devisesDeReference` traite le cas du total VIDE, qui n'a par définition
 * aucune devise à montrer. Il retombait alors sur la devise d'AFFICHAGE du
 * gestionnaire, ce qui donnait des écrans où « Loyers encaissés » disait
 * « 35 000 FCFA » et « Total dépenses » disait « 0 FG » juste à côté : deux
 * monnaies pour trois chiffres qui décrivent la même période et les mêmes
 * biens. En passant les devises des totaux voisins, le zéro s'exprime dans la
 * même langue qu'eux.
 */
export function formatByCurrency(
  byCurrency: Record<string, number> | undefined,
  formatMoney: (amount: number | null | undefined, overrideCurrency?: string | null) => string,
  devisesDeReference: string[] = []
): string {
  const entries = Object.entries(byCurrency ?? {});
  if (entries.length > 0) {
    return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(" + ");
  }

  if (devisesDeReference.length > 0) {
    return devisesDeReference.map((devise) => formatMoney(0, devise)).join(" + ");
  }

  // Aucun voisin auquel s'accorder — un écran entièrement vide : la préférence
  // du gestionnaire reste le meilleur choix disponible.
  return formatMoney(0);
}

/**
 * Les devises présentes dans un ensemble de totaux, sans doublon et dans
 * l'ordre où on les rencontre.
 *
 * Sert à donner aux tuiles d'un même écran un vocabulaire commun : elles
 * décrivent la même période, elles doivent parler des mêmes monnaies, y
 * compris celles dont le montant se trouve être nul.
 */
export function devisesPresentes(...totaux: Array<Record<string, number> | undefined>): string[] {
  const vues = new Set<string>();
  for (const total of totaux) {
    for (const devise of Object.keys(total ?? {})) vues.add(devise);
  }
  return Array.from(vues);
}
