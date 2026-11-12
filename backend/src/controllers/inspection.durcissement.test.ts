import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { inspections } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { authHeader, createContract, createInspection, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";

const SIGNATURE = "data:image/png;base64," + "A".repeat(2000);

async function setup() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, tenant, contract };
}

async function ligne(id: string) {
  const [row] = await testDb.select().from(inspections).where(eq(inspections.id, id));
  return row;
}

describe("États des lieux — les signatures (images) ne voyagent pas dans les réponses de l'API", () => {
  it("la liste, le détail et la création ne renvoient pas les images de signature, seulement la date de signature", async () => {
    const { manager, contract } = await setup();
    const edl = await createInspection(contract, manager.id, {
      status: "COMPLETED",
      signedByManagerAt: new Date(),
      managerSignatureUrl: SIGNATURE,
      signedByTenantAt: new Date(),
      tenantSignatureUrl: SIGNATURE,
    });

    const liste = await request(app).get("/api/inspections").set(authHeader(tokenFor(manager)));
    expect(liste.status).toBe(200);
    expect(liste.body.items[0].signedByManagerAt).toBeTruthy();
    expect(liste.body.items[0].signedByTenantAt).toBeTruthy();
    expect(JSON.stringify(liste.body)).not.toContain("AAAAAAAA");
    expect(liste.body.items[0]).not.toHaveProperty("managerSignatureUrl");
    expect(liste.body.items[0]).not.toHaveProperty("tenantSignatureUrl");

    const detail = await request(app).get(`/api/inspections/${edl.id}`).set(authHeader(tokenFor(manager)));
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain("AAAAAAAA");
  });

  it("le locataire ne reçoit pas non plus les images, mais voit qui a signé", async () => {
    const { manager, tenant, contract } = await setup();
    const portail = await createTenantPortalUser(tenant);
    await createInspection(contract, manager.id, {
      status: "COMPLETED",
      signedByManagerAt: new Date(),
      managerSignatureUrl: SIGNATURE,
    });

    const res = await request(app).get("/api/inspections/mine").set(authHeader(tokenFor(portail, tenant.id)));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].signedByManagerAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("AAAAAAAA");
  });

  it("la réponse à une signature ne renvoie pas l'image, mais elle est bien enregistrée et reste dans l'export", async () => {
    const { manager, tenant, contract } = await setup();
    const portail = await createTenantPortalUser(tenant);
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app)
      .post(`/api/inspections/${edl.id}/sign`)
      .set(authHeader(tokenFor(portail, tenant.id)))
      .send({ signatureDataUrl: SIGNATURE });
    expect(res.status).toBe(200);
    expect(res.body.signedByTenantAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("AAAAAAAA");

    expect((await ligne(edl.id)).tenantSignatureUrl).toBe(SIGNATURE);

    const doc = await request(app).get(`/api/documents/inspection/${edl.id}`).set(authHeader(tokenFor(manager)));
    expect(doc.status).toBe(200);
    expect(JSON.stringify(doc.body) + String(doc.text)).toContain("AAAAAAAA");
  });
});

describe("PUT /api/inspections/:id — corps vide", () => {
  it("un corps sans aucun champ ne fait pas planter le serveur : rien n'est modifié", async () => {
    const { manager, contract } = await setup();
    const edl = await createInspection(contract, manager.id);

    const res = await request(app).put(`/api/inspections/${edl.id}`).set(authHeader(tokenFor(manager))).send({});

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(edl.id);
    expect(res.body.status).toBe("DRAFT");
  });
});

describe("PUT /api/inspections/:id — le verrou du constat finalisé tient même en cas de requêtes simultanées", () => {
  /**
   * Fait passer le constat en « finalisé » JUSTE avant que la requête n'écrive : c'est exactement ce que produit une
   * seconde requête arrivée entre la lecture du statut et l'écriture. Déterministe, sans dépendre de l'ordonnancement.
   */
  function finaliserJusteAvantLEcriture(id: string, avecSignature = false) {
    const origine = testDb.update.bind(testDb);
    return vi.spyOn(testDb, "update").mockImplementationOnce(((table: typeof inspections) => {
      const constructeur = origine(table);
      return {
        set: (valeurs: Record<string, unknown>) => {
          const etape = constructeur.set(valeurs as never);
          return {
            where: (condition: never) => {
              const requete = etape.where(condition);
              return {
                returning: async () => {
                  await origine(inspections)
                    .set(avecSignature ? { status: "COMPLETED", signedByTenantAt: new Date(), tenantSignatureUrl: SIGNATURE } : { status: "COMPLETED" })
                    .where(eq(inspections.id, id));
                  return requete.returning();
                },
              };
            },
          };
        },
      };
    }) as never);
  }

  it("une modification de contenu arrivée entre la lecture et l'écriture, alors que le constat vient d'être finalisé, est refusée et n'écrit rien", async () => {
    const { manager, contract } = await setup();
    const edl = await createInspection(contract, manager.id);
    const espion = finaliserJusteAvantLEcriture(edl.id);

    const res = await request(app)
      .put(`/api/inspections/${edl.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rooms: [{ name: "Salon", condition: "MAUVAIS", notes: "Ajouté après finalisation" }] });
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSPECTION_FINALIZED_LOCKED");
    const apres = await ligne(edl.id);
    expect(apres.status).toBe("COMPLETED");
    expect(apres.roomsData ?? "[]").toBe("[]");
  });

  it("un retour en brouillon arrivé après une signature simultanée est refusé : le constat signé reste finalisé", async () => {
    const { manager, contract } = await setup();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });
    const espion = finaliserJusteAvantLEcriture(edl.id, true);

    const res = await request(app)
      .put(`/api/inspections/${edl.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "DRAFT" });
    espion.mockRestore();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSPECTION_NO_REVERT");
    const apres = await ligne(edl.id);
    expect(apres.status).toBe("COMPLETED");
    expect(apres.signedByTenantAt).not.toBeNull();
  });

  it("une modification de contenu sur un constat déjà finalisé reste refusée (409) et n'écrit rien", async () => {
    const { manager, contract } = await setup();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });

    const res = await request(app)
      .put(`/api/inspections/${edl.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ generalComments: "Trop tard" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSPECTION_FINALIZED_LOCKED");
    expect((await ligne(edl.id)).generalComments).toBeNull();
  });

  it("repasser en brouillon un constat signé reste refusé (409) et le constat reste finalisé", async () => {
    const { manager, contract } = await setup();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED", signedByTenantAt: new Date(), tenantSignatureUrl: SIGNATURE });

    const res = await request(app)
      .put(`/api/inspections/${edl.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "DRAFT" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSPECTION_NO_REVERT");
    expect((await ligne(edl.id)).status).toBe("COMPLETED");
  });
});
