import { type Langue, LANGUE_PAR_DEFAUT } from "./langue";

/**
 * Durée maximale d'un message vocal. Le backend tourne comme fonction Vercel (corps de requête limité à 4,5 Mo) : trois
 * minutes d'audio compressé (Opus ou AAC) pèsent environ un mégaoctet, la marge reste large. Doit rester synchronisée
 * avec DUREE_MAX_MESSAGE_VOCAL_SEC côté frontend (utils/messageVocal.ts).
 */
export const DUREE_MAX_MESSAGE_VOCAL_SEC = 180;
/** Tolérance de quelques secondes : le chronomètre du navigateur et la durée annoncée ne coïncident jamais à la seconde. */
export const TOLERANCE_DUREE_SEC = 5;

const LIBELLES: Record<Langue, string> = {
  fr: "Message vocal",
  en: "Voice message",
  es: "Mensaje de voz",
  pt: "Mensagem de voz",
};

/** « 1:05 » : durée d'un message vocal. */
export function formaterDuree(secondes: number): string {
  const total = Math.max(0, Math.round(secondes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Texte qui tient lieu de contenu dans un email ou un aperçu : « Message vocal (0:42) ». */
export function libelleMessageVocal(langue: Langue = LANGUE_PAR_DEFAUT, secondes: number): string {
  return `${LIBELLES[langue]} (${formaterDuree(secondes)})`;
}

/** Types d'enregistrement produits par les navigateurs : Chrome/Firefox (WebM, Ogg) et Safari (MP4). */
export const TYPES_AUDIO_AUTORISES = new Set(["audio/webm", "audio/mp4", "audio/ogg"]);

/** « audio/webm;codecs=opus » → « audio/webm » ; « audio/x-m4a » → « audio/mp4 ». Vide si ce n'est pas un type connu. */
export function normaliserTypeAudio(declare: string): string {
  const base = declare.split(";")[0].trim().toLowerCase();
  if (base === "audio/x-m4a" || base === "audio/m4a") return "audio/mp4";
  if (base === "video/webm") return "audio/webm";
  return base;
}

/** Type réel d'un enregistrement d'après ses premiers octets, ou `null`. */
export function detecterSignatureAudio(tampon: Buffer): string | null {
  // Matroska / WebM : en-tête EBML.
  if (tampon.length >= 4 && tampon[0] === 0x1a && tampon[1] === 0x45 && tampon[2] === 0xdf && tampon[3] === 0xa3) return "audio/webm";
  // Ogg.
  if (tampon.length >= 4 && tampon.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  // MP4 / M4A : boîte « ftyp » en tête.
  if (tampon.length >= 12 && tampon.toString("ascii", 4, 8) === "ftyp") return "audio/mp4";
  return null;
}
