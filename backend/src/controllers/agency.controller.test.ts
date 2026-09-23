import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor,
  createPortalUser,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/agency", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/agency");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/agency")
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("crée des paramètres par défaut au premier accès", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(manager.id);
    expect(res.body.agencyName).toBe("Agence Immobilière Privée");

    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(1);
  });

  it("ne recrée pas de paramètres à un second appel", async () => {
    const manager = await createManager();
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(1);
  });

  it("renvoie des paramètres distincts pour chaque gestionnaire", async () => {
    const manager = await createManager();
    const otherManager = await createManager();
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Manager 1" });
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(otherManager)))
      .send({ agencyName: "Agence Manager 2" });

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Agence Manager 1");
  });
});

describe("PUT /api/agency", () => {
  it("crée les paramètres si aucun n'existe encore", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", phone: "+33 1 23 45 67 89" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Horizon Immobilier");
    expect(res.body.phone).toBe("+33 1 23 45 67 89");
  });

  it("met à jour les paramètres existants", async () => {
    const manager = await createManager();
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Nouveau Nom Agence", legalNotice: "SIRET 123 456 789" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Nouveau Nom Agence");
    expect(res.body.legalNotice).toBe("SIRET 123 456 789");
  });

  it("rejette une requête sans agencyName (champ requis)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ phone: "+33 1 00 00 00 00" });

    expect(res.status).toBe(400);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")))
      .send({ agencyName: "Tentative" });
    expect(res.status).toBe(403);
  });
});

/**
 * L'IBAN/BIC est montré tel quel au locataire pour lui dire où envoyer son
 * virement (voir tenant.controller / TenantInvoicesPage.tsx) : une faute de
 * frappe qui passerait la validation enverrait un locataire vers un compte
 * qui n'existe pas, sans qu'aucun message ne prévienne le gestionnaire avant
 * qu'un premier virement échoue à l'autre bout.
 */
describe("PUT /api/agency — IBAN / BIC", () => {
  it("enregistre un IBAN/BIC valides, normalisés (espaces retirés, majuscules)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", iban: "fr76 3000 6000 0112 3456 7890 189", bic: "bnpafrpp xxx" });

    expect(res.status).toBe(200);
    expect(res.body.iban).toBe("FR7630006000011234567890189");
    expect(res.body.bic).toBe("BNPAFRPPXXX");
  });

  it("rejette (400) un IBAN dont la clé de contrôle est fausse", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      // Deux chiffres inversés au milieu par rapport à un IBAN réel.
      .send({ agencyName: "Horizon Immobilier", iban: "FR76 3000 6000 0112 3456 7809 189" });

    expect(res.status).toBe(400);
    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(0);
  });

  it("rejette (400) un BIC de mauvaise longueur", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", bic: "BNPAFRP" });

    expect(res.status).toBe(400);
  });

  it("accepte une chaîne vide comme effacement du champ, sans le traiter comme invalide", async () => {
    const manager = await createManager();
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", iban: "FR7630006000011234567890189" });

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", iban: "" });

    expect(res.status).toBe(200);
    expect(res.body.iban).toBeNull();
  });
});

describe("GET /api/agency/mine (portail locataire)", () => {
  async function setupLocataire(agencyOverrides: { iban?: string; bic?: string } = {}) {
    const manager = await createManager();
    if (agencyOverrides.iban || agencyOverrides.bic) {
      await request(app)
        .put("/api/agency")
        .set(authHeader(tokenFor(manager)))
        .send({ agencyName: "Horizon Immobilier", ...agencyOverrides });
    }
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);
    const tenantToken = tokenFor(await createPortalUser("TENANT"), tenant.id);
    return { manager, tenant, tenantToken };
  }

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/agency/mine").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("renvoie l'IBAN/BIC de l'agence de son propre gestionnaire, pas d'un autre", async () => {
    const { tenantToken } = await setupLocataire({ iban: "FR7630006000011234567890189", bic: "BNPAFRPPXXX" });
    // Une autre agence, avec son propre IBAN : ne doit jamais fuiter ici.
    await setupLocataire({ iban: "DE89370400440532013000" });

    const res = await request(app).get("/api/agency/mine").set(authHeader(tenantToken));

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Horizon Immobilier");
    expect(res.body.iban).toBe("FR7630006000011234567890189");
    expect(res.body.bic).toBe("BNPAFRPPXXX");
  });

  it("renvoie null plutôt qu'une erreur quand l'agence n'a pas encore renseigné son IBAN", async () => {
    const { tenantToken } = await setupLocataire();

    const res = await request(app).get("/api/agency/mine").set(authHeader(tenantToken));

    expect(res.status).toBe(200);
    expect(res.body.iban).toBeNull();
    expect(res.body.bic).toBeNull();
  });
});
