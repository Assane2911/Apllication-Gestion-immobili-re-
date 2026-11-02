/**
 * Messages vocaux : durée, format d'enregistrement et lecture de l'erreur de micro. Les constantes doivent rester
 * synchronisées avec le serveur (backend/src/utils/messageVocal.ts).
 */

/** Trois minutes : le serveur est une fonction Vercel dont le corps de requête est limité à 4,5 Mo. */
export const DUREE_MAX_MESSAGE_VOCAL_SEC = 180;
/** En dessous, l'enregistrement est écarté : un appui involontaire ne doit rien envoyer. */
export const DUREE_MIN_MESSAGE_VOCAL_SEC = 1;

/** Vitesses de lecture proposées, comme dans les messageries vocales courantes. */
export const VITESSES_LECTURE = [1, 1.5, 2] as const;

/** « 1:05 » : durée d'un enregistrement. */
export function formaterDuree(secondes: number): string {
  const total = Math.max(0, Math.round(secondes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Formats d'enregistrement dans l'ordre de préférence : Opus en WebM (Chrome, Edge, Firefox récent), MP4/AAC (Safari et
 * les WebView iOS), Ogg (Firefox). Le serveur accepte ces trois conteneurs.
 */
export const TYPES_ENREGISTREMENT = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"] as const;

/** Premier format que le navigateur sait enregistrer, ou `undefined` pour le laisser choisir (sans garantie que le serveur l'accepte). */
export function choisirTypeEnregistrement(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return TYPES_ENREGISTREMENT.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Le navigateur (ou la WebView) sait-il enregistrer ? Faux sur un contexte non sécurisé (hors HTTPS) ou un très vieux navigateur. */
export function enregistrementPossible(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}

export type ErreurMicro = "denied" | "notFound" | "unsupported" | "busy" | "unknown";

/** Classe l'échec d'ouverture du micro, pour afficher un message qui dit quoi faire. */
export function classerErreurMicro(erreur: unknown): ErreurMicro {
  const nom = erreur instanceof DOMException || (erreur && typeof erreur === "object" && "name" in erreur) ? String((erreur as { name: unknown }).name) : "";
  if (nom === "NotAllowedError" || nom === "SecurityError" || nom === "PermissionDeniedError") return "denied";
  if (nom === "NotFoundError" || nom === "DevicesNotFoundError" || nom === "OverconstrainedError") return "notFound";
  if (nom === "NotReadableError" || nom === "AbortError" || nom === "TrackStartError") return "busy";
  if (nom === "NotSupportedError" || nom === "TypeError") return "unsupported";
  return "unknown";
}

/** Extension de fichier d'après le type d'enregistrement (le nom n'est qu'indicatif : le serveur range par type). */
export function extensionEnregistrement(type: string): string {
  if (type.startsWith("audio/mp4")) return "m4a";
  if (type.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

/** Un message vocal du fil (reçu du serveur) : il porte une durée, même quand son fichier a été effacé. */
export const estVocal = (m: { audioDurationSec?: number | null; isVoice?: boolean }): boolean => m.audioDurationSec != null || m.isVoice === true;
