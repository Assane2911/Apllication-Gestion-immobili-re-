import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, properties } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Clore un bail et relibérer le bien sont UNE décision, pas deux.
 *
 * updateContract les écrivait séparément. Si la seconde échouait, le contrat
 * était terminé mais le bien restait OCCUPIED : absent de la liste des biens
 * disponibles, donc impossible à relouer, sans qu'aucun message ne le signale.
 * Et rien ne rattrapait l'état — il aurait fallu rouvrir puis reclore le
 * contrat pour repasser par ce chemin.
 */
describe("PUT /api/contracts/:id — atomicité", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function baseLouee() {
    const manager = await createManager();
    const property = await createProperty(manager.id, { status: "OCCUPIED" });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });
    return { manager, property, contract };
  }

  it("regroupe la clôture du bail et la libération du bien dans UNE transaction", async () => {
    const { manager, contract } = await baseLouee();
    const espion = vi.spyOn(testDb, "transaction");

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "ENDED" });

    expect(res.status).toBe(200);
    expect(espion).toHaveBeenCalled();
  });

  it("libère bien le bien quand le dernier bail actif se termine", async () => {
    const { manager, property, contract } = await baseLouee();

    await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "ENDED" });

    const [apres] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(apres.status).toBe("AVAILABLE");
  });

  it("ne libère pas un bien qui porte encore un bail actif", async () => {
    const { manager, property, contract } = await baseLouee();
    const autreLocataire = await createTenant(manager.id);
    await createContract(property.id, autreLocataire.id, { status: "ACTIVE" });

    await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "ENDED" });

    const [apres] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(apres.status).toBe("OCCUPIED");
  });

  it("ne laisse AUCUNE des deux écritures si la seconde échoue", async () => {
    // Le cœur de la régression. On fait échouer la libération du bien : le
    // contrat ne doit pas rester terminé pour autant, sans quoi le bien
    // resterait occupé à jamais.
    const { manager, property, contract } = await baseLouee();

    // L'échec est injecté DANS la transaction, après que son contenu a été
    // exécuté : c'est la situation réelle qu'on veut reproduire — la première
    // écriture a abouti, la suite échoue. Intercepter testDb.update ne
    // marcherait pas, le contrôleur écrivant via l'objet de transaction.
    const transaction = testDb.transaction.bind(testDb);
    vi.spyOn(testDb, "transaction").mockImplementation((async (callback: (tx: unknown) => Promise<unknown>) =>
      transaction(async (tx: unknown) => {
        await callback(tx);
        throw new Error("écriture du bien interrompue");
      })) as unknown as typeof testDb.transaction);

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "ENDED" });

    expect(res.status).toBeGreaterThanOrEqual(500);
    vi.restoreAllMocks();

    const [contratApres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    const [bienApres] = await testDb.select().from(properties).where(eq(properties.id, property.id));

    // Les deux sont revenus à leur état d'origine, ensemble.
    expect(contratApres.status).toBe("ACTIVE");
    expect(bienApres.status).toBe("OCCUPIED");
  });
});
