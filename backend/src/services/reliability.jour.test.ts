import { describe, expect, it } from "vitest";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { fetchFiabiliteParLocataire } from "./reliability.service";

/**
 * Payer le JOUR de l'échéance, c'est payer à temps. La comparaison se faisait à
 * l'instant près : une échéance à minuit et un paiement à 10 h le même jour
 * comptaient « en retard ». Avec une date d'encaissement choisie par le
 * gestionnaire (midi UTC), la comparaison se fait désormais au jour près.
 */
describe("fiabilité — comparaison au jour près", () => {
  it("un paiement le jour de l'échéance est à temps ; le lendemain, il est en retard", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const echeance = (mois: number) => new Date(Date.UTC(2026, mois - 1, 5, 0, 0, 0));

    await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026, status: "PAID", dueDate: echeance(1), paidAt: new Date(Date.UTC(2026, 0, 5, 12)) });
    await createInvoice(contract.id, { periodMonth: 2, periodYear: 2026, status: "PAID", dueDate: echeance(2), paidAt: new Date(Date.UTC(2026, 1, 5, 23, 59)) });
    await createInvoice(contract.id, { periodMonth: 3, periodYear: 2026, status: "PAID", dueDate: echeance(3), paidAt: new Date(Date.UTC(2026, 2, 6, 0, 30)) });

    const fiabilite = (await fetchFiabiliteParLocataire([tenant.id])).get(tenant.id)!;
    expect(fiabilite.payeATemps).toBe(2);
    expect(fiabilite.payeEnRetard).toBe(1);
  });
});
