import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoices, properties } from "../db/schema";
import { uploadPublicFile } from "../services/storage.service";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Permet de vérifier qu'aucun upload n'est déclenché quand la vérification
// de propriété échoue (voir la régression ci-dessous).
vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  // Ajouté quand la suppression s'est mise à nettoyer le stockage : un mock
  // partiel doit exposer TOUS les exports que le contrôleur utilise, sinon
  // l'accès à l'export manquant lève une erreur au lieu d'être neutre.
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/properties — devise", () => {
  // Regression : property.controller n'a longtemps pas gere la devise du tout.
  // Un bien restait donc en EUR (valeur par defaut en base) et toute la
  // cascade avec lui, le contrat heritant du bien et la facture du contrat.
  // Un gestionnaire regle en XOF voyait ses loyers, ses quittances et ses baux
  // libelles en euros.
  it("hérite de la devise de règlement du gestionnaire", async () => {
    const manager = await createManager({ currency: "XOF" });

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Villa Ngor", address: "3 rue des Almadies", surface: 120, rent: 250000 });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("XOF");
  });

  it("respecte une devise explicitement fournie, même si elle diffère de celle du gestionnaire", async () => {
    const manager = await createManager({ currency: "XOF" });

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Appartement Paris", address: "10 rue de la Paix", surface: 40, rent: 900, currency: "EUR" });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("EUR");
  });

  it("retombe sur EUR si la devise du gestionnaire est vide", async () => {
    // users.currency est NOT NULL : une devise nulle est impossible en base,
    // et la contrainte rejette l'insertion. Le repli `|| "EUR"` n'est donc
    // atteignable qu'avec une chaîne vide — valeur qu'aucune route n'accepte
    // (le schéma exige min(1)) mais qui reste possible au niveau de la base.
    const manager = await createManager({ currency: "" });

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Studio", address: "1 rue du Test", surface: 20, rent: 300 });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("EUR");
  });

  it("propage la devise du bien au contrat, puis du contrat à la facture", async () => {
    // Vérifie la chaîne complète, le point de la régression : chaque maillon
    // hérite du précédent.
    const manager = await createManager({ currency: "XOF" });

    const bien = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Résidence Ouakam", address: "12 Corniche", surface: 90, rent: 150000 });
    expect(bien.body.currency).toBe("XOF");

    const locataire = await createTenant(manager.id);

    const contrat = await request(app)
      .post("/api/contracts")
      .set(authHeader(tokenFor(manager)))
      .send({
        propertyId: bien.body.id,
        tenantId: locataire.id,
        rent: 150000,
        deposit: 300000,
        startDate: "2026-09-01",
        endDate: "2027-09-01",
      });

    expect(contrat.status).toBe(201);
    expect(contrat.body.currency).toBe("XOF");

    const [facture] = await testDb
      .select()
      .from(invoices)
      .where(eq(invoices.contractId, contrat.body.id));
    if (facture) expect(facture.currency).toBe("XOF");
  });
});

describe("POST /api/properties", () => {
  it("crée un bien pour le gestionnaire connecté", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Studio Centre-ville", address: "10 rue de la Paix", surface: 25, rent: 400 });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Studio Centre-ville");
    expect(res.body.managerId).toBe(manager.id);
    expect(res.body.status).toBe("AVAILABLE");
  });
});

describe("GET /api/properties/:id", () => {
  it("renvoie le bien avec ses contrats pour son propriétaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(property.id);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].tenant.id).toBe(tenant.id);
  });

  it("refuse l'accès au bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/properties/:id", () => {
  it("met à jour un bien appartenant au gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rent: 650 });

    expect(res.status).toBe(200);
    expect(res.body.rent).toBe(650);
  });

  it("refuse de modifier le bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ rent: 1 });

    expect(res.status).toBe(404);
    const [unchanged] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(unchanged.rent).toBe(500);
  });

  /**
   * Régression : le statut d'un bien (AVAILABLE/OCCUPIED/MAINTENANCE) est
   * normalement géré automatiquement par le cycle de vie des contrats
   * (contract.controller.ts), mais rien n'empêchait un gestionnaire de le
   * changer à la main pendant qu'un contrat actif est en cours — un bien
   * réellement loué pouvait ainsi passer "disponible" (risque de double
   * location) ou "en maintenance" sans que le contrat en cours n'en soit
   * jamais informé.
   */
  it("refuse de changer le statut d'un bien ayant un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    // createContract insère directement en base (sans passer par l'API) : on
    // simule donc à la main l'état OCCUPIED que contract.controller.ts aurait
    // posé pour un contrat ACTIVE créé via POST /api/contracts.
    await createContract(property.id, tenant.id); // status ACTIVE par défaut
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "AVAILABLE" });

    expect(res.status).toBe(409);
    const [inchange] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(inchange.status).toBe("OCCUPIED");
  });

  it("autorise le changement de statut d'un bien sans contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "MAINTENANCE" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("MAINTENANCE");
  });

  it("autorise une modification qui ne touche pas au statut, même avec un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rent: 800 });

    expect(res.status).toBe(200);
    expect(res.body.rent).toBe(800);
    expect(res.body.status).toBe("OCCUPIED");
  });

  /**
   * Régression : createContract fige la devise sur le contrat au moment de
   * sa création (héritée du bien à cet instant), et invoice.service.ts
   * hérite ensuite du contrat — jamais du bien. Rien n'empêchait pourtant de
   * changer la devise du bien pendant qu'un contrat actif existe : le
   * contrat et ses factures restaient dans l'ancienne devise, mais le bien
   * affichait la nouvelle — un même logement dans deux devises différentes
   * sans qu'aucun montant n'ait été reconverti.
   */
  it("refuse de changer la devise d'un bien ayant un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { currency: "EUR" });
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id); // status ACTIVE par défaut
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ currency: "XOF" });

    expect(res.status).toBe(409);
    const [inchange] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(inchange.currency).toBe("EUR");
  });

  it("autorise le changement de devise d'un bien sans contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { currency: "EUR" });

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ currency: "XOF" });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("XOF");
  });
});

describe("DELETE /api/properties/:id", () => {
  it("supprime un bien sans contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remaining = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(remaining).toHaveLength(0);
  });

  it("refuse de supprimer un bien ayant un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id); // status ACTIVE par défaut

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const stillThere = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(stillThere).toHaveLength(1);
  });

  it("refuse de supprimer le bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/properties — isolation entre gestionnaires", () => {
  it("ne renvoie que les biens du gestionnaire connecté", async () => {
    const manager = await createManager();
    await createProperty(manager.id);
    await createProperty((await createManager()).id);

    const res = await request(app).get("/api/properties").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("PUT /api/properties/:id — ordre upload / vérification de propriété", () => {
  /**
   * Régression : updateProperty appelait uploadPublicFile AVANT de vérifier
   * que le bien appartient au gestionnaire connecté. Un gestionnaire pouvait
   * donc faire stocker (sur notre infrastructure, à nos frais) n'importe
   * quel fichier arbitraire en visant l'id du bien d'un AUTRE gestionnaire —
   * le 404 n'arrivait qu'après coup, une fois le fichier déjà uploadé sans
   * jamais être utilisé nulle part.
   */
  it("n'uploade jamais l'image quand le bien n'appartient pas au gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const intrus = await createManager();

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(intrus)))
      .attach("image", Buffer.from("contenu-image-factice"), "photo.png");

    expect(res.status).toBe(404);
    expect(uploadPublicFile).not.toHaveBeenCalled();
  });
});

describe("POST /api/properties — plafond de biens par formule", () => {
  // Regression (audit sept. 2026) : createProperty n'a longtemps vérifié
  // aucune limite, alors que les CGU en annoncent une par formule (Starter 5
  // biens). Un gestionnaire pouvait donc créer un nombre illimité de biens
  // sans jamais payer la formule supérieure.
  it("refuse la création au-delà de la limite Starter (5 biens)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    for (let i = 0; i < 5; i++) {
      await createProperty(manager.id, { title: `Bien ${i}` });
    }

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Bien de trop", address: "1 rue du Test", surface: 30, rent: 400 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/limite/i);
  });

  it("autorise la création tant que la limite Starter n'est pas atteinte", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    for (let i = 0; i < 4; i++) {
      await createProperty(manager.id, { title: `Bien ${i}` });
    }

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "5e bien", address: "1 rue du Test", surface: 30, rent: 400 });

    expect(res.status).toBe(201);
  });

  it("n'applique aucune limite pour la formule Entreprise (illimitée)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    for (let i = 0; i < 6; i++) {
      await createProperty(manager.id, { title: `Bien ${i}` });
    }

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "7e bien", address: "1 rue du Test", surface: 30, rent: 400 });

    expect(res.status).toBe(201);
  });

  // La formule enregistrée à l'inscription est Starter, mais les CGU
  // promettent l'accès aux fonctionnalités de la formule Pro pendant les 15
  // jours d'essai — la limite appliquée pendant l'essai doit donc être celle
  // de Pro (25), pas celle de Starter (5).
  it("applique la limite Pro (25) pendant l'essai gratuit, même si la formule enregistrée est Starter", async () => {
    const manager = await createManager({
      subscriptionStatus: "TRIAL",
      subscriptionPlan: "STARTER",
      trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    for (let i = 0; i < 5; i++) {
      await createProperty(manager.id, { title: `Bien ${i}` });
    }

    // Au-delà de la limite Starter (5), mais toujours sous la limite Pro (25).
    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "6e bien", address: "1 rue du Test", surface: 30, rent: 400 });

    expect(res.status).toBe(201);
  });
});
