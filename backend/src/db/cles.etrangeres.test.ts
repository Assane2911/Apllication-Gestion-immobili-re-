import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { testDb } from "../test/setupTestDb";

/**
 * Chaque clé étrangère a un index qui commence par sa colonne.
 *
 * Sans index, supprimer ou modifier une ligne PARENT oblige PostgreSQL à parcourir TOUTE la table enfant pour vérifier qu'aucune
 * ligne ne la référence (et pour appliquer le CASCADE / SET NULL) : la suppression d'un compte, qui efface des dizaines de comptes
 * liés, devenait un balayage complet par compte supprimé. Les conseils de performance de Supabase signalaient déjà
 * owner_messages.sender_id.
 */
describe("clés étrangères", () => {
  it("toutes ont un index couvrant (colonne de tête)", async () => {
    const res = (await testDb.execute(sql`
      SELECT c.conrelid::regclass::text || '.' || a.attname AS nom
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
      ORDER BY 1
    `)) as unknown as { rows?: Array<{ nom: string }> } & Array<{ nom: string }>;

    const sansIndex = (res.rows ?? res).map((ligne) => ligne.nom);

    expect(sansIndex).toEqual([]);
  });
});
