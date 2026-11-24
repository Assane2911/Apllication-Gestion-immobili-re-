import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings, rentRevisions } from "../db/schema";
import {
  authHeader,
  createContract,
  createInspection,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de document.controller.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Chaque test lit le document RENDU (quittance, bail, état des lieux, avenant) et vérifie la donnée précise qui
 * y figure, ou le code d'erreur renvoyé. Un champ branché sur la mauvaise source (réglages de l'agence du
 * demandeur au lieu de celle du bien, devise figée, date de création au lieu de la date d'effet…) produisait un
 * document faux sans qu'aucun test ne bronche.
 */

const URL_LOGO = "https://placeholder.supabase.co/storage/v1/object/public/public-uploads/agency/logo.png";

/** Réglages d'agence complets, pour vérifier que chaque champ arrive au bon endroit du document. */
async function agenceComplete(userId: string) {
  await testDb.insert(agencySettings).values({
    userId,
    agencyName: "Agence Teranga",
    logoUrl: URL_LOGO,
    address: "12 rue du Port, Dakar",
    phone: "+221 33 000 00 00",
    email: "contact@teranga.test",
    siretOrId: "NINEA 123456789",
    legalNotice: "Mention maison ZX81 de l'agence.",
  });
}

async function dossier(opts: { propertyTitle?: string; currency?: string } = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, {
    title: opts.propertyTitle ?? "Villa des Almadies",
    address: "5 avenue Cheikh Anta Diop",
    surface: 42,
  });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Ndiaye", email: "awa@test.local", phone: "0611223344" });
  const contract = await createContract(property.id, tenant.id, opts.currency ? { currency: opts.currency } : {});
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const lire = async (url: string, h: Record<string, string>) => request(app).get(url).set(h);

describe("quittance en ligne : chaque donnée au bon endroit", () => {
  it("imprime l'agence, le locataire, le logement, la période, le montant et la date de paiement", async () => {
    const { manager, contract, h } = await dossier({ currency: "XOF" });
    await agenceComplete(manager.id);
    const facture = await createInvoice(contract.id, {
      id: "facture-test-a1b2c3",
      status: "PAID",
      periodMonth: 6,
      periodYear: 2026,
      amount: 250000,
      currency: "XOF",
      paidAt: new Date("2026-06-18T10:00:00Z"),
      createdAt: new Date("2026-03-05T12:00:00Z"),
    });

    const res = await lire(`/api/documents/receipt/${facture.id}`, h);
    const html = res.text;

    expect(res.status).toBe(200);
    // Numéro : préfixe, année, mois sur deux chiffres, six DERNIERS caractères de l'identifiant en majuscules.
    expect(html).toContain("RÉF : QUITT-2026-06-A1B2C3");
    expect(html).toContain("Quittance de Loyer - N° QUITT-2026-06-A1B2C3");
    // Période : le mois ET l'année de la facture.
    expect(html).toContain("Période : <strong>Juin 2026</strong>");
    // Agence
    expect(html).toContain('<h1 class="agency-title">Agence Teranga</h1>');
    expect(html).toContain(`<img class="agency-logo" src="${URL_LOGO}"`);
    expect(html).toContain("12 rue du Port, Dakar");
    expect(html).toContain("Tél : +221 33 000 00 00");
    expect(html).toContain("Email : contact@teranga.test");
    expect(html).toContain("Identifiants légaux : NINEA 123456789");
    expect(html).toContain("Mention maison ZX81 de l&#39;agence.");
    // Locataire et logement
    expect(html).toContain("Awa Ndiaye");
    expect(html).toContain("awa@test.local");
    expect(html).toContain("0611223344");
    expect(html).toContain("Villa des Almadies");
    expect(html).toContain("5 avenue Cheikh Anta Diop");
    expect(html).toContain("Surface : 42 m²");
    // Montant dans la devise de la FACTURE, et date de PAIEMENT (pas celle de création)
    expect(html).toContain("FCFA");
    expect(html).not.toContain("€");
    // Le montant de la facture, écrit deux fois (ligne du tableau et total) puis dans la formule de quittance.
    expect(html.match(/250\s000\sFCFA/g)).toHaveLength(3);
    expect(html).toContain("Fait le <strong>18 juin 2026</strong>");
    expect(html).not.toContain("5 mars 2026");
  });

  it("sans réglages d'agence : nom par défaut ; facture sans date de paiement : date de création", async () => {
    const { contract, h } = await dossier();
    const facture = await createInvoice(contract.id, {
      status: "PAID",
      paidAt: null,
      createdAt: new Date("2026-03-05T12:00:00Z"),
    });

    const html = (await lire(`/api/documents/receipt/${facture.id}`, h)).text;

    expect(html).toContain('<h1 class="agency-title">Agence Immobilière Privée</h1>');
    expect(html).toContain("Fait le <strong>5 mars 2026</strong>");
    expect(html).not.toContain("1970");
  });

  it("un bien sans titre est présenté comme « Logement »", async () => {
    const { contract, h } = await dossier({ propertyTitle: "" });
    const facture = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const html = (await lire(`/api/documents/receipt/${facture.id}`, h)).text;

    expect(html).toContain("Logement Loué</div>");
    expect(html).toMatch(/Logement Loué<\/div>\s*<div[^>]*>Logement<\/div>/);
  });

  it("une facture non réglée est refusée avec son code", async () => {
    const { contract, h } = await dossier();
    const facture = await createInvoice(contract.id, { status: "PENDING" });

    const res = await lire(`/api/documents/receipt/${facture.id}`, h);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RECEIPT_REQUIRES_PAID");
  });

  it("le locataire reçoit la quittance au nom de l'agence du bien, pas des réglages de son propre compte", async () => {
    const { manager, tenant, contract } = await dossier();
    await agenceComplete(manager.id);
    const facture = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const res = await lire(`/api/documents/receipt/${facture.id}`, authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1 class="agency-title">Agence Teranga</h1>');
  });
});

describe("bail en ligne : chaque donnée au bon endroit", () => {
  it("imprime le bien, le locataire et l'agence ; le locataire voit l'agence du bien", async () => {
    const { manager, tenant, contract, h } = await dossier();
    await agenceComplete(manager.id);

    const html = (await lire(`/api/documents/lease/${contract.id}`, h)).text;
    expect(html).toContain("<title>Contrat de Bail - Villa des Almadies</title>");
    expect(html).toContain("Bien loué :</strong> Villa des Almadies");
    expect(html).toContain("Le Locataire :</strong> Awa Ndiaye (Email : awa@test.local");
    expect(html).toContain("Mandataire :</strong> Agence Teranga (12 rue du Port, Dakar)");

    const vuParLeLocataire = (await lire(`/api/documents/lease/${contract.id}`, authHeader(await tokenLocataire(tenant.id)))).text;
    expect(vuParLeLocataire).toContain("Mandataire :</strong> Agence Teranga");
  });

  it("sans réglages d'agence, le bailleur est « Agence Immobilière »", async () => {
    const { contract, h } = await dossier();

    const html = (await lire(`/api/documents/lease/${contract.id}`, h)).text;

    expect(html).toContain("Mandataire :</strong> Agence Immobilière");
    expect(html).not.toContain("L'Agence");
  });

  it("un bail révisé garde le loyer signé et liste chaque révision appliquée", async () => {
    const { property, tenant, h } = await dossier();
    const contract = await createContract(property.id, tenant.id, { rent: 520 });
    await testDb.insert(rentRevisions).values({
      contractId: contract.id,
      previousRent: 480,
      newRent: 520,
      effectiveDate: new Date("2026-02-01T00:00:00Z"),
      method: "AMOUNT",
      status: "APPLIED",
    });

    const html = (await lire(`/api/documents/lease/${contract.id}`, h)).text;

    expect(html).toContain("Loyer mensuel à la signature :</strong>");
    expect(html).toMatch(/480\s€/);
    expect(html).toContain("Révision à compter du 01/02/2026");
    expect(html).toMatch(/Loyer mensuel en vigueur :<\/strong> 520\s€/);
  });
});

describe("état des lieux en ligne : chaque donnée au bon endroit", () => {
  it("imprime la référence, le type, la date, les parties, les relevés, les clés, les commentaires et les signatures", async () => {
    const { manager, property, tenant, contract, h } = await dossier();
    await agenceComplete(manager.id);
    const dateSignature = new Date("2026-05-02T09:00:00Z");
    const inspection = await createInspection(contract, manager.id, {
      id: "edl-test-0a1b2c",
      status: "COMPLETED",
      type: "EXIT",
      inspectionDate: new Date("2026-02-14T10:00:00Z"),
      roomsData: JSON.stringify([{ name: "Séjour", condition: "BON", notes: "RAS" }]),
      metersData: JSON.stringify({ electricity: "12345", water: "678", gas: "91011" }),
      keysData: JSON.stringify([{ label: "Clé du portail", quantity: 3 }]),
      generalComments: "Peinture à reprendre.",
      managerSignatureUrl: "https://sig.test/gestionnaire.png",
      signedByManagerAt: dateSignature,
      tenantSignatureUrl: "https://sig.test/locataire.png",
      signedByTenantAt: dateSignature,
    });

    const html = (await lire(`/api/documents/inspection/${inspection.id}`, h)).text;

    expect(html).toContain("Référence :</strong> EDL-EXIT-0A1B2C");
    expect(html).toContain('<span class="badge">SORTIE</span>');
    expect(html).toContain("Date du constat :</strong> 14 février 2026");
    expect(html).toContain("Agence / Mandataire :</strong> Agence Teranga<br>");
    expect(html).toContain(`Bien :</strong> ${property.title} — ${property.address}`);
    expect(html).toContain("Locataire :</strong> Awa Ndiaye");
    expect(html).toContain("12345");
    expect(html).toContain("678");
    expect(html).toContain("91011");
    expect(html).toContain("Clé du portail — <strong>3</strong>");
    expect(html).toContain("Peinture à reprendre.");
    const jour = dateSignature.toLocaleDateString("fr-FR");
    expect(html.split(`Signé électroniquement le ${jour}`)).toHaveLength(3);
    expect(html).toContain('src="https://sig.test/gestionnaire.png" class="sig-img" alt="Signature Gestionnaire"');
    expect(html).toContain('src="https://sig.test/locataire.png" class="sig-img" alt="Signature Locataire"');
    void tenant;
  });

  it("un état des lieux d'entrée est présenté comme tel ; sans réglages d'agence, le mandataire est « Agence Immobilière »", async () => {
    const { manager, contract, h } = await dossier();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED", type: "ENTRY" });

    const html = (await lire(`/api/documents/inspection/${inspection.id}`, h)).text;

    expect(html).toContain('<span class="badge">ENTRÉE</span>');
    expect(html).toContain("Agence / Mandataire :</strong> Agence Immobilière<br>");
  });

  it("le locataire voit le constat au nom de l'agence du bien", async () => {
    const { manager, tenant, contract } = await dossier();
    await agenceComplete(manager.id);
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await lire(`/api/documents/inspection/${inspection.id}`, authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("Agence / Mandataire :</strong> Agence Teranga<br>");
  });

  it("un constat en brouillon est refusé avec son code", async () => {
    const { manager, contract, h } = await dossier();
    const inspection = await createInspection(contract, manager.id, { status: "DRAFT" });

    const res = await lire(`/api/documents/inspection/${inspection.id}`, h);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSPECTION_EXPORT_NEEDS_FINAL");
  });
});

describe("scan papier du bail : code du refus", () => {
  it("un bail sans scan répond SCANNED_CONTRACT_NOT_FOUND", async () => {
    const { contract, h } = await dossier();

    const res = await lire(`/api/documents/lease-scan/${contract.id}`, h);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SCANNED_CONTRACT_NOT_FOUND");
  });
});

describe("avenant de révision : chaque donnée au bon endroit", () => {
  async function avenant(statut = "APPLIED", currency?: string) {
    const d = await dossier(currency ? { currency } : {});
    const [revision] = await testDb
      .insert(rentRevisions)
      .values({
        contractId: d.contract.id,
        previousRent: 480,
        newRent: 520,
        effectiveDate: new Date("2026-12-01T00:00:00Z"),
        createdAt: new Date("2026-10-12T09:00:00Z"),
        method: "AMOUNT",
        status: statut,
      })
      .returning();
    return { ...d, revision };
  }

  it("imprime le bien, le locataire, l'agence, la devise du bail et la date d'établissement", async () => {
    const { manager, revision, h } = await avenant("APPLIED", "XOF");
    await agenceComplete(manager.id);

    const res = await lire(`/api/documents/rent-revision/${revision.id}`, h);
    const html = res.text;

    expect(res.status).toBe(200);
    expect(html).toContain("<title>Avenant n°1 - Villa des Almadies</title>");
    expect(html).toContain("Bien loué :</strong> Villa des Almadies");
    expect(html).toContain("Le Locataire :</strong> Awa Ndiaye");
    expect(html).toContain("Mandataire :</strong> Agence Teranga (12 rue du Port, Dakar)");
    // Devise du BAIL (XOF), pas l'euro
    expect(html).toContain("FCFA");
    expect(html).not.toContain("€");
    expect(html).toContain("Date d'effet :</strong> 01/12/2026");
    // « Établi le » : la date de CRÉATION de la révision, pas sa date d'effet
    expect(html).toContain("Établi le 12/10/2026");
  });

  it("le locataire du bail voit l'avenant au nom de l'agence du bien ; sans réglages, « Agence Immobilière »", async () => {
    const { manager, tenant, revision, h } = await avenant();

    const sansReglages = (await lire(`/api/documents/rent-revision/${revision.id}`, h)).text;
    expect(sansReglages).toContain("Mandataire :</strong> Agence Immobilière");
    expect(sansReglages).not.toContain("L'Agence");

    await agenceComplete(manager.id);
    const vuParLeLocataire = await lire(`/api/documents/rent-revision/${revision.id}`, authHeader(await tokenLocataire(tenant.id)));
    expect(vuParLeLocataire.status).toBe(200);
    expect(vuParLeLocataire.text).toContain("Mandataire :</strong> Agence Teranga");
  });

  it("un autre locataire est refusé comme devant une révision inconnue", async () => {
    const { manager, revision } = await avenant();
    const autre = await createTenant(manager.id, { firstName: "Moussa" });

    const res = await lire(`/api/documents/rent-revision/${revision.id}`, authHeader(await tokenLocataire(autre.id)));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REVISION_NOT_FOUND");
  });

  it("une révision inconnue répond REVISION_NOT_FOUND", async () => {
    const { h } = await dossier();

    const res = await lire("/api/documents/rent-revision/inconnue", h);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REVISION_NOT_FOUND");
  });

  it("une révision annulée répond 409 avec son code", async () => {
    const { revision, h } = await avenant("CANCELLED");

    const res = await lire(`/api/documents/rent-revision/${revision.id}`, h);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REVISION_CANCELLED_NO_AMENDMENT");
  });
});
