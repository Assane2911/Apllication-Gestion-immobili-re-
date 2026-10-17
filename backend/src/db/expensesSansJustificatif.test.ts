import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { expenses } from "./schema";

/**
 * `expenses.receipt_url` n'a jamais été renseignée par aucun écran ni aucune route : colonne morte, retirée du
 * schéma. Les bases déjà créées la gardent (elle est vide, et `db:check` ne signale que les colonnes MANQUANTES) ;
 * les nouvelles ne la créent plus. Si un justificatif de dépense est un jour proposé, il aura son stockage privé,
 * son nettoyage à la suppression et son écran : on le rajoutera alors, avec tout cela.
 */
describe("Dépenses : pas de colonne de justificatif inutilisée", () => {
  it("le schéma ne déclare plus receipt_url", () => {
    const colonnes = Object.values(getTableColumns(expenses)).map((c) => c.name);
    expect(colonnes).not.toContain("receipt_url");
    expect(colonnes).toContain("title");
  });
});
