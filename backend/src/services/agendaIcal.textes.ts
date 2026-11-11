import type { Langue } from "../utils/langue";
import type { TypeEvenement } from "./agenda.service";

/**
 * Textes du calendrier de l'agenda (flux iCal), dans la langue du gestionnaire : ils s'affichent dans Google Agenda,
 * Outlook ou le calendrier du téléphone, hors de l'application. Les noms propres (bien, locataire, assureur) ne sont pas
 * traduits ; seuls les intitulés de type d'échéance et les mentions le sont.
 */
export interface TextesIcal {
  calendrier: string;
  descriptionCalendrier: string;
  types: Record<TypeEvenement, string>;
  enRetard: string;
  loyer: (montant: string) => string;
  nouveauLoyer: (montant: string) => string;
  assureur: (nom: string) => string;
  document: (titre: string) => string;
  motif: (texte: string) => string;
}

export const TEXTES_ICAL: Record<Langue, TextesIcal> = {
  fr: {
    calendrier: "ImmoPlatform Pro — Échéances",
    descriptionCalendrier: "Loyers, fins de bail, sorties, révisions, assurances et documents à renouveler.",
    types: {
      RENT_DUE: "Loyer dû",
      LEASE_END: "Fin de bail",
      EXIT: "Sortie du locataire",
      RENT_REVISION: "Révision de loyer",
      INSURANCE_EXPIRY: "Assurance à renouveler",
      DOCUMENT_EXPIRY: "Document à renouveler",
    },
    enRetard: "En retard",
    loyer: (m) => `Reste dû : ${m}`,
    nouveauLoyer: (m) => `Nouveau loyer : ${m}`,
    assureur: (n) => `Assureur : ${n}`,
    document: (n) => `Document : ${n}`,
    motif: (t) => `Motif : ${t}`,
  },
  en: {
    calendrier: "ImmoPlatform Pro — Due dates",
    descriptionCalendrier: "Rents, lease ends, move-outs, rent reviews, insurance and documents to renew.",
    types: {
      RENT_DUE: "Rent due",
      LEASE_END: "Lease end",
      EXIT: "Tenant move-out",
      RENT_REVISION: "Rent review",
      INSURANCE_EXPIRY: "Insurance to renew",
      DOCUMENT_EXPIRY: "Document to renew",
    },
    enRetard: "Overdue",
    loyer: (m) => `Amount outstanding: ${m}`,
    nouveauLoyer: (m) => `New rent: ${m}`,
    assureur: (n) => `Insurer: ${n}`,
    document: (n) => `Document: ${n}`,
    motif: (t) => `Reason: ${t}`,
  },
  es: {
    calendrier: "ImmoPlatform Pro — Vencimientos",
    descriptionCalendrier: "Alquileres, fines de contrato, salidas, revisiones de alquiler, seguros y documentos por renovar.",
    types: {
      RENT_DUE: "Alquiler pendiente",
      LEASE_END: "Fin de contrato",
      EXIT: "Salida del inquilino",
      RENT_REVISION: "Revisión del alquiler",
      INSURANCE_EXPIRY: "Seguro por renovar",
      DOCUMENT_EXPIRY: "Documento por renovar",
    },
    enRetard: "Atrasado",
    loyer: (m) => `Pendiente de pago: ${m}`,
    nouveauLoyer: (m) => `Nuevo alquiler: ${m}`,
    assureur: (n) => `Aseguradora: ${n}`,
    document: (n) => `Documento: ${n}`,
    motif: (t) => `Motivo: ${t}`,
  },
  pt: {
    calendrier: "ImmoPlatform Pro — Vencimentos",
    descriptionCalendrier: "Rendas, fins de contrato, saídas, revisões de renda, seguros e documentos a renovar.",
    types: {
      RENT_DUE: "Renda em dívida",
      LEASE_END: "Fim de contrato",
      EXIT: "Saída do inquilino",
      RENT_REVISION: "Revisão da renda",
      INSURANCE_EXPIRY: "Seguro a renovar",
      DOCUMENT_EXPIRY: "Documento a renovar",
    },
    enRetard: "Em atraso",
    loyer: (m) => `Em dívida: ${m}`,
    nouveauLoyer: (m) => `Nova renda: ${m}`,
    assureur: (n) => `Seguradora: ${n}`,
    document: (n) => `Documento: ${n}`,
    motif: (t) => `Motivo: ${t}`,
  },
};
