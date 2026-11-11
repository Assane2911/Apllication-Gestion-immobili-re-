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
  return { manager, property, tenant, contract };
}

describe("POST /api/inspections", () => {
  it("crée un état des lieux d'entrée pour un contrat du gestionnaire connecté", async () => {
    const { manager, contract } = await setup();

    const res = await request(app)
      .post("/api/inspections")
      .set(authHeader(tokenFor(manager)))
      .send({ contractId: contract.id, type: "ENTRY" });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("ENTRY");
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.rooms).toEqual([]);
  });

  it("refuse un contrat appartenant à un autre gestionnaire", async () => {
    const { contract } = await setup();
    const otherManager = await createManager();

    const res = await request(app)
      .post("/api/inspections")
      .set(authHeader(tokenFor(otherManager)))
      .send({ contractId: contract.id, type: "ENTRY" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/inspections — isolation entre gestionnaires", () => {
  it("ne renvoie que les états des lieux du gestionnaire connecté", async () => {
    const { manager, contract } = await setup();
    await createInspection(contract, manager.id);
    const { manager: otherManager, contract: otherContract } = await setup();
    await createInspection(otherContract, otherManager.id);

    const res = await request(app).get("/api/inspections").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("GET /api/inspections/:id", () => {
  it("refuse l'accès à l'état des lieux d'un autre gestionnaire", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);
    const otherManager = await createManager();

    const res = await request(app).get(`/api/inspections/${inspection.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/inspections/:id", () => {
  it("renseigne pièces, compteurs, clés et commentaires en brouillon", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({
        rooms: [{ name: "Séjour", condition: "BON", notes: "RAS" }],
        meters: { electricity: "12345", water: "6789", gas: "" },
        keys: [{ label: "Porte d'entrée", quantity: 2 }],
        generalComments: "Logement propre",
      });

    expect(res.status).toBe(200);
    expect(res.body.rooms).toEqual([{ name: "Séjour", condition: "BON", notes: "RAS" }]);
    expect(res.body.meters.electricity).toBe("12345");
    expect(res.body.keys).toEqual([{ label: "Porte d'entrée", quantity: 2 }]);
    expect(res.body.generalComments).toBe("Logement propre");
  });

  it("finalise l'état des lieux (DRAFT → COMPLETED)", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "COMPLETED" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("refuse de modifier le contenu d'un état des lieux déjà finalisé", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ generalComments: "Tentative de modification après coup" });

    expect(res.status).toBe(409);
  });

  it("refuse de repasser en brouillon un état des lieux déjà signé", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id, {
      status: "COMPLETED",
      signedByManagerAt: new Date(),
      managerSignatureUrl: "data:image/png;base64,fake",
    });

    const res = await request(app)
      .put(`/api/inspections/${inspection.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "DRAFT" });

    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/inspections/:id", () => {
  it("supprime un état des lieux encore en brouillon", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);

    const res = await request(app).delete(`/api/inspections/${inspection.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
  });

  it("refuse de supprimer un état des lieux finalisé", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app).delete(`/api/inspections/${inspection.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });
});

describe("POST /api/inspections/:id/sign", () => {
  it("refuse la signature tant que l'état des lieux n'est pas finalisé", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id);

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(manager)))
      .send({ signatureDataUrl: "data:image/png;base64,fake" });

    expect(res.status).toBe(409);
  });

  it("permet au gestionnaire de signer un état des lieux finalisé", async () => {
    const { manager, contract } = await setup();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(manager)))
      .send({ signatureDataUrl: "data:image/png;base64,fake" });

    expect(res.status).toBe(200);
    expect(res.body.signedByManagerAt).not.toBeNull();
  });

  it("permet au locataire concerné de signer un état des lieux finalisé", async () => {
    const { tenant, contract, manager } = await setup();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });
    const tenantUser = await createTenantPortalUser(tenant);

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(tenantUser, tenant.id)))
      .send({ signatureDataUrl: "data:image/png;base64,fake" });

    expect(res.status).toBe(200);
    expect(res.body.signedByTenantAt).not.toBeNull();
  });

  // Signature électronique : fonctionnalité Pro (CGU §3), même règle que
  // signContract (contract.controller.ts).
  it("refuse au gestionnaire de signer si sa formule est Starter", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(manager)))
      .send({ signatureDataUrl: "data:image/png;base64,fake" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Professionnel");
  });

  it("laisse le locataire signer même si le gestionnaire est en formule Starter", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });
    const tenantUser = await createTenantPortalUser(tenant);

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(tenantUser, tenant.id)))
      .send({ signatureDataUrl: "data:image/png;base64,fake" });

    expect(res.status).toBe(200);
  });

  it("refuse un locataire qui n'est pas celui du contrat", async () => {
    const { contract, manager } = await setup();
    const inspection = await createInspection(contract, manager.id, { status: "COMPLETED" });
    const otherTenant = await createTenant(manager.id);
    const otherTenantUser = await createTenantPortalUser(otherTenant);

    const res = await request(app)
      .post(`/api/inspections/${inspection.id}/sign`)
      .set(authHeader(tokenFor(otherTenantUser, otherTenant.id)))
      .send({ signatureDataUrl: "data:image/png;base64,fake" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/inspections/mine", () => {
  it("renvoie uniquement les états des lieux du locataire connecté", async () => {
    const { tenant, contract, manager } = await setup();
    await createInspection(contract, manager.id);
    const tenantUser = await createTenantPortalUser(tenant);

    const { contract: otherContract, manager: otherManager } = await setup();
    await createInspection(otherContract, otherManager.id);

    const res = await request(app).get("/api/inspections/mine").set(authHeader(tokenFor(tenantUser, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("GET /api/inspections/:id/comparison", () => {
  const entree = {
    type: "ENTRY" as const,
    status: "COMPLETED" as const,
    roomsData: JSON.stringify([{ name: "Salon", condition: "BON", notes: "" }, { name: "Cuisine", condition: "BON", notes: "" }]),
    metersData: JSON.stringify({ electricity: "100", water: "", gas: "" }),
    keysData: JSON.stringify([{ label: "Porte", quantity: 2 }]),
  };
  const sortie = {
    type: "EXIT" as const,
    status: "COMPLETED" as const,
    roomsData: JSON.stringify([{ name: "Salon", condition: "MAUVAIS", notes: "tache" }, { name: "Cuisine", condition: "BON", notes: "" }]),
    metersData: JSON.stringify({ electricity: "180", water: "", gas: "" }),
    keysData: JSON.stringify([{ label: "Porte", quantity: 1 }]),
  };

  it("compare la sortie avec l'entrée du même bail", async () => {
    const { manager, contract } = await setup();
    await createInspection(contract, manager.id, entree);
    const exit = await createInspection(contract, manager.id, sortie);

    const res = await request(app).get(`/api/inspections/${exit.id}/comparison`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.rooms[0]).toMatchObject({ name: "Salon", variation: "DEGRADE" });
    expect(res.body.meters).toEqual([{ type: "electricity", entry: "100", exit: "180", consumption: 80 }]);
    expect(res.body.keys[0]).toMatchObject({ label: "Porte", missing: 1 });
    expect(res.body.summary).toMatchObject({ degraded: 1, unchanged: 1, missingKeys: 1 });
  });

  it("refuse un état des lieux d'entrée (400) et un brouillon de sortie (409)", async () => {
    const { manager, contract } = await setup();
    const ent = await createInspection(contract, manager.id, entree);
    const brouillon = await createInspection(contract, manager.id, { ...sortie, status: "DRAFT" });

    const a = await request(app).get(`/api/inspections/${ent.id}/comparison`).set(authHeader(tokenFor(manager)));
    const b = await request(app).get(`/api/inspections/${brouillon.id}/comparison`).set(authHeader(tokenFor(manager)));

    expect(a.status).toBe(400);
    expect(a.body.code).toBe("INSPECTION_COMPARE_NEEDS_EXIT");
    expect(b.status).toBe(409);
    expect(b.body.code).toBe("INSPECTION_COMPARE_EXIT_NOT_FINALIZED");
  });

  it("répond 404 sans état des lieux d'entrée finalisé", async () => {
    const { manager, contract } = await setup();
    await createInspection(contract, manager.id, { ...entree, status: "DRAFT" });
    const exit = await createInspection(contract, manager.id, sortie);

    const res = await request(app).get(`/api/inspections/${exit.id}/comparison`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("INSPECTION_COMPARE_NO_ENTRY");
  });

  it("n'utilise pas l'entrée d'un autre bail", async () => {
    const { manager, contract } = await setup();
    const autre = await setup();
    await createInspection(autre.contract, autre.manager.id, entree);
    const exit = await createInspection(contract, manager.id, sortie);

    const res = await request(app).get(`/api/inspections/${exit.id}/comparison`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(404);
  });

  it("refuse l'état des lieux d'un autre gestionnaire", async () => {
    const { manager, contract } = await setup();
    await createInspection(contract, manager.id, entree);
    const exit = await createInspection(contract, manager.id, sortie);
    const intrus = await createManager();

    const res = await request(app).get(`/api/inspections/${exit.id}/comparison`).set(authHeader(tokenFor(intrus)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/contracts/:id/exit-comparison", () => {
  const entree = {
    type: "ENTRY" as const,
    status: "COMPLETED" as const,
    roomsData: JSON.stringify([{ name: "Salon", condition: "BON", notes: "" }]),
    keysData: JSON.stringify([{ label: "Porte", quantity: 2 }]),
  };
  const sortie = {
    type: "EXIT" as const,
    status: "COMPLETED" as const,
    roomsData: JSON.stringify([{ name: "Salon", condition: "MAUVAIS", notes: "tache" }]),
    keysData: JSON.stringify([{ label: "Porte", quantity: 1 }]),
  };

  it("renvoie la comparaison de la sortie finalisée la plus récente du bail", async () => {
    const { manager, contract } = await setup();
    await createInspection(contract, manager.id, entree);
    await createInspection(contract, manager.id, sortie);

    const res = await request(app).get(`/api/contracts/${contract.id}/exit-comparison`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.rooms[0]).toMatchObject({ name: "Salon", variation: "DEGRADE" });
    expect(res.body.summary).toMatchObject({ degraded: 1, missingKeys: 1 });
  });

  it("renvoie null (et non une erreur) sans sortie finalisée ou sans entrée finalisée", async () => {
    const { manager, contract } = await setup();
    const a = await request(app).get(`/api/contracts/${contract.id}/exit-comparison`).set(authHeader(tokenFor(manager)));
    await createInspection(contract, manager.id, { ...sortie, status: "DRAFT" });
    const b = await request(app).get(`/api/contracts/${contract.id}/exit-comparison`).set(authHeader(tokenFor(manager)));
    await createInspection(contract, manager.id, sortie);
    const c = await request(app).get(`/api/contracts/${contract.id}/exit-comparison`).set(authHeader(tokenFor(manager)));

    for (const r of [a, b, c]) {
      expect(r.status).toBe(200);
      expect(r.body).toBeNull();
    }
  });

  it("refuse le bail d'un autre gestionnaire", async () => {
    const { contract } = await setup();
    const intrus = await createManager();

    const res = await request(app).get(`/api/contracts/${contract.id}/exit-comparison`).set(authHeader(tokenFor(intrus)));

    expect(res.status).toBe(404);
  });
});
