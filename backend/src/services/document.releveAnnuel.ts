import { escapeHtml } from "../utils/html";
import { formaterDate, LANGUE_PAR_DEFAUT, LOCALE_PAR_LANGUE, nomDuMois, type Langue } from "../utils/langue";
import { formaterMontant, symboleDevise } from "../utils/montant";
import { TEXTES_CRG } from "./document.crg.textes";

/**
 * Relevé annuel des loyers d'UN propriétaire : la somme exacte de ses douze comptes-rendus de gestion mensuels (voir
 * crg.controller.ts, computeReleveAnnuel), dans sa langue. Les mots communs avec le compte-rendu mensuel (colonnes, moyens de
 * paiement, totaux) sont repris de document.crg.textes.ts ; ici, seulement ce qui est propre au relevé annuel.
 *
 * Document informatif : il ne constitue pas une déclaration fiscale et n'affirme aucune règle d'impôt, d'aucun pays.
 */
interface TextesReleveAnnuel {
  titreDocument: (annee: number, proprietaire: string) => string;
  titre: string;
  periode: (annee: number) => string;
  sectionMois: (devise: string) => string;
  colonnesMois: { mois: string; loyers: string; charges: string; commission: string; net: string; reverse: string };
  sectionBiens: string;
  aucunReversement: string;
  pied: (date: string) => string;
}

const fr: TextesReleveAnnuel = {
  titreDocument: (annee, proprietaire) => `Relevé annuel des loyers - ${annee} - ${proprietaire}`,
  titre: "RELEVÉ ANNUEL DES LOYERS",
  periode: (annee) => `Année : ${annee}`,
  sectionMois: (devise) => `Mois par mois (${devise})`,
  colonnesMois: { mois: "Mois", loyers: "Loyers encaissés", charges: "Charges déduites", commission: "Commission", net: "Net", reverse: "Reversé" },
  sectionBiens: "Total de l'année par bien",
  aucunReversement: "Aucun reversement enregistré pour cette année",
  pied: (date) => `Document généré le ${date} — Relevé à valeur informative, somme des comptes-rendus de gestion mensuels. Il ne constitue pas une déclaration fiscale.`,
};

const en: TextesReleveAnnuel = {
  titreDocument: (annee, proprietaire) => `Annual rent statement - ${annee} - ${proprietaire}`,
  titre: "ANNUAL RENT STATEMENT",
  periode: (annee) => `Year: ${annee}`,
  sectionMois: (devise) => `Month by month (${devise})`,
  colonnesMois: { mois: "Month", loyers: "Rent collected", charges: "Charges deducted", commission: "Commission", net: "Net", reverse: "Paid out" },
  sectionBiens: "Year total by property",
  aucunReversement: "No payment recorded for this year",
  pied: (date) => `Document generated on ${date} — Statement for information purposes, the sum of the monthly management reports. It is not a tax return.`,
};

const es: TextesReleveAnnuel = {
  titreDocument: (annee, proprietaire) => `Extracto anual de alquileres - ${annee} - ${proprietaire}`,
  titre: "EXTRACTO ANUAL DE ALQUILERES",
  periode: (annee) => `Año: ${annee}`,
  sectionMois: (devise) => `Mes a mes (${devise})`,
  colonnesMois: { mois: "Mes", loyers: "Alquileres cobrados", charges: "Gastos deducidos", commission: "Comisión", net: "Neto", reverse: "Abonado" },
  sectionBiens: "Total del año por inmueble",
  aucunReversement: "Ningún pago registrado este año",
  pied: (date) => `Documento generado el ${date} — Extracto con valor informativo, suma de los informes de gestión mensuales. No constituye una declaración fiscal.`,
};

const pt: TextesReleveAnnuel = {
  titreDocument: (annee, proprietaire) => `Extrato anual de rendas - ${annee} - ${proprietaire}`,
  titre: "EXTRATO ANUAL DE RENDAS",
  periode: (annee) => `Ano: ${annee}`,
  sectionMois: (devise) => `Mês a mês (${devise})`,
  colonnesMois: { mois: "Mês", loyers: "Rendas recebidas", charges: "Despesas deduzidas", commission: "Comissão", net: "Líquido", reverse: "Repassado" },
  sectionBiens: "Total do ano por imóvel",
  aucunReversement: "Nenhum repasse registrado neste ano",
  pied: (date) => `Documento gerado em ${date} — Extrato com valor informativo, soma dos relatórios de gestão mensais. Não constitui uma declaração fiscal.`,
};

export const TEXTES_RELEVE_ANNUEL: Record<Langue, TextesReleveAnnuel> = { fr, en, es, pt };

type ParDevise = Record<string, number>;

export interface ReleveAnnuelExportData {
  agencyName: string;
  ownerName: string;
  ownerCompanyName?: string | null;
  managementFeeRate: number;
  year: number;
  months: Array<{
    month: number;
    totalLoyersByCurrency: ParDevise;
    totalChargesByCurrency: ParDevise;
    totalCommissionByCurrency: ParDevise;
    totalNetByCurrency: ParDevise;
    totalReverseByCurrency: ParDevise;
  }>;
  properties: Array<{
    propertyTitle: string;
    currency: string;
    loyersEncaisses: number;
    chargesDeduites: number;
    commission: number;
    netAReverser: number;
  }>;
  totalLoyersByCurrency: ParDevise;
  totalChargesByCurrency: ParDevise;
  totalCommissionByCurrency: ParDevise;
  totalNetByCurrency: ParDevise;
  reversements: Array<{ currency: string; amount: number; paidAt: Date | string; method: string; reference: string | null }>;
  totalReverseByCurrency: ParDevise;
  resteAReverserByCurrency: ParDevise;
  /** Langue du propriétaire à qui le document est destiné (français par défaut). */
  langue?: Langue;
}

/** Export HTML du relevé annuel : un document autonome, imprimable ou exportable en PDF depuis le navigateur. */
export function generateReleveAnnuelHtml(data: ReleveAnnuelExportData): string {
  const langue = data.langue ?? LANGUE_PAR_DEFAUT;
  const t = TEXTES_RELEVE_ANNUEL[langue];
  const c = TEXTES_CRG[langue];
  const generatedDate = new Intl.DateTimeFormat(LOCALE_PAR_LANGUE[langue], { dateStyle: "long" }).format(new Date());
  const montant = (valeur: number | undefined, devise: string) => escapeHtml(formaterMontant(valeur ?? 0, devise, langue));

  const devises = Array.from(
    new Set([
      ...Object.keys(data.totalLoyersByCurrency),
      ...Object.keys(data.totalChargesByCurrency),
      ...Object.keys(data.totalCommissionByCurrency),
      ...Object.keys(data.totalNetByCurrency),
      ...Object.keys(data.totalReverseByCurrency),
      ...data.properties.map((p) => p.currency),
    ])
  ).sort();

  // Un tableau de douze mois par devise : les montants de devises différentes ne s'additionnent jamais.
  const tableauxMois = devises
    .map((devise) => {
      const lignes = data.months
        .map((m) => {
          const nom = nomDuMois(m.month, langue);
          return `
      <tr>
        <td>${escapeHtml(nom.charAt(0).toUpperCase() + nom.slice(1))}</td>
        <td class="num">${montant(m.totalLoyersByCurrency[devise], devise)}</td>
        <td class="num">${montant(m.totalChargesByCurrency[devise], devise)}</td>
        <td class="num">${montant(m.totalCommissionByCurrency[devise], devise)}</td>
        <td class="num">${montant(m.totalNetByCurrency[devise], devise)}</td>
        <td class="num">${montant(m.totalReverseByCurrency[devise], devise)}</td>
      </tr>`;
        })
        .join("");
      return `<div class="section">
    <div class="section-title">${escapeHtml(t.sectionMois(symboleDevise(devise)))}</div>
    <table>
      <thead><tr>
        <th>${t.colonnesMois.mois}</th><th class="num">${t.colonnesMois.loyers}</th><th class="num">${t.colonnesMois.charges}</th>
        <th class="num">${t.colonnesMois.commission}</th><th class="num">${t.colonnesMois.net}</th><th class="num">${t.colonnesMois.reverse}</th>
      </tr></thead>
      <tbody>${lignes}
      <tr class="total-row">
        <td>${escapeHtml(c.total(symboleDevise(devise)))}</td>
        <td class="num">${montant(data.totalLoyersByCurrency[devise], devise)}</td>
        <td class="num">${montant(data.totalChargesByCurrency[devise], devise)}</td>
        <td class="num">${montant(data.totalCommissionByCurrency[devise], devise)}</td>
        <td class="num">${montant(data.totalNetByCurrency[devise], devise)}</td>
        <td class="num">${montant(data.totalReverseByCurrency[devise], devise)}</td>
      </tr></tbody>
    </table>
  </div>`;
    })
    .join("");

  const lignesBiens = data.properties.length
    ? data.properties
        .map(
          (p) => `
      <tr>
        <td>${escapeHtml(p.propertyTitle)}</td>
        <td class="num">${montant(p.loyersEncaisses, p.currency)}</td>
        <td class="num">${montant(p.chargesDeduites, p.currency)}</td>
        <td class="num">${montant(p.commission, p.currency)}</td>
        <td class="num" style="font-weight:700;">${montant(p.netAReverser, p.currency)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" style="text-align:center; color:#94a3b8;">${c.aucunBien}</td></tr>`;

  const lignesReversements = data.reversements.length
    ? data.reversements
        .map(
          (r) => `
      <tr>
        <td>${escapeHtml(formaterDate(r.paidAt, langue, {}))}</td>
        <td>${escapeHtml((c.moyens as Record<string, string>)[r.method] ?? r.method)}${r.reference ? ` — ${escapeHtml(r.reference)}` : ""}</td>
        <td class="num" style="font-weight:700;">${montant(r.amount, r.currency)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="text-align:center; color:#94a3b8;">${t.aucunReversement}</td></tr>`;
  const restes = Object.entries(data.resteAReverserByCurrency)
    .filter(([, valeur]) => valeur !== 0)
    .map(
      ([devise, valeur]) =>
        `<tr class="total-row"><td colspan="2">${escapeHtml(valeur > 0 ? c.resteAReverser(devise) : c.verseEnTrop(devise))}</td><td class="num">${montant(Math.abs(valeur), devise)}</td></tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="${langue}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(t.titreDocument(data.year, data.ownerName))}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; line-height: 1.6; padding: 24px; }
    h1 { color: #0f172a; font-size: 20px; text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .subtitle { text-align:center; font-size:12px; color:#64748b; margin-top: 4px; }
    .section { margin-top: 20px; }
    .section-title { font-weight: bold; font-size: 14px; text-transform: uppercase; color: #2563eb; margin-bottom: 6px; break-after: avoid; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 8px 10px; }
    th.num, td.num { text-align: right; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr { break-inside: avoid; }
    .total-row td { font-weight: 700; background: #f1f5f9; border-top: 2px solid #0f172a; }
    .footer-legal { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <h1>${t.titre}</h1>
  <p class="subtitle">${escapeHtml(t.periode(data.year))}</p>

  <div class="section">
    <div class="section-title">${c.sectionProprietaire}</div>
    <div class="box">
      <strong>${c.agence}</strong> ${escapeHtml(data.agencyName)}<br>
      <strong>${c.proprietaire}</strong> ${escapeHtml(data.ownerName)}${data.ownerCompanyName ? ` (${escapeHtml(data.ownerCompanyName)})` : ""}<br>
      <strong>${c.tauxCommission}</strong> ${c.pourcent(data.managementFeeRate)}
    </div>
  </div>

  ${tableauxMois}

  <div class="section">
    <div class="section-title">${t.sectionBiens}</div>
    <table>
      <thead><tr><th>${c.colonnes.bien}</th><th class="num">${c.colonnes.loyers}</th><th class="num">${c.colonnes.charges}</th><th class="num">${c.colonnes.commission}</th><th class="num">${c.colonnes.net}</th></tr></thead>
      <tbody>${lignesBiens}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">${c.sectionReversements}</div>
    <table>
      <thead><tr><th>${c.colonnesReversements.date}</th><th>${c.colonnesReversements.moyen}</th><th class="num">${c.colonnesReversements.montant}</th></tr></thead>
      <tbody>${lignesReversements}${restes}</tbody>
    </table>
  </div>

  <div class="footer-legal">${escapeHtml(t.pied(generatedDate))}</div>
</body>
</html>
  `.trim();
}
