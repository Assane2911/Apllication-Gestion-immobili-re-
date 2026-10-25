import type { Langue } from "../utils/langue";

/**
 * Textes du compte-rendu de gestion (CRG) mensuel, dans la langue du propriétaire à qui il est destiné. La mise en page
 * est dans pdf.service.ts (generateCrgHtml) ; ici, seulement les mots. Le français est le texte d'origine, repris tel
 * quel. Les autres documents générés (quittance, bail, état des lieux, avenant, mise en demeure) ne sont pas traduits :
 * ce sont des écrits à portée juridique.
 */
export interface TextesCrg {
  titreDocument: (periode: string, proprietaire: string) => string;
  titre: string;
  periode: (periode: string) => string;
  sectionProprietaire: string;
  agence: string;
  proprietaire: string;
  tauxCommission: string;
  /** Écriture d'un pourcentage : « 10 % » (espace avant le signe) ou « 10% ». */
  pourcent: (valeur: number) => string;
  sectionDetail: string;
  colonnes: { bien: string; loyers: string; charges: string; commission: string; net: string };
  aucunBien: string;
  total: (devise: string) => string;
  sectionReversements: string;
  colonnesReversements: { date: string; moyen: string; montant: string };
  aucunReversement: string;
  resteAReverser: (devise: string) => string;
  verseEnTrop: (devise: string) => string;
  moyens: Record<"BANK_TRANSFER" | "CASH" | "CHEQUE" | "MOBILE_MONEY" | "OTHER", string>;
  sectionBanque: string;
  iban: string;
  bic: string;
  aucuneBanque: string;
  pied: (date: string) => string;
}

const fr: TextesCrg = {
  titreDocument: (periode, proprietaire) => `Compte-Rendu de Gestion - ${periode} - ${proprietaire}`,
  titre: "COMPTE-RENDU DE GESTION",
  periode: (periode) => `Période : ${periode}`,
  sectionProprietaire: "Propriétaire",
  agence: "Agence / Mandataire :",
  proprietaire: "Propriétaire :",
  tauxCommission: "Taux de commission :",
  pourcent: (valeur) => `${valeur} %`,
  sectionDetail: "Détail par bien",
  colonnes: { bien: "Bien", loyers: "Loyers encaissés", charges: "Charges déduites", commission: "Commission", net: "Net à reverser" },
  aucunBien: "Aucun bien rattaché à ce propriétaire",
  total: (devise) => `Total ${devise}`,
  sectionReversements: "Reversements au propriétaire",
  colonnesReversements: { date: "Date", moyen: "Moyen", montant: "Montant" },
  aucunReversement: "Aucun reversement enregistré pour ce mois",
  resteAReverser: (devise) => `Reste à reverser (${devise})`,
  verseEnTrop: (devise) => `Versé en trop (${devise})`,
  moyens: { BANK_TRANSFER: "Virement", CASH: "Espèces", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", OTHER: "Autre" },
  sectionBanque: "Coordonnées bancaires du propriétaire",
  iban: "IBAN :",
  bic: "BIC :",
  aucuneBanque: "Aucune coordonnée bancaire renseignée pour ce propriétaire.",
  pied: (date) => `Document généré le ${date} — Compte-rendu de gestion à valeur informative, établi pour le compte du propriétaire.`,
};

const en: TextesCrg = {
  titreDocument: (periode, proprietaire) => `Management Report - ${periode} - ${proprietaire}`,
  titre: "MANAGEMENT REPORT",
  periode: (periode) => `Period: ${periode}`,
  sectionProprietaire: "Owner",
  agence: "Agency / Agent:",
  proprietaire: "Owner:",
  tauxCommission: "Commission rate:",
  pourcent: (valeur) => `${valeur}%`,
  sectionDetail: "Breakdown by property",
  colonnes: { bien: "Property", loyers: "Rent collected", charges: "Charges deducted", commission: "Commission", net: "Net to be paid" },
  aucunBien: "No property linked to this owner",
  total: (devise) => `Total ${devise}`,
  sectionReversements: "Payments to the owner",
  colonnesReversements: { date: "Date", moyen: "Method", montant: "Amount" },
  aucunReversement: "No payment recorded for this month",
  resteAReverser: (devise) => `Remaining to be paid (${devise})`,
  verseEnTrop: (devise) => `Overpaid (${devise})`,
  moyens: { BANK_TRANSFER: "Bank transfer", CASH: "Cash", CHEQUE: "Cheque", MOBILE_MONEY: "Mobile money", OTHER: "Other" },
  sectionBanque: "Owner's bank details",
  iban: "IBAN:",
  bic: "BIC:",
  aucuneBanque: "No bank details provided for this owner.",
  pied: (date) => `Document generated on ${date} — Management report for information purposes, prepared on behalf of the owner.`,
};

const es: TextesCrg = {
  titreDocument: (periode, proprietaire) => `Informe de gestión - ${periode} - ${proprietaire}`,
  titre: "INFORME DE GESTIÓN",
  periode: (periode) => `Período: ${periode}`,
  sectionProprietaire: "Propietario",
  agence: "Agencia / Mandatario:",
  proprietaire: "Propietario:",
  tauxCommission: "Tasa de comisión:",
  pourcent: (valeur) => `${valeur} %`,
  sectionDetail: "Detalle por inmueble",
  colonnes: { bien: "Inmueble", loyers: "Alquileres cobrados", charges: "Gastos deducidos", commission: "Comisión", net: "Neto a liquidar" },
  aucunBien: "Ningún inmueble asociado a este propietario",
  total: (devise) => `Total ${devise}`,
  sectionReversements: "Liquidaciones al propietario",
  colonnesReversements: { date: "Fecha", moyen: "Medio", montant: "Importe" },
  aucunReversement: "Ninguna liquidación registrada este mes",
  resteAReverser: (devise) => `Pendiente de liquidar (${devise})`,
  verseEnTrop: (devise) => `Liquidado en exceso (${devise})`,
  moyens: { BANK_TRANSFER: "Transferencia", CASH: "Efectivo", CHEQUE: "Cheque", MOBILE_MONEY: "Mobile money", OTHER: "Otro" },
  sectionBanque: "Datos bancarios del propietario",
  iban: "IBAN:",
  bic: "BIC:",
  aucuneBanque: "No se han indicado datos bancarios para este propietario.",
  pied: (date) => `Documento generado el ${date} — Informe de gestión con valor informativo, elaborado por cuenta del propietario.`,
};

const pt: TextesCrg = {
  titreDocument: (periode, proprietaire) => `Relatório de gestão - ${periode} - ${proprietaire}`,
  titre: "RELATÓRIO DE GESTÃO",
  periode: (periode) => `Período: ${periode}`,
  sectionProprietaire: "Proprietário",
  agence: "Imobiliária / Mandatária:",
  proprietaire: "Proprietário:",
  tauxCommission: "Taxa de comissão:",
  pourcent: (valeur) => `${valeur}%`,
  sectionDetail: "Detalhamento por imóvel",
  colonnes: { bien: "Imóvel", loyers: "Aluguéis recebidos", charges: "Despesas deduzidas", commission: "Comissão", net: "Líquido a repassar" },
  aucunBien: "Nenhum imóvel vinculado a este proprietário",
  total: (devise) => `Total ${devise}`,
  sectionReversements: "Repasses ao proprietário",
  colonnesReversements: { date: "Data", moyen: "Meio", montant: "Valor" },
  aucunReversement: "Nenhum repasse registrado neste mês",
  resteAReverser: (devise) => `Restante a repassar (${devise})`,
  verseEnTrop: (devise) => `Repassado a mais (${devise})`,
  moyens: { BANK_TRANSFER: "Transferência", CASH: "Dinheiro", CHEQUE: "Cheque", MOBILE_MONEY: "Mobile money", OTHER: "Outro" },
  sectionBanque: "Dados bancários do proprietário",
  iban: "IBAN:",
  bic: "BIC:",
  aucuneBanque: "Nenhum dado bancário informado para este proprietário.",
  pied: (date) => `Documento gerado em ${date} — Relatório de gestão com valor informativo, elaborado por conta do proprietário.`,
};

export const TEXTES_CRG: Record<Langue, TextesCrg> = { fr, en, es, pt };
