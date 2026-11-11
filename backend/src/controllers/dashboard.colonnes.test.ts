import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { getDashboardStats } from "./dashboard.controller";

/**
 * Le tableau de bord est la page d'arrivée du gestionnaire : ses requêtes ne ramènent que les colonnes dont elles se servent.
 * Les lignes entières de biens, de contrats (clauses, mentions de bail), de factures et de dépenses pèsent des mégaoctets sur
 * un grand portefeuille (mesuré : 350 ms avant, 80 ms après, sur 500 biens). Ce test échoue dès qu'une requête du tableau de
 * bord sélectionne de nouveau une ligne entière (`db.select()` sans liste de colonnes).
 *
 * Le contrôleur est appelé directement, sans la chaîne d'authentification : celle-ci relit légitimement la ligne du compte.
 */
afterEach(() => vi.restoreAllMocks());

describe("getDashboardStats : colonnes sélectionnées", () => {
  it("n'effectue aucune sélection de ligne entière", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", terms: "Clause ".repeat(500) });
    await createInvoice(contract.id, { status: "LATE", dueDate: new Date(2020, 0, 5) });

    const select = vi.spyOn(db, "select");
    let corps: unknown;
    const res = { json: (c: unknown) => { corps = c; return res; } } as never;
    await new Promise<void>((resolve, reject) => {
      (getDashboardStats as unknown as (req: unknown, res: unknown, next: (e?: unknown) => void) => void)(
        { user: { userId: manager.id } },
        res,
        (erreur) => (erreur ? reject(erreur) : resolve())
      );
      // asyncHandler ne rappelle pas next en cas de succès : on attend la réponse JSON.
      const attente = setInterval(() => {
        if (corps !== undefined) {
          clearInterval(attente);
          resolve();
        }
      }, 5);
    });

    expect(corps).toMatchObject({ totalProperties: 1, activeContracts: 1, lateInvoices: 1 });
    expect(select.mock.calls.length).toBeGreaterThan(5);
    for (const [champs] of select.mock.calls) {
      expect(champs, "db.select() sans colonnes ramène la ligne entière").toBeDefined();
    }
  });
});
