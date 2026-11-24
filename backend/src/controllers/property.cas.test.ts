import { and, eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, properties } from "../db/schema";
import { deleteStorageObjectBestEffort, uploadPublicFile } from "../services/storage.service";
import {
  authHeader,
  createContract,
  createExpense,
  createManager,
  createOwner,
  createProperty,
  createTenant,
  fakeJpegBuffer,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de property.controller.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les gaps étaient de quatre sortes : les bornes du schéma (titre, adresse, surface, loyer, statut, propriétaire), la
 * liste (ordre, pagination, total), les CODES d'erreur que le frontend traduit (les tests ne regardaient que le statut
 * HTTP), et la portée des contrôles (un contrat ou une dépense d'un AUTRE bien ne doit rien bloquer ; un contrat clos ne
 * verrouille pas le statut ; changer un champ pour la même valeur n'est pas un changement).
 */

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.mocked(uploadPublicFile).mockClear();
  vi.mocked(deleteStorageObjectBestEffort).mockReset().mockResolvedValue(undefined);
});

async function agence(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", ...overrides });
  return { manager, h: authHeader(tokenFor(manager)) };
}
const corps = (extra: Record<string, unknown> = {}) => ({ title: "Villa Ngor", address: "12 rue du Port", surface: 80, rent: 600, ...extra });
const journal = (managerId: string, action: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

/* ───────────────────────────── Schéma ───────────────────────────── */

describe("création d'un bien : bornes du schéma", () => {
  it.each([
    ["un titre d'un caractère", { title: "A" }, 400],
    ["un titre de deux caractères", { title: "AB" }, 201],
    ["une adresse d'un caractère", { address: "A" }, 400],
    ["une adresse de deux caractères", { address: "AB" }, 201],
    ["une surface nulle", { surface: 0 }, 400],
    ["un loyer nul", { rent: 0 }, 400],
    ["le statut OCCUPIED", { status: "OCCUPIED" }, 201],
    ["un identifiant de propriétaire vide", { ownerId: "" }, 400],
  ])("%s : %i", async (_cas, extra, statut) => {
    const { h } = await agence();

    const res = await request(app).post("/api/properties").set(h).send(corps(extra));

    expect(res.status).toBe(statut);
  });

  it("le statut OCCUPIED est conservé", async () => {
    const { h } = await agence();

    const res = await request(app).post("/api/properties").set(h).send(corps({ status: "OCCUPIED" }));

    expect(res.body.status).toBe("OCCUPIED");
  });

  it("un identifiant de propriétaire null dissocie le bien de son propriétaire", async () => {
    const { manager, h } = await agence();
    const proprietaire = await createOwner(manager.id);
    const bien = await createProperty(manager.id, { ownerId: proprietaire.id });

    const res = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ ownerId: null });

    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBeNull();
  });
});

describe("propriétaire associé à un bien", () => {
  it("un propriétaire inconnu ou d'un autre gestionnaire est refusé en 400 avec son code, à la création comme à la modification", async () => {
    const { manager, h } = await agence();
    const autre = await agence();
    const etranger = await createOwner(autre.manager.id);
    const bien = await createProperty(manager.id);

    for (const ownerId of ["inconnu", etranger.id]) {
      const creation = await request(app).post("/api/properties").set(h).send(corps({ ownerId }));
      expect([creation.status, creation.body.code]).toEqual([400, "PROPERTY_OWNER_INVALID"]);

      const modification = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ ownerId });
      expect([modification.status, modification.body.code]).toEqual([400, "PROPERTY_OWNER_INVALID"]);
    }
  });

  it("un propriétaire du gestionnaire est accepté, à la création comme à la modification", async () => {
    const { manager, h } = await agence();
    const proprietaire = await createOwner(manager.id);
    const bien = await createProperty(manager.id);

    const creation = await request(app).post("/api/properties").set(h).send(corps({ ownerId: proprietaire.id }));
    expect(creation.status).toBe(201);
    expect(creation.body.ownerId).toBe(proprietaire.id);

    const modification = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ ownerId: proprietaire.id });
    expect(modification.status).toBe(200);
    expect(modification.body.ownerId).toBe(proprietaire.id);
  });
});

/* ───────────────────────────── Liste et lecture ───────────────────────────── */

describe("liste des biens", () => {
  it("ne montre et ne compte que les biens du gestionnaire, du plus récent au plus ancien, page par page", async () => {
    const { manager, h } = await agence();
    const autre = await agence();
    const ancien = await createProperty(manager.id, { title: "Ancien", createdAt: new Date("2026-01-01T00:00:00Z") });
    const milieu = await createProperty(manager.id, { title: "Milieu", createdAt: new Date("2026-02-01T00:00:00Z") });
    const recent = await createProperty(manager.id, { title: "Récent", createdAt: new Date("2026-03-01T00:00:00Z") });
    await createProperty(autre.manager.id, { title: "D'un autre" });

    const page1 = await request(app).get("/api/properties?pageSize=2").set(h);
    expect(page1.status).toBe(200);
    expect(ids(page1.body.items)).toEqual([recent.id, milieu.id]);
    expect(page1.body.total).toBe(3);

    const page2 = await request(app).get("/api/properties?pageSize=2&page=2").set(h);
    expect(ids(page2.body.items)).toEqual([ancien.id]);
    expect(page2.body.total).toBe(3);
  });
});

describe("lecture d'un bien", () => {
  it("le bien d'un autre gestionnaire répond PROPERTY_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const bien = await createProperty(autre.manager.id);

    const res = await request(app).get(`/api/properties/${bien.id}`).set(h);

    expect([res.status, res.body.code]).toEqual([404, "PROPERTY_NOT_FOUND"]);
  });

  it("rend les baux de CE bien seulement, du plus récent au plus ancien", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id);
    const autreBien = await createProperty(manager.id, { title: "Autre bien" });
    const locataire = await createTenant(manager.id);
    const ancien = await createContract(bien.id, locataire.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01"), createdAt: new Date("2025-01-01T00:00:00Z") });
    const recent = await createContract(bien.id, locataire.id, { status: "ENDED", startDate: jour("2025-01-01"), endDate: jour("2026-01-01"), createdAt: new Date("2026-01-01T00:00:00Z") });
    await createContract(autreBien.id, locataire.id, { status: "ENDED", startDate: jour("2025-01-01"), endDate: jour("2026-01-01") });

    const res = await request(app).get(`/api/properties/${bien.id}`).set(h);

    expect(res.status).toBe(200);
    expect(ids(res.body.contracts)).toEqual([recent.id, ancien.id]);
  });
});

/* ───────────────────────────── Création : plafond, image, journal ───────────────────────────── */

describe("plafond de biens de la formule", () => {
  it("au plafond de la formule, le refus porte son code, le plafond et sa phrase ; les biens des autres gestionnaires ne comptent pas", async () => {
    const { manager, h } = await agence({ subscriptionPlan: "STARTER" });
    const autre = await agence();
    for (let i = 0; i < 5; i++) await createProperty(manager.id, { title: `Bien ${i}` });
    for (let i = 0; i < 5; i++) await createProperty(autre.manager.id, { title: `Autre ${i}` });

    const refus = await request(app).post("/api/properties").set(h).send(corps());
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe("PROPERTY_LIMIT_REACHED");
    expect(refus.body.params).toEqual({ max: 5 });
    expect(refus.body.error).toContain("Limite de 5 biens");

    const neuf = await agence({ subscriptionPlan: "STARTER" });
    const accepte = await request(app).post("/api/properties").set(neuf.h).send(corps());
    expect(accepte.status).toBe(201);
  });
});

describe("image d'un bien", () => {
  const joindre = (r: request.Test) => r.attach("image", fakeJpegBuffer("photo"), { filename: "photo.jpg", contentType: "image/jpeg" });

  it("à la création, l'image est envoyée dans le dossier des biens et son adresse est enregistrée", async () => {
    const { h } = await agence();

    const res = await joindre(request(app).post("/api/properties").set(h).field("title", "Villa Ngor").field("address", "12 rue du Port").field("surface", "80").field("rent", "600"));

    expect(res.status).toBe(201);
    expect(vi.mocked(uploadPublicFile).mock.calls[0][1]).toBe("properties");
    expect(res.body.imageUrl).toBe("http://test.local/mock-image.png");
  });

  it("à la modification, l'image est envoyée dans le dossier des biens ; sans nouvelle image, l'ancienne reste", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { imageUrl: "http://test.local/ancienne.png" });

    const sans = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ title: "Villa rénovée" });
    expect(sans.body.imageUrl).toBe("http://test.local/ancienne.png");

    const avec = await joindre(request(app).put(`/api/properties/${bien.id}`).set(h));
    expect(vi.mocked(uploadPublicFile).mock.calls[0][1]).toBe("properties");
    expect(avec.body.imageUrl).toBe("http://test.local/mock-image.png");
  });

  it("un échec du retrait de l'ancienne image ne fait pas échouer la modification", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { imageUrl: "http://test.local/ancienne.png" });
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage coupé"));

    const res = await joindre(request(app).put(`/api/properties/${bien.id}`).set(h));

    expect(res.status).toBe(200);
  });

  it("un échec du retrait de l'image ne fait pas échouer la suppression du bien", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { imageUrl: "http://test.local/ancienne.png" });
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage coupé"));

    const res = await request(app).delete(`/api/properties/${bien.id}`).set(h);

    expect(res.status).toBe(204);
  });
});

describe("journal d'activité des biens", () => {
  it("la création, la modification et la suppression gardent le libellé et le détail", async () => {
    const { manager, h } = await agence();

    const creation = await request(app).post("/api/properties").set(h).send(corps());
    const [ajout] = await journal(manager.id, "property.create");
    expect(ajout.entityLabel).toBe("Villa Ngor");
    expect(ajout.details).toBe("Bien ajouté : Villa Ngor (12 rue du Port)");

    await request(app).put(`/api/properties/${creation.body.id}`).set(h).send({ title: "Villa rénovée" });
    const [modif] = await journal(manager.id, "property.update");
    expect(modif.entityLabel).toBe("Villa rénovée");
    expect(modif.details).toBe("Bien modifié : Villa rénovée");

    await request(app).delete(`/api/properties/${creation.body.id}`).set(h);
    const [retrait] = await journal(manager.id, "property.delete");
    expect(retrait.entityLabel).toBe("Villa rénovée");
    expect(retrait.details).toBe("Bien supprimé : Villa rénovée");
  });
});

/* ───────────────────────────── Modification : verrous ───────────────────────────── */

describe("modification d'un bien : codes et portée des verrous", () => {
  it("le bien d'un autre gestionnaire répond PROPERTY_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const bien = await createProperty(autre.manager.id);

    const res = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ title: "Piraté" });

    expect([res.status, res.body.code]).toEqual([404, "PROPERTY_NOT_FOUND"]);
  });

  it("sous un bail actif, renvoyer le même statut ou la même devise n'est pas un changement", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { status: "OCCUPIED", currency: "EUR" });
    const locataire = await createTenant(manager.id);
    await createContract(bien.id, locataire.id, { status: "ACTIVE" });

    const res = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ status: "OCCUPIED", currency: "EUR", title: "Même chose" });

    expect(res.status).toBe(200);
  });

  it("sous un bail actif, changer le statut ou la devise est refusé avec le code de chacun", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { status: "OCCUPIED", currency: "EUR" });
    const locataire = await createTenant(manager.id);
    await createContract(bien.id, locataire.id, { status: "ACTIVE" });

    const statut = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ status: "MAINTENANCE" });
    expect([statut.status, statut.body.code]).toEqual([409, "PROPERTY_ACTIVE_CONTRACT_STATUS"]);

    const devise = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ currency: "XOF" });
    expect([devise.status, devise.body.code]).toEqual([409, "PROPERTY_ACTIVE_CONTRACT_CURRENCY"]);
  });

  it("un bail clos ne verrouille rien, ni un bail actif sur un AUTRE bien", async () => {
    const { manager, h } = await agence();
    const bien = await createProperty(manager.id, { status: "AVAILABLE", currency: "EUR" });
    const autreBien = await createProperty(manager.id, { title: "Autre bien" });
    const locataire = await createTenant(manager.id);
    await createContract(bien.id, locataire.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01") });
    await createContract(autreBien.id, locataire.id, { status: "ACTIVE" });

    const res = await request(app).put(`/api/properties/${bien.id}`).set(h).send({ status: "MAINTENANCE", currency: "XOF" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("MAINTENANCE");
    expect(res.body.currency).toBe("XOF");
  });
});

/* ───────────────────────────── Suppression ───────────────────────────── */

describe("suppression d'un bien : codes et portée des verrous", () => {
  it("le bien d'un autre gestionnaire répond PROPERTY_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const bien = await createProperty(autre.manager.id);

    const res = await request(app).delete(`/api/properties/${bien.id}`).set(h);

    expect([res.status, res.body.code]).toEqual([404, "PROPERTY_NOT_FOUND"]);
  });

  it("un bail actif bloque avec son code ; un seul bail clos suffit à bloquer, avec le code de l'historique", async () => {
    const { manager, h } = await agence();
    const locataire = await createTenant(manager.id);
    const actif = await createProperty(manager.id, { title: "Bien actif" });
    const clos = await createProperty(manager.id, { title: "Bien clos" });
    await createContract(actif.id, locataire.id, { status: "ACTIVE" });
    await createContract(clos.id, locataire.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01") });

    const bailActif = await request(app).delete(`/api/properties/${actif.id}`).set(h);
    expect([bailActif.status, bailActif.body.code]).toEqual([409, "PROPERTY_HAS_ACTIVE_CONTRACT"]);

    const historique = await request(app).delete(`/api/properties/${clos.id}`).set(h);
    expect([historique.status, historique.body.code]).toEqual([409, "PROPERTY_HAS_CONTRACT_HISTORY"]);
  });

  it("les baux et les dépenses d'un AUTRE bien ne bloquent pas la suppression ; les siennes, si, avec leur code", async () => {
    const { manager, h } = await agence();
    const locataire = await createTenant(manager.id);
    const libre = await createProperty(manager.id, { title: "Bien libre" });
    const occupe = await createProperty(manager.id, { title: "Bien occupé" });
    const avecDepense = await createProperty(manager.id, { title: "Bien avec dépense" });
    await createContract(occupe.id, locataire.id, { status: "ACTIVE" });
    await createExpense(avecDepense.id);

    const depense = await request(app).delete(`/api/properties/${avecDepense.id}`).set(h);
    expect([depense.status, depense.body.code]).toEqual([409, "PROPERTY_HAS_EXPENSES"]);

    const res = await request(app).delete(`/api/properties/${libre.id}`).set(h);
    expect(res.status).toBe(204);
    expect(await testDb.select().from(properties).where(eq(properties.id, libre.id))).toEqual([]);
  });
});
