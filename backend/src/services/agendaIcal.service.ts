import { formaterMontant } from "../utils/montant";
import { LANGUE_PAR_DEFAUT, type Langue } from "../utils/langue";
import type { EvenementAgenda } from "./agenda.service";
import { TEXTES_ICAL } from "./agendaIcal.textes";

/**
 * Calendrier iCal (RFC 5545) des échéances de l'agenda : ce que Google Agenda, Outlook ou le calendrier du téléphone
 * lisent quand on s'abonne au lien. Fonction pure : elle met en forme des échéances déjà chargées, sans accès base.
 *
 * Une échéance est un JOUR, pas un instant : chaque événement dure la journée entière (DTSTART;VALUE=DATE), sans heure ni
 * fuseau, donc sans décalage d'un jour selon le pays du calendrier. Les dates de l'agenda sont des jours civils à minuit UTC.
 *
 * Tout texte saisi (nom du bien, du locataire, intitulé d'un document…) est échappé : une virgule, un point-virgule, une
 * barre oblique inverse ou un saut de ligne ne doit ni casser le fichier ni y glisser une propriété de son choix.
 */

const CRLF = "\r\n";

/** Texte iCal : sans caractères de contrôle (un saut de ligne glissé dans un nom y créerait une nouvelle propriété), échappé. */
export function echapperTexte(valeur: string): string {
  return (
    valeur
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .trim()
  );
}

/** Une ligne de contenu ne dépasse pas 75 octets : au-delà, elle est repliée (CRLF + espace), sans couper un caractère. */
export function replier(ligne: string): string {
  const octets = (c: string) => Buffer.byteLength(c, "utf8");
  if (octets(ligne) <= 75) return ligne;
  const morceaux: string[] = [];
  let courant = "";
  let taille = 0;
  // Après le premier morceau, la ligne commence par une espace : il reste 74 octets utiles.
  let limite = 75;
  for (const caractere of ligne) {
    const t = octets(caractere);
    if (taille + t > limite) {
      morceaux.push(courant);
      courant = "";
      taille = 0;
      limite = 74;
    }
    courant += caractere;
    taille += t;
  }
  morceaux.push(courant);
  return morceaux.join(`${CRLF} `);
}

const deuxChiffres = (n: number) => String(n).padStart(2, "0");
/** « 20261111 » : le jour civil (UTC) d'une date. */
function jourIcal(date: Date): string {
  return `${date.getUTCFullYear()}${deuxChiffres(date.getUTCMonth() + 1)}${deuxChiffres(date.getUTCDate())}`;
}
/** « 20261111T180000Z » */
function horodatageIcal(date: Date): string {
  return `${jourIcal(date)}T${deuxChiffres(date.getUTCHours())}${deuxChiffres(date.getUTCMinutes())}${deuxChiffres(date.getUTCSeconds())}Z`;
}
const lendemain = (date: Date) => new Date(date.getTime() + 24 * 60 * 60 * 1000);

export interface OptionsIcal {
  langue?: Langue;
  /** Instant de génération (DTSTAMP) : paramétrable pour des tests déterministes. */
  maintenant?: Date;
}

export function genererIcs(evenements: readonly EvenementAgenda[], options: OptionsIcal = {}): string {
  const langue = options.langue ?? LANGUE_PAR_DEFAUT;
  const maintenant = options.maintenant ?? new Date();
  const t = TEXTES_ICAL[langue];
  const horodatage = horodatageIcal(maintenant);

  const lignes: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ImmoPlatform Pro//Agenda//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${echapperTexte(t.calendrier)}`,
    `X-WR-CALDESC:${echapperTexte(t.descriptionCalendrier)}`,
    // Rythme d'actualisation suggéré aux calendriers (Google en fait ce qu'il veut, souvent une fois par jour).
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];

  for (const e of evenements) {
    const titre = [e.propertyTitle, e.tenantName].filter(Boolean).join(" — ");
    const resume = `${e.enRetard ? `[${t.enRetard}] ` : ""}${t.types[e.type]}${titre ? ` — ${titre}` : ""}`;

    const details: string[] = [];
    if (e.enRetard) details.push(t.enRetard);
    if (e.type === "RENT_DUE" && e.amount !== null) details.push(t.loyer(formaterMontant(e.amount, e.currency, langue)));
    if (e.type === "RENT_REVISION" && e.amount !== null) details.push(t.nouveauLoyer(formaterMontant(e.amount, e.currency, langue)));
    if (e.type === "INSURANCE_EXPIRY" && e.label) details.push(t.assureur(e.label));
    if (e.type === "DOCUMENT_EXPIRY" && e.label) details.push(t.document(e.label));
    if (e.type === "EXIT" && e.label) details.push(t.motif(e.label));

    lignes.push(
      "BEGIN:VEVENT",
      // Stable d'un abonnement à l'autre : le calendrier met à jour l'événement au lieu d'en créer un doublon.
      `UID:${echapperTexte(e.id)}@immoplatform.agenda`,
      `DTSTAMP:${horodatage}`,
      `DTSTART;VALUE=DATE:${jourIcal(e.date)}`,
      `DTEND;VALUE=DATE:${jourIcal(lendemain(e.date))}`,
      `SUMMARY:${echapperTexte(resume)}`,
      ...(details.length > 0 ? [`DESCRIPTION:${echapperTexte(details.join(" · "))}`] : []),
      `CATEGORIES:${echapperTexte(t.types[e.type])}`,
      // Disponible : une échéance ne doit pas marquer la personne comme occupée.
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }

  lignes.push("END:VCALENDAR");
  return lignes.map(replier).join(CRLF) + CRLF;
}
