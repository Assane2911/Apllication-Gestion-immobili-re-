import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";

/**
 * La liste des factures ne renvoie du bail, du bien et du locataire que ce que l'écran affiche. Les lignes entières
 * pesaient plus de 250 Ko pour une page de 20 factures (clauses et mentions du bail, description du bien, pièce
 * d'identité du locataire) : mesuré à 5 000 biens, 279 Ko avant, 16 Ko après. Ce test échoue dès qu'un champ long ou
 * sensible réapparaît dans la réponse, et vérifie que les champs lus par la page (InvoicesPage) y sont toujours.
 */
describe("GET /api/invoices : champs du bail, du bien et du locataire", () => {
  it("n'expose ni clauses, ni description, ni pièce d'identité, mais garde ce que la page affiche", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Villa Safran", description: "Description ".repeat(300) });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop", email: "awa@example.test", idDocument: "SECRET-123" });
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", terms: "Clause ".repeat(500), housingMentions: "Mention ".repeat(300) });
    await createInvoice(contract.id, { status: "LATE" });

    const res = await request(app).get("/api/invoices").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const facture = res.body.data?.[0] ?? res.body.items?.[0] ?? res.body[0];
    expect(facture.contract.tenant).toMatchObject({ firstName: "Awa", lastName: "Diop", email: "awa@example.test" });
    expect(facture.contract.property).toMatchObject({ id: property.id, title: "Villa Safran" });
    expect(facture.contract.id).toBe(contract.id);
    expect(facture.contract.terms).toBeUndefined();
    expect(facture.contract.housingMentions).toBeUndefined();
    expect(facture.contract.property.description).toBeUndefined();
    expect(facture.contract.tenant.idDocument).toBeUndefined();
    expect(res.text).not.toContain("SECRET-123");
    expect(res.text.length).toBeLessThan(3000);
  });
});
