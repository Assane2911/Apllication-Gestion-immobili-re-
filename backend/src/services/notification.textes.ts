import type { Langue } from "../utils/langue";

/**
 * Textes de la cloche de notifications, par langue : le serveur les écrit (le centre de notifications est recalculé
 * à la volée, voir notification.controller.ts), dans la langue de l'interface de la personne qui consulte.
 *
 * Le français reprend mot pour mot les textes d'avant, dates numériques comprises (« 05/11/2026 ») ; les autres
 * langues écrivent la date en toutes lettres, pour qu'elle ne soit pas ambiguë (« 11/5/2026 » se lit deux façons).
 */
export interface TextesNotification {
  /** Options de mise en forme d'une date d'échéance (`Intl.DateTimeFormat`). */
  optionsDate: Intl.DateTimeFormatOptions;

  // --- Gestionnaire ---
  messagesDuLocataire(nombre: number, locataire: string): string;
  loyerEnRetard(locataire: string): string;
  /** Plusieurs loyers en retard du même bail, regroupés en une seule ligne. */
  loyersEnRetard(nombre: number, locataire: string): string;
  echeanceDuBien(bien: string, date: string): string;
  /** Le bien, la plus ancienne et la plus récente échéance en retard, et le total restant dû. */
  echeancesDuBien(bien: string, du: string, au: string, total: string): string;
  signalement(titre: string): string;
  demandeInformation(prospect: string): string;
  demandeVisite(prospect: string): string;
  contratSeTermine(jours: number): string;

  // --- Locataire ---
  messagesDuGestionnaire(nombre: number): string;
  consulterMessagerie: string;
  loyerEnRetardLocataire: string;
  loyerBientotDu: string;
  echeance(date: string): string;
  bailSeTermine(jours: number): string;
  contacterGestionnaire: string;
}

/** « 1 day », « 0 days », « 2 days » : en, es et pt ne mettent au singulier que pour un (le français, lui, aussi pour 0). */
const pluriel = (n: number, singulier: string, auPluriel: string) => (n === 1 ? singulier : auPluriel);

export const TEXTES_NOTIFICATION: Record<Langue, TextesNotification> = {
  fr: {
    optionsDate: {},
    messagesDuLocataire: (n, nom) => `${n} nouveau${n > 1 ? "x" : ""} message${n > 1 ? "s" : ""} de ${nom}`,
    loyerEnRetard: (nom) => `Loyer en retard — ${nom}`,
    loyersEnRetard: (n, nom) => `${n} loyers en retard — ${nom}`,
    echeanceDuBien: (bien, date) => `${bien} · échéance du ${date}`,
    echeancesDuBien: (bien, du, au, total) => `${bien} · échéances du ${du} au ${au} · ${total} restant dû`,
    signalement: (titre) => `Signalement : ${titre}`,
    demandeInformation: (nom) => `Demande d'information — ${nom}`,
    demandeVisite: (nom) => `Demande de visite — ${nom}`,
    contratSeTermine: (j) => `Contrat se terminant dans ${j} jour${j > 1 ? "s" : ""}`,
    messagesDuGestionnaire: (n) => `${n} nouveau${n > 1 ? "x" : ""} message${n > 1 ? "s" : ""} de votre gestionnaire`,
    consulterMessagerie: "Consultez votre messagerie",
    loyerEnRetardLocataire: "Loyer en retard",
    loyerBientotDu: "Loyer à régler bientôt",
    echeance: (date) => `Échéance du ${date}`,
    bailSeTermine: (j) => `Votre bail se termine dans ${j} jour${j > 1 ? "s" : ""}`,
    contacterGestionnaire: "Contactez votre gestionnaire pour un renouvellement",
  },
  en: {
    optionsDate: { year: "numeric", month: "long", day: "numeric" },
    messagesDuLocataire: (n, nom) => `${n} new ${pluriel(n, "message", "messages")} from ${nom}`,
    loyerEnRetard: (nom) => `Late rent — ${nom}`,
    loyersEnRetard: (n, nom) => `${n} late rent payments — ${nom}`,
    echeanceDuBien: (bien, date) => `${bien} · due ${date}`,
    echeancesDuBien: (bien, du, au, total) => `${bien} · due from ${du} to ${au} · ${total} outstanding`,
    signalement: (titre) => `Issue: ${titre}`,
    demandeInformation: (nom) => `Information request — ${nom}`,
    demandeVisite: (nom) => `Viewing request — ${nom}`,
    contratSeTermine: (j) => `Lease ending in ${j} ${pluriel(j, "day", "days")}`,
    messagesDuGestionnaire: (n) => `${n} new ${pluriel(n, "message", "messages")} from your property manager`,
    consulterMessagerie: "Check your inbox",
    loyerEnRetardLocataire: "Rent overdue",
    loyerBientotDu: "Rent due soon",
    echeance: (date) => `Due ${date}`,
    bailSeTermine: (j) => `Your lease ends in ${j} ${pluriel(j, "day", "days")}`,
    contacterGestionnaire: "Contact your property manager to renew",
  },
  es: {
    optionsDate: { year: "numeric", month: "long", day: "numeric" },
    messagesDuLocataire: (n, nom) => `${n} ${pluriel(n, "mensaje nuevo", "mensajes nuevos")} de ${nom}`,
    loyerEnRetard: (nom) => `Alquiler atrasado — ${nom}`,
    loyersEnRetard: (n, nom) => `${n} alquileres atrasados — ${nom}`,
    echeanceDuBien: (bien, date) => `${bien} · vence el ${date}`,
    echeancesDuBien: (bien, du, au, total) => `${bien} · vencimientos del ${du} al ${au} · ${total} pendiente`,
    signalement: (titre) => `Incidencia: ${titre}`,
    demandeInformation: (nom) => `Solicitud de información — ${nom}`,
    demandeVisite: (nom) => `Solicitud de visita — ${nom}`,
    contratSeTermine: (j) => `Contrato que termina en ${j} ${pluriel(j, "día", "días")}`,
    messagesDuGestionnaire: (n) => `${n} ${pluriel(n, "mensaje nuevo", "mensajes nuevos")} de tu gestor`,
    consulterMessagerie: "Consulta tu mensajería",
    loyerEnRetardLocataire: "Alquiler atrasado",
    loyerBientotDu: "Alquiler por pagar pronto",
    echeance: (date) => `Vence el ${date}`,
    bailSeTermine: (j) => `Tu contrato termina en ${j} ${pluriel(j, "día", "días")}`,
    contacterGestionnaire: "Contacta con tu gestor para renovar",
  },
  pt: {
    optionsDate: { year: "numeric", month: "long", day: "numeric" },
    messagesDuLocataire: (n, nom) => `${n} ${pluriel(n, "nova mensagem", "novas mensagens")} de ${nom}`,
    loyerEnRetard: (nom) => `Renda em atraso — ${nom}`,
    loyersEnRetard: (n, nom) => `${n} rendas em atraso — ${nom}`,
    echeanceDuBien: (bien, date) => `${bien} · vencimento em ${date}`,
    echeancesDuBien: (bien, du, au, total) => `${bien} · vencimentos de ${du} a ${au} · ${total} em dívida`,
    signalement: (titre) => `Incidente: ${titre}`,
    demandeInformation: (nom) => `Pedido de informações — ${nom}`,
    demandeVisite: (nom) => `Pedido de visita — ${nom}`,
    contratSeTermine: (j) => `Contrato a terminar em ${j} ${pluriel(j, "dia", "dias")}`,
    messagesDuGestionnaire: (n) => `${n} ${pluriel(n, "nova mensagem", "novas mensagens")} do teu gestor`,
    consulterMessagerie: "Consulta as tuas mensagens",
    loyerEnRetardLocataire: "Renda em atraso",
    loyerBientotDu: "Renda a pagar em breve",
    echeance: (date) => `Vencimento em ${date}`,
    bailSeTermine: (j) => `O teu contrato termina em ${j} ${pluriel(j, "dia", "dias")}`,
    contacterGestionnaire: "Contacta o teu gestor para renovar",
  },
};
