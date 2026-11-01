/** Minuit (heure locale) du jour de `date`, en millisecondes : sert à comparer des jours civils. */
export function debutDeJour(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** « Aujourd'hui », « hier », sinon « jeudi 30 octobre » (l'année n'apparaît que si elle n'est pas l'année courante). */
export function libelleDuJour(iso: string, langue: string): string {
  const date = new Date(iso);
  const maintenant = new Date();
  const ecart = Math.round((debutDeJour(date) - debutDeJour(maintenant)) / 86_400_000);
  if (ecart === 0 || ecart === -1) {
    const relatif = new Intl.RelativeTimeFormat(langue, { numeric: "auto" }).format(ecart, "day");
    return relatif.charAt(0).toLocaleUpperCase(langue) + relatif.slice(1);
  }
  return date.toLocaleDateString(langue, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== maintenant.getFullYear() ? { year: "numeric" as const } : {}),
  });
}
