import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices, tenants, users } from "../db/schema";
import * as storageService from "../services/storage.service";
import * as reminderService from "../services/reminder.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Le droit à l'effacement se heurte, en gestion locative, à l'obligation de
 * conserver les pièces comptables : on ne peut pas détruire les quittances
 * d'un loyer réellement encaissé. `deleteTenant` refusait donc — à juste
 * titre — de supprimer un locataire dès qu'un contrat existait, ce qui ne
 * laissait aucune issue au locataire qui demande l'effacement de ses données.
 *
 * L'anonymisation est cette issue : les données qui l'IDENTIFIENT
 * disparaissent (nom, email, téléphone, pièce d'identité, compte d'accès),
 * les écritures qui doivent être conservées restent, rattachées à une fiche
 * devenue anonyme. C'est la réponse habituelle des logiciels de gestion, et
 * la seule qui honore les deux obligations à la fois.
 */
describe("Anonymisation d'un locataire", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function locataireAvecHistorique() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { idDocument: "tenants/piece-identite.jpg" });
    const contract = await createContract(property.id, tenant.id, { status: "ENDED" });
    const invoice = await createInvoice(contract.id, { status: "PAID" });
    return { manager, tenant, contract, invoice };
  }

  it("efface les données identifiantes et conserve les écritures", async () => {
    const { manager, tenant, contract, invoice } = await locataireAvecHistorique();

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/anonymiser`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);

    const [apres] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(apres.firstName).toBe("Locataire");
    expect(apres.lastName).toBe("anonymisé");
    expect(apres.phone).toBe("");
    expect(apres.idDocument).toBeNull();
    expect(apres.anonymizedAt).not.toBeNull();
    // L'adresse reste unique par agence (contrainte composite) et pointe vers
    // un domaine réservé par la RFC 2606, qui n'existera jamais : aucun envoi
    // ne peut plus atteindre qui que ce soit par accident.
    expect(apres.email).toMatch(/@supprime\.invalid$/);
    expect(apres.email).not.toBe(tenant.email);

    // Ce qui doit survivre survit.
    const [contratApres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    const [factureApres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(contratApres).toBeDefined();
    expect(factureApres.status).toBe("PAID");
  });

  it("supprime la pièce d'identité du stockage, pas seulement sa référence", async () => {
    const nettoyage = vi
      .spyOn(storageService, "deleteStorageObjectBestEffort")
      .mockResolvedValue(undefined);
    const { manager, tenant } = await locataireAvecHistorique();

    await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    expect(nettoyage).toHaveBeenCalledWith("tenants/piece-identite.jpg");
  });

  it("supprime le compte d'accès au portail, qui portait lui aussi une adresse email", async () => {
    const { manager, tenant } = await locataireAvecHistorique();
    const comptePortail = await createTenantPortalUser(tenant);

    await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    const restant = await testDb.select().from(users).where(eq(users.id, comptePortail.id));
    expect(restant).toHaveLength(0);
    const [apres] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(apres.userId).toBeNull();
  });

  it("n'écrit plus jamais à un locataire anonymisé", async () => {
    // Conséquence directe de l'anonymisation : il n'y a plus personne à qui
    // écrire. Sans ce filtre, les rappels partiraient vers une adresse
    // @supprime.invalid — un envoi qui échoue, mais surtout un traitement
    // qu'on a justement cessé d'être autorisé à faire.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2030, 0, 1),
      status: "ACTIVE",
    });
    await createInvoice(contract.id, { status: "PENDING" });
    await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    const envois = vi.spyOn(reminderService, "runRentDueReminders");
    const resultat = await reminderService.runRentDueReminders();

    expect(resultat.sent).toBe(0);
    envois.mockRestore();
  });

  it("refuse une seconde anonymisation, qui n'aurait plus rien à effacer", async () => {
    const { manager, tenant } = await locataireAvecHistorique();
    await request(app).post(`/api/tenants/${tenant.id}/anonymiser`).set(authHeader(tokenFor(manager)));

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/anonymiser`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });

  it("refuse d'anonymiser le locataire d'une autre agence", async () => {
    const { tenant } = await locataireAvecHistorique();
    const autreManager = await createManager();

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/anonymiser`)
      .set(authHeader(tokenFor(autreManager)));

    expect(res.status).toBe(404);
    const [intact] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(intact.anonymizedAt).toBeNull();
  });
});
