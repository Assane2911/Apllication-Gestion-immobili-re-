import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings, issueReports, messages } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createPortalUser,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Droit d'accès (RGPD art. 15) et droit à la portabilité (art. 20). La
 * politique de confidentialité les annonçait comme « traités manuellement » :
 * autrement dit, il fallait qu'un humain reconstitue à la main ce que le
 * Service détient sur un locataire, sans outil et sans garantie
 * d'exhaustivité. Une promesse qu'aucun code ne tenait.
 *
 * L'export rassemble en un seul document, dans un format lisible par machine,
 * tout ce qui se rapporte à une personne : sa fiche, ses baux, ses factures,
 * ses signalements, ses états des lieux et ses messages. Deux portes y
 * mènent — le Gestionnaire, à qui la demande est normalement adressée
 * puisqu'il est responsable de traitement, et le Locataire lui-même depuis
 * son portail, qui n'a alors personne à solliciter.
 */
describe("Export des données d'un locataire", () => {
  async function dossierComplet() {
    const manager = await createManager();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port" });
    const property = await createProperty(manager.id, { title: "Studio Plateau" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diallo" });
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", amount: 350 });
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Fuite",
      description: "Fuite sous l'évier",
      photoUrl: "issues/fuite.jpg",
      managerNote: "Plombier prévu jeudi",
    });
    const comptePortail = await createTenantPortalUser(tenant);
    await testDb.insert(messages).values({
      contractId: contract.id,
      senderId: comptePortail.id,
      senderRole: "TENANT",
      content: "Bonjour, la fuite continue",
    });
    return { manager, tenant, contract, invoice, comptePortail };
  }

  it("rassemble la fiche, les baux, les factures, les signalements et les messages", async () => {
    const { manager, tenant, contract, invoice } = await dossierComplet();

    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/export`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.locataire.firstName).toBe("Awa");
    expect(res.body.locataire.email).toBe(tenant.email);
    expect(res.body.contrats).toHaveLength(1);
    expect(res.body.contrats[0].id).toBe(contract.id);
    expect(res.body.contrats[0].bien.title).toBe("Studio Plateau");
    expect(res.body.factures).toHaveLength(1);
    expect(res.body.factures[0].id).toBe(invoice.id);
    expect(res.body.signalements).toHaveLength(1);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].content).toBe("Bonjour, la fuite continue");
  });

  it("nomme le responsable du traitement, sans qui l'export ne dit pas à qui s'adresser", async () => {
    const { manager, tenant } = await dossierComplet();

    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/export`)
      .set(authHeader(tokenFor(manager)));

    expect(res.body.responsableDuTraitement.agencyName).toBe("Agence du Port");
    expect(res.body.responsableDuTraitement.email).toBe(manager.email);
    expect(typeof res.body.exportGenereLe).toBe("string");
  });

  it("inclut la note interne du gestionnaire, qui parle du locataire", async () => {
    // Le droit d'accès porte sur TOUTES les données concernant la personne,
    // y compris les appréciations écrites à son sujet. Les omettre ferait de
    // l'export un résumé choisi plutôt qu'un droit exercé.
    const { manager, tenant } = await dossierComplet();

    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/export`)
      .set(authHeader(tokenFor(manager)));

    expect(res.body.signalements[0].managerNote).toBe("Plombier prévu jeudi");
  });

  it("se télécharge comme un fichier, plutôt que de s'afficher dans le navigateur", async () => {
    const { manager, tenant } = await dossierComplet();

    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/export`)
      .set(authHeader(tokenFor(manager)));

    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.json/);
  });

  it("permet au locataire d'obtenir ses propres données depuis son portail", async () => {
    const { tenant, comptePortail } = await dossierComplet();

    const res = await request(app)
      .get("/api/tenants/mine/export")
      .set(authHeader(tokenFor(comptePortail, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body.locataire.email).toBe(tenant.email);
    expect(res.body.contrats).toHaveLength(1);
  });

  it("ne livre jamais le dossier d'un locataire d'une autre agence", async () => {
    const { tenant } = await dossierComplet();
    const autreManager = await createManager();

    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/export`)
      .set(authHeader(tokenFor(autreManager)));

    expect(res.status).toBe(404);
  });

  it("ne livre jamais le dossier d'un autre locataire à un locataire", async () => {
    const { tenant } = await dossierComplet();
    const intrus = await createPortalUser("TENANT");

    const res = await request(app)
      .get("/api/tenants/mine/export")
      .set(authHeader(tokenFor(intrus, tenant.id)));

    // Le jeton porte bien un tenantId, mais il ne désigne pas ce locataire :
    // c'est la fiche liée au COMPTE qui fait foi, jamais celle que le jeton
    // prétend viser.
    expect(res.status).toBe(403);
  });
});
