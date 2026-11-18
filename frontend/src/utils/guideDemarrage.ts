import { api } from "../api/client";

export const CLE_MASQUE_DEMARRAGE = "immoplatform.demarrage.masque";

/** Le gestionnaire a-t-il masqué le guide ? Lu aussi par la page, pour ne pas demander les réglages d'un guide qu'on ne montrera pas. */
export function lireMasque(): boolean {
  try {
    return localStorage.getItem(CLE_MASQUE_DEMARRAGE) === "1";
  } catch {
    return false;
  }
}

/**
 * `true` quand l'agence a saisi ses identifiants légaux, `false` sinon ; `null` quand les réglages sont illisibles (l'étape
 * est alors omise du guide). Ne rejette jamais : une lecture en échec ne doit pas retenir l'affichage de la page.
 */
export async function lireIdentifiantsSaisis(): Promise<boolean | null> {
  try {
    const res = await api.get<{ siretOrId?: string | null }>("/agency");
    return res?.data ? Boolean(res.data.siretOrId?.trim()) : null;
  } catch {
    return null;
  }
}
