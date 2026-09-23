import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { tenants, users } from "../db/schema";
import { uploadPrivateFile } from "../services/storage.service";
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
  uploadPrivateFile: vi.fn().mockResolvedValue("tenants/mock-document.pdf"),
  getSignedUrl: vi.fn().mockResolvedValue("http://test.local/signed/mock-document.pdf"),
  // Ajouté quand la suppression s'est mise à nettoyer le stockage : un mock
  // partiel doit exposer TOUS les exports que le contrôleur utilise, sinon
  // l'accès à l'export manquant lève une erreur au lieu d'être neutre.
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/tenants", () => {
  it("crée une fiche locataire pour le gestionnaire connecté", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Alice", lastName: "Martin", phone: "0612345678", email: "alice@test.local" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("alice@test.local");
    expect(res.body.managerId).toBe(manager.id);
  });

  it("refuse deux locataires avec le même email chez le même gestionnaire", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { email: "dup@test.local" });

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Bis", lastName: "Repetita", phone: "0600000000", email: "dup@test.local" });

    expect(res.status).toBe(409);
  });

  it("autorise le même email pour deux locataires d'agences différentes", async () => {
    const managerA = await createManager();
    await createTenant(managerA.id, { email: "partage@test.local" });
    const managerB = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(managerB)))
      .send({ firstName: "Autre", lastName: "Agence", phone: "0611111111", email: "partage@test.local" });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/tenants/:id", () => {
  it("refuse l'accès à la fiche d'un locataire d'un autre gestionnaire", async () => {
    const tenant = await createTenant((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).get(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tenants/:id", () => {
  it("supprime un locataire sans contrat actif", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remaining = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(remaining).toHaveLength(0);
  });

  it("refuse de supprimer un locataire ayant un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id); // status ACTIVE par défaut

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
  });

  it("refuse de supprimer le locataire d'un autre gestionnaire", async () => {
    const tenant = await createTenant((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/tenants/:id/portal-account", () => {
  it("crée le compte portail du locataire (email + mot de passe) et relie les deux lignes de façon atomique", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { email: "portail@test.local" });

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(manager)))
      .send({ password: "MotDePasse123!" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("portail@test.local");

    const [createdUser] = await testDb.select().from(users).where(eq(users.email, "portail@test.local"));
    expect(createdUser).toBeDefined();
    expect(createdUser.role).toBe("TENANT");

    const [updatedTenant] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(updatedTenant.userId).toBe(createdUser.id);
  });

  it("refuse de créer un compte portail si un compte existe déjà pour cet email", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { email: "manager-existe-deja@test.local" });
    // Un compte (par ex. un autre gestionnaire) utilise déjà cet email.
    await createManager({ email: "manager-existe-deja@test.local" });

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(manager)))
      .send({ password: "MotDePasse123!" });

    expect(res.status).toBe(409);
  });

  it("refuse de créer un compte portail pour le locataire d'un autre gestionnaire", async () => {
    const tenant = await createTenant((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ password: "MotDePasse123!" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/tenants — isolation entre gestionnaires", () => {
  it("ne renvoie que les locataires du gestionnaire connecté", async () => {
    const manager = await createManager();
    await createTenant(manager.id);
    await createTenant((await createManager()).id);

    const res = await request(app).get("/api/tenants").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("PUT /api/tenants/:id — ordre upload / vérification de propriété", () => {
  /**
   * Régression : updateTenant appelait uploadPrivateFile AVANT de vérifier
   * que le locataire appartient au gestionnaire connecté. Un gestionnaire
   * pouvait donc faire stocker (sur notre infrastructure, à nos frais)
   * n'importe quel fichier arbitraire en visant l'id du locataire d'un AUTRE
   * gestionnaire — le 404 n'arrivait qu'après coup, une fois le fichier déjà
   * uploadé sans jamais être utilisé nulle part.
   */
  it("n'uploade jamais la pièce d'identité quand le locataire n'appartient pas au gestionnaire connecté", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const intrus = await createManager();

    const res = await request(app)
      .put(`/api/tenants/${tenant.id}`)
      .set(authHeader(tokenFor(intrus)))
      .attach("idDocument", Buffer.from("contenu-document-factice"), "cni.pdf");

    expect(res.status).toBe(404);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });
});
