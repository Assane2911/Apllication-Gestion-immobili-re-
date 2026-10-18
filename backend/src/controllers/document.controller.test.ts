import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import {
  authHeader,
  createAdmin,
  createContract,
  createInspection,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  createPortalUser,
  tokenLocataire,
} from "../test/authHelpers";

describe("GET /api/documents/receipt/:invoiceId", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/documents/receipt/whatever");
    expect(res.status).toBe(401);
  });

  it("renvoie 404 si la facture n'existe pas", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/documents/receipt/introuvable")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(404);
  });

  it("autorise le gestionnaire propriétaire du bien à récupérer la quittance", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
    expect(res.text).toContain(tenant.firstName);
  });

  it("imprime le tampon de l'agence sur la quittance en ligne, seulement s'il vient du stockage de l'application", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });
    const lire = async () =>
      (await request(app).get(`/api/documents/receipt/${invoice.id}`).set(authHeader(tokenFor(manager)))).text;

    const URL_TAMPON = "https://placeholder.supabase.co/storage/v1/object/public/public-uploads/agency/tampon.png";
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence", stampOrSignatureUrl: URL_TAMPON });
    expect(await lire()).toContain(`<img class="agency-stamp" src="${URL_TAMPON}"`);

    await testDb.update(agencySettings).set({ stampOrSignatureUrl: "https://tiers.example/pixel.png" });
    expect(await lire()).not.toContain('<img class="agency-stamp"');
  });

  it("affiche le moyen de paiement en clair sur la quittance en ligne, comme sur celle du courriel", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const virement = await createInvoice(contract.id, { status: "PAID", paidAt: new Date(), paymentMethod: "BANK_TRANSFER" });
    const sansMoyen = await createInvoice(contract.id, { status: "PAID", paidAt: new Date(), periodMonth: 7, paymentMethod: null });

    const lire = async (id: string) =>
      (await request(app).get(`/api/documents/receipt/${id}`).set(authHeader(tokenFor(manager)))).text;

    const quittance = await lire(virement.id);
    expect(quittance).toContain("Virement bancaire");
    expect(quittance).not.toContain("BANK_TRANSFER");

    const inconnue = await lire(sansMoyen.id);
    expect(inconnue).toContain("Non précisé");
    expect(inconnue).not.toContain("VIREMENT");
  });

  it("annonce les jours réellement couverts quand le loyer est facturé au prorata", async () => {
    // Une quittance atteste juridiquement d'un loyer réglé pour une période
    // donnée. Depuis le passage au prorata, un bail démarrant en cours de mois
    // ne paie que ses jours : annoncer « Juin 2026 » tout court rendrait le
    // document faux.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 5, 16),
      endDate: new Date(2027, 5, 15),
    });
    const invoice = await createInvoice(contract.id, {
      periodMonth: 6,
      periodYear: 2026,
      amount: 250,
      status: "PAID",
      paidAt: new Date(2026, 5, 20),
    });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("du 16 au 30");
  });

  it("n'ajoute aucune mention de jours pour un mois entier", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 11, 31),
    });
    const invoice = await createInvoice(contract.id, {
      periodMonth: 6,
      periodYear: 2026,
      status: "PAID",
      paidAt: new Date(2026, 5, 20),
    });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("du 1 au 30");
  });

  it("refuse l'accès à un gestionnaire qui n'est pas propriétaire du bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id);

    const otherManager = await createManager();
    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(403);
  });

  it("autorise le locataire concerné à récupérer sa propre quittance", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
  });

  it("refuse l'accès à un autre locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id);

    const otherTenant = await createTenant(manager.id);
    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(await tokenLocataire(otherTenant.id)));

    expect(res.status).toBe(403);
  });

  it("refuse de générer une quittance pour une facture impayée (statut PENDING)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PENDING" });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("PAID");
  });

  /**
   * Régression : le contrôle d'accès (deux `if` indépendants, un pour TENANT,
   * un pour MANAGER) laissait passer silencieusement tout autre rôle — un
   * compte ADMIN pouvait ainsi récupérer la quittance de n'importe quel
   * locataire de n'importe quel gestionnaire de la plateforme.
   */
  it("interdit l'accès à un administrateur", async () => {
    const manager = await createManager();
    const admin = await createAdmin();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/documents/lease/:contractId", () => {
  it("renvoie 404 si le contrat n'existe pas", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/documents/lease/introuvable")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(404);
  });

  it("autorise le gestionnaire propriétaire du bien à récupérer le bail", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
  });

  it("refuse l'accès à un gestionnaire qui n'est pas propriétaire du bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const otherManager = await createManager();
    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(403);
  });

  it("imprime les clauses particulières du contrat sur le bail", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { terms: "Animaux interdits.\nSous-location prohibée." });

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("4. Clauses particulières");
    expect(res.text).toContain("Animaux interdits.<br>Sous-location prohibée.");
  });

  it("n'affiche aucune section de clauses pour un contrat qui n'en a pas", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.text).not.toContain("Clauses particulières");
  });

  it("autorise le locataire concerné à récupérer son propre bail", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
  });

  it("refuse l'accès à un autre locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const otherTenant = await createTenant(manager.id);
    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(await tokenLocataire(otherTenant.id)));

    expect(res.status).toBe(403);
  });

  it("interdit l'accès à un administrateur", async () => {
    const manager = await createManager();
    const admin = await createAdmin();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease/${contract.id}`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/documents/lease-scan/:contractId", () => {
  it("renvoie 404 si le contrat n'a pas de scan papier", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(404);
  });

  it("renvoie l'URL signée pour le gestionnaire propriétaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it("renvoie l'URL signée pour le locataire du contrat", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it("refuse l'accès à un gestionnaire tiers", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const property = await createProperty(managerA.id);
    const tenant = await createTenant(managerA.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(managerB)));

    expect(res.status).toBe(403);
  });

  it("interdit l'accès à un administrateur", async () => {
    const manager = await createManager();
    const admin = await createAdmin();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      scannedContractUrl: "contracts/test-scan.pdf",
    } as any);

    const res = await request(app)
      .get(`/api/documents/lease-scan/${contract.id}`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/documents/inspection/:inspectionId", () => {
  it("refuse tant que l'état des lieux n'est pas finalisé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const inspection = await createInspection(contract, manager.id);

    const res = await request(app)
      .get(`/api/documents/inspection/${inspection.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
  });

  it("renvoie le rapport HTML pour le gestionnaire propriétaire, une fois finalisé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const inspection = await createInspection(contract, manager.id, {
      status: "COMPLETED",
      roomsData: JSON.stringify([{ name: "Séjour", condition: "BON", notes: "RAS" }]),
    });

    const res = await request(app)
      .get(`/api/documents/inspection/${inspection.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("ÉTAT DES LIEUX");
    expect(res.text).toContain("Séjour");
  });

  it("renvoie le rapport HTML pour le locataire concerné", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app)
      .get(`/api/documents/inspection/${inspection.id}`)
      .set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
  });

  it("refuse l'accès à un gestionnaire tiers", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const property = await createProperty(managerA.id);
    const tenant = await createTenant(managerA.id);
    const contract = await createContract(property.id, tenant.id);
    const inspection = await createInspection(contract, managerA.id, { status: "COMPLETED" });

    const res = await request(app)
      .get(`/api/documents/inspection/${inspection.id}`)
      .set(authHeader(tokenFor(managerB)));

    expect(res.status).toBe(403);
  });
});


/**
 * Régression : aucun de ces documents ne demandait au navigateur de ne pas le
 * conserver. Un bail (identité, garants), une quittance ou une URL signée vers
 * un contrat scanné restaient donc dans le cache du navigateur, lisibles depuis
 * un poste partagé après la déconnexion.
 */
describe("documents — pas de mise en cache", () => {
  async function cas() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/test-scan.pdf" } as any);
    const invoice = await createInvoice(contract.id, { status: "PAID", paidAt: new Date() });
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });
    return { manager, contract, invoice, inspection };
  }

  it("interdit la mise en cache de la quittance, du bail, du scan et de l'état des lieux", async () => {
    const { manager, contract, invoice, inspection } = await cas();
    for (const chemin of [
      `/api/documents/receipt/${invoice.id}`,
      `/api/documents/lease/${contract.id}`,
      `/api/documents/lease-scan/${contract.id}`,
      `/api/documents/inspection/${inspection.id}`,
    ]) {
      const res = await request(app).get(chemin).set(authHeader(tokenFor(manager)));
      expect(res.status, chemin).toBe(200);
      expect(res.headers["cache-control"], chemin).toContain("no-store");
    }
  });

  it("interdit aussi la mise en cache d'un refus", async () => {
    const { contract } = await cas();
    const intrus = await createManager();

    const res = await request(app).get(`/api/documents/lease/${contract.id}`).set(authHeader(tokenFor(intrus)));

    expect(res.status).toBe(403);
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});
