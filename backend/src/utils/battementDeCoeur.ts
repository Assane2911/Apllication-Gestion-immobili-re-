import { fetchAvecDelai } from "./fetchAvecDelai";

/** Une sonde de battement de cœur répond en une fraction de seconde : au-delà, on renonce plutôt que de retenir la tâche. */
const DELAI_BATTEMENT_MS = 5_000;

/**
 * Signale à une sonde externe (adresse `CRON_HEARTBEAT_URL`, par exemple un « Heartbeat » UptimeRobot) que la tâche
 * quotidienne vient de s'exécuter jusqu'au bout sans échec. La sonde alerte quand ce signal manque : cron Vercel
 * désactivé, secret absent, déploiement cassé, étape en échec. Une sonde d'accueil ne voit pas ce cas, elle ne vérifie
 * que ce qui répond.
 *
 * Sans adresse configurée, ne fait rien. Ne lève JAMAIS d'erreur : le signal ne doit pas faire échouer la tâche qu'il
 * surveille. L'adresse porte un jeton, donc elle n'est citée dans aucun message.
 *
 * Lue à chaque appel (et non figée au chargement) pour que la configuration se change sans redémarrage de la logique.
 */
export async function signalerBattementDeCoeur(): Promise<void> {
  const adresse = (process.env.CRON_HEARTBEAT_URL ?? "").trim();
  if (!adresse) return;
  if (!adresse.startsWith("https://")) {
    console.warn("[cron] CRON_HEARTBEAT_URL ignorée : l'adresse doit commencer par https://.");
    return;
  }
  try {
    const reponse = await fetchAvecDelai(adresse, { method: "GET" }, DELAI_BATTEMENT_MS);
    if (!reponse.ok) console.warn(`[cron] Battement de cœur refusé par la sonde (HTTP ${reponse.status}).`);
  } catch (err) {
    // Le message d'une erreur réseau peut citer l'adresse : on n'en garde que la nature (nom, code), jamais le texte.
    const nature = err instanceof Error ? [err.name, (err as { cause?: { code?: string } }).cause?.code].filter(Boolean).join(" ") : "erreur";
    console.warn(`[cron] Battement de cœur non envoyé (${nature}).`);
  }
}
