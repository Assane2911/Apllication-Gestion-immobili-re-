import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client";
import { createContract, createInsurancePolicy, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { chargerAgenda } from "./agenda.service";

/**
 * L'agenda est relu à chaque affichage du menu et toutes les cinq minutes par onglet ouvert : ses requêtes ne doivent ramener
 * que les colonnes dont elles se servent. Les lignes entières de contrats, de biens et de locataires portent des textes
 * libres (clauses, mentions, signatures, pièce d'identité) : sur 500 biens, la requête des loyers ramenait 7,5 Mo pour
 * 170 Ko utiles (mesuré). Ce test échoue dès qu'une requête de l'agenda sélectionne de nouveau une ligne entière.
 */

/** Noms des colonnes SQL d'une sélection, quelle que soit l'imbrication ({ i: { id: … }, p: { … } }). */
function colonnesDe(selection: unknown, sortie: string[] = []): string[] {
  if (selection && typeof selection === "object") {
    const colonne = selection as { name?: unknown; table?: unknown };
    if (typeof colonne.name === "string" && "table" in colonne) {
      sortie.push(colonne.name);
    } else {
      for (const valeur of Object.values(selection as Record<string, unknown>)) colonnesDe(valeur, sortie);
    }
  }
  return sortie;
}

const LOURDES = ["terms", "housing_mentions", "scanned_contract_url", "manager_signature_url", "tenant_signature_url", "deposit_deductions", "id_document", "description", "file_path", "notes", "address", "image_url"];

afterEach(() => vi.restoreAllMocks());

describe("chargerAgenda : colonnes sélectionnées", () => {
  it("ne ramène aucune colonne lourde ni aucune ligne entière, sur chacune de ses six requêtes", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { terms: "Clause ".repeat(500), housingMentions: "Mention ".repeat(500) });
    await createInvoice(contract.id, { dueDate: new Date(2026, 5, 20) });
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 8, 1) });

    const select = vi.spyOn(db, "select");
    const evenements = await chargerAgenda(manager.id, 90, new Date(2026, 5, 15));

    // Les échéances sont bien là : le test ne passe pas faute de requêtes.
    expect(evenements.length).toBeGreaterThan(0);
    const appels = select.mock.calls.filter(([champs]) => champs !== undefined);
    expect(appels).toHaveLength(6);

    for (const [champs] of appels) {
      const noms = colonnesDe(champs);
      expect(noms.length).toBeGreaterThan(0);
      for (const lourde of LOURDES) expect(noms).not.toContain(lourde);
      // Une ligne entière de contrat compte plus de 25 colonnes : une requête de l'agenda en a une quinzaine au plus.
      expect(noms.length).toBeLessThan(16);
    }
  });
});
