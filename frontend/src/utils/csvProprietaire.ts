import type { OwnerDashboard } from "../types";
import { csvEscape, csvMontant, CSV_BOM } from "./csv";

/**
 * Tableau de bord du propriétaire en CSV pour un tableur francophone : un bloc « biens » (perçu et en attente du mois,
 * par devise) et un bloc « historique » (loyers perçus par mois et par devise). Les devises restent sur des lignes
 * séparées, jamais additionnées ; les mois sont écrits tels que le serveur les donne (AAAA-MM), triables sans effort.
 */
export function csvTableauDeBord(
  data: OwnerDashboard,
  libelles: { property: string; address: string; currency: string; collected: string; pending: string; month: string; revenue: string }
): string {
  const lignes: string[] = [];
  lignes.push([libelles.property, libelles.address, libelles.currency, libelles.collected, libelles.pending].map(csvEscape).join(";"));
  for (const p of data.properties) {
    lignes.push([csvEscape(p.title), csvEscape(p.address), csvEscape(p.currency), csvMontant(p.collected), csvMontant(p.pending)].join(";"));
  }
  lignes.push("");
  lignes.push([libelles.month, libelles.currency, libelles.revenue].map(csvEscape).join(";"));
  for (const mois of Object.keys(data.revenueByMonth).sort()) {
    for (const [devise, montant] of Object.entries(data.revenueByMonth[mois]).sort(([a], [b]) => a.localeCompare(b))) {
      lignes.push([csvEscape(mois), csvEscape(devise), csvMontant(montant)].join(";"));
    }
  }
  return CSV_BOM + lignes.join("\n");
}
