import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createInspection,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";

async function setup() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, tenant, contract };
}

describe("POST /api/inspections/:id/sign — taille de la signature", () => {
  /**
   * Régression : signContract plafonne la signature à 500 Ko, pas signInspection.
   * Une « signature » de plusieurs Mo était stockée en base puis réinjectée
   * telle quelle dans chaque export du constat.
   */
  it("refuse une signature démesurée", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });
    const enorme = `data:image/png;base64,${"A".repeat(600_000)}`;

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(manager)))
      .send({ signatureDataUrl: enorme });

    expect(res.status).toBe(400);
  });
});

describe("PUT /api/inspections/:id — bornes de la saisie", () => {
  it("refuse des observations démesurées", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ generalComments: "x".repeat(20_001) });

    expect(res.status).toBe(400);
  });

  it("refuse un nombre de pièces déraisonnable", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);
    const rooms = Array.from({ length: 101 }, (_, i) => ({ name: `Pièce ${i}`, condition: "BON", notes: "" }));

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rooms });

    expect(res.status).toBe(400);
  });

  it("accepte un état des lieux détaillé de taille normale", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);
    const rooms = Array.from({ length: 30 }, (_, i) => ({ name: `Pièce ${i}`, condition: "MOYEN", notes: "n".repeat(500) }));

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rooms, generalComments: "g".repeat(5000), keys: [{ label: "Porte d'entrée", quantity: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.rooms).toHaveLength(30);
  });
});

describe("GET /api/inspections/mine — brouillon", () => {
  /**
   * Régression : un état des lieux encore en brouillon était renvoyé au locataire
   * avec tout son contenu — observations et remarques sur l'état des pièces
   * qui peuvent encore changer, alors que l'application ne lui affiche que
   * « en attente de finalisation ».
   */
  it("ne montre pas au locataire le contenu d'un brouillon", async () => {
    const { tenant, contract, manager } = await setup();
    await createInspection(contract, manager.id, {
      roomsData: JSON.stringify([{ name: "Salon", condition: "MAUVAIS", notes: "Tache d'humidité" }]),
      metersData: JSON.stringify({ electricity: "12345", water: "", gas: "" }),
      keysData: JSON.stringify([{ label: "Cave", quantity: 1 }]),
      generalComments: "Brouillon interne",
    });
    const tenantUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/inspections/mine").set(authHeader(tokenFor(tenantUser, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("DRAFT");
    expect(res.body[0].rooms).toEqual([]);
    expect(res.body[0].keys).toEqual([]);
    expect(res.body[0].meters).toEqual({ electricity: "", water: "", gas: "" });
    expect(res.body[0].generalComments).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("humidité");
    expect(JSON.stringify(res.body)).not.toContain("Brouillon interne");
  });

  it("montre au locataire le contenu d'un état des lieux finalisé", async () => {
    const { tenant, contract, manager } = await setup();
    await createInspection(contract, manager.id, {
      status: "COMPLETED",
      roomsData: JSON.stringify([{ name: "Salon", condition: "BON", notes: "" }]),
      generalComments: "RAS",
    });
    const tenantUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/inspections/mine").set(authHeader(tokenFor(tenantUser, tenant.id)));

    expect(res.body[0].rooms).toHaveLength(1);
    expect(res.body[0].generalComments).toBe("RAS");
  });
});
