/** Propose au navigateur d'enregistrer un fichier CSV (contenu déjà préfixé du BOM, voir csv.ts). */
export function telechargerCsv(nomFichier: string, contenu: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8;" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  lien.click();
  URL.revokeObjectURL(url);
}

/** « 2026-11-01 » : la date du jour pour nommer un export. */
export function dateDuJourPourFichier(maintenant: Date = new Date()): string {
  return maintenant.toISOString().split("T")[0];
}
