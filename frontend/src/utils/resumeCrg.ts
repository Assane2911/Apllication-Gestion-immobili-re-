import type { CrgSynthesis } from "../types";

interface Libelles {
  titre: string;
  loyers: string;
  charges: string;
  commission: string;
  net: string;
}

/**
 * Récapitulatif d'un compte-rendu de gestion en texte brut, prêt à coller dans un message (WhatsApp, e-mail, SMS) :
 * une ligne par poste et par devise. Les devises restent séparées, jamais additionnées.
 */
export function resumeCrg(crg: CrgSynthesis, periode: string, libelles: Libelles, formatMoney: (montant: number, devise: string) => string): string {
  const devises = Object.keys(crg.totalLoyersByCurrency).sort();
  const lignes = [`${libelles.titre} — ${crg.ownerName} — ${periode}`];
  for (const devise of devises) {
    if (devises.length > 1) lignes.push(`[${devise}]`);
    lignes.push(`${libelles.loyers} : ${formatMoney(crg.totalLoyersByCurrency[devise] ?? 0, devise)}`);
    lignes.push(`${libelles.charges} : ${formatMoney(crg.totalChargesByCurrency[devise] ?? 0, devise)}`);
    lignes.push(`${libelles.commission} : ${formatMoney(crg.totalCommissionByCurrency[devise] ?? 0, devise)}`);
    lignes.push(`${libelles.net} : ${formatMoney(crg.totalNetByCurrency[devise] ?? 0, devise)}`);
  }
  return lignes.join("\n");
}

export type EtatReversement = "none" | "partial" | "done" | "over";

/**
 * Où en est le reversement du mois : `done` quand tout est versé (reste nul dans chaque devise), `over` si l'agence a
 * versé plus que le net, `partial` si une partie seulement l'est, `none` si rien n'a encore été versé. Sans information
 * de reste (serveur plus ancien), on ne conclut rien (`null`).
 */
export function etatReversement(crg: CrgSynthesis): EtatReversement | null {
  const reste = crg.resteAReverserByCurrency;
  if (!reste) return null;
  const devises = Object.keys(crg.totalNetByCurrency).filter((d) => (crg.totalNetByCurrency[d] ?? 0) !== 0 || (crg.totalReverseByCurrency?.[d] ?? 0) !== 0);
  if (devises.length === 0) return null;
  const restes = devises.map((d) => reste[d] ?? 0);
  const verses = devises.map((d) => crg.totalReverseByCurrency?.[d] ?? 0);
  if (restes.some((r) => r < 0)) return "over";
  if (restes.every((r) => r === 0)) return "done";
  return verses.some((v) => v > 0) ? "partial" : "none";
}
