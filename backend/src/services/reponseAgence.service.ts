import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { agencySettings } from "../db/schema";

/**
 * Adresse à laquelle un locataire (ou un garant, un colocataire) répond quand il répond à un e-mail de son agence.
 *
 * Les e-mails partent de l'adresse de la plateforme : sans « Reply-To », la réponse d'un locataire à un rappel de loyer
 * (« je paie vendredi », « je n'ai pas reçu la quittance ») arrivait dans la boîte de la plateforme, que l'agence ne lit
 * pas. C'est donc l'adresse de contact de l'agence (Mon agence → Email) qui sert, quand elle est renseignée. L'adresse de
 * connexion du gestionnaire, elle, n'est JAMAIS donnée : le locataire ne la connaît pas et n'a pas à la connaître.
 */
const FORME_ADRESSE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** Une adresse mémorisée un court instant : une relance en lot écrit à des dizaines de locataires de la même agence. */
const DUREE_MEMOIRE_MS = 60_000;
const memoire = new Map<string, { adresse: string | undefined; jusqua: number }>();

/** Remet la mémoire à zéro (tests, et changement de l'adresse dans les réglages de l'agence). */
export function oublierAdressesDeReponse(): void {
  memoire.clear();
}

/** L'adresse de réponse de cette agence, ou `undefined` si elle n'en a pas renseigné de valide. Ne lève jamais. */
export async function adresseDeReponseAgence(gestionnaireId: string | null | undefined): Promise<string | undefined> {
  if (!gestionnaireId) return undefined;
  const maintenant = Date.now();
  const connue = memoire.get(gestionnaireId);
  if (connue && connue.jusqua > maintenant) return connue.adresse;
  let adresse: string | undefined;
  try {
    const [ligne] = await db.select({ email: agencySettings.email }).from(agencySettings).where(eq(agencySettings.userId, gestionnaireId)).limit(1);
    const brute = ligne?.email?.trim();
    adresse = brute && brute.length <= 254 && FORME_ADRESSE.test(brute) ? brute : undefined;
  } catch {
    // Une adresse de réponse manquante ne doit jamais empêcher l'envoi du message lui-même.
    return undefined;
  }
  memoire.set(gestionnaireId, { adresse, jusqua: maintenant + DUREE_MEMOIRE_MS });
  return adresse;
}
