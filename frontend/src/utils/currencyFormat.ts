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
 */
export function formatByCurrency(
  byCurrency: Record<string, number> | undefined,
  formatMoney: (amount: number | null | undefined, overrideCurrency?: string | null) => string
): string {
  const entries = Object.entries(byCurrency ?? {});
  if (entries.length === 0) return formatMoney(0);
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(" + ");
}
