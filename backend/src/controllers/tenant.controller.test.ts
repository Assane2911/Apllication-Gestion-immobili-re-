import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { tenants, users } from "../db/schema";
import { uploadPrivateFile } from "../services/storage.service";
import {
  authHeader,
  createContract,
  createInvoice,
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
      .send({ firstName: "Alice", lastName: "Martin", phone: "+33 6 12 34 56 78", email: "alice@test.local" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("alice@test.local");
    expect(res.body.managerId).toBe(manager.id);
  });

  it("enregistre le numéro au format international, espaces retirés", async () => {
    // Ce n'est pas de la cosmétique : c'est le seul format que l'API WhatsApp
    // accepte. Le normaliser à l'entrée, plutôt qu'à chaque envoi, évite que
    // deux fiches saisies différemment se comportent différemment.
    const manager = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Awa", lastName: "Diallo", phone: "+221 77 842 29 93", email: "awa@test.local" });

    expect(res.status).toBe(201);
    expect(res.body.phone).toBe("+221778422993");
  });

  it("refuse un numéro sans indicatif de pays, plutôt que d'en inventer un", async () => {
    // « 0612345678 » a longtemps été accepté, puis silencieusement ignoré au
    // moment d'envoyer le rappel WhatsApp : le locataire ne recevait rien et
    // personne ne savait pourquoi. Refuser à la saisie rend la cause visible
    // là où elle se corrige. Deviner « France » parce que le numéro commence
    // par 06 enverrait le rappel à un inconnu.
    const manager = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Sans", lastName: "Indicatif", phone: "0612345678", email: "sans@test.local" });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/indicatif/i);
  });

  it("refuse deux locataires avec le même email chez le même gestionnaire", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { email: "dup@test.local" });

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Bis", lastName: "Repetita", phone: "+221778422993", email: "dup@test.local" });

    expect(res.status).toBe(409);
  });

  it("autorise le même email pour deux locataires d'agences différentes", async () => {
    const managerA = await createManager();
    await createTenant(managerA.id, { email: "partage@test.local" });
    const managerB = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(managerB)))
      .send({ firstName: "Autre", lastName: "Agence", phone: "+221771111111", email: "partage@test.local" });

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

describe("GET /api/tenants/:id — score de fiabilité", () => {
  it("renvoie un score nul et le niveau 'insuffisant' sous le seuil minimum de factures échues", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const property = await createProperty(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 6,
      dueDate: new Date(2026, 5, 20),
      status: "PAID",
      paidAt: new Date(2026, 5, 10),
    });

    const res = await request(app).get(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.fiabilite).toEqual({
      payeATemps: 1,
      payeEnRetard: 0,
      enRetardActuel: 0,
      score: null,
      niveau: "insuffisant",
    });
  });

  it("calcule le score à partir des factures échues de TOUS les contrats du locataire (passés et en cours), en ignorant celles pas encore échues ou annulées", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const ancienLogement = await createProperty(manager.id);
    const logementActuel = await createProperty(manager.id);
    const ancienContrat = await createContract(ancienLogement.id, tenant.id, { status: "ENDED" });
    const contratActuel = await createContract(logementActuel.id, tenant.id);

    // 2 factures payées à temps (ancien logement), puis sur le logement actuel :
    // 1 payée en retard, 1 actuellement impayée, 1 pas encore échue (PENDING)
    // et 1 annulée — ces deux dernières ne doivent pas entrer dans le calcul.
    await createInvoice(ancienContrat.id, { periodMonth: 1, dueDate: new Date(2026, 0, 5), status: "PAID", paidAt: new Date(2026, 0, 5) });
    await createInvoice(ancienContrat.id, { periodMonth: 2, dueDate: new Date(2026, 1, 5), status: "PAID", paidAt: new Date(2026, 1, 4) });
    await createInvoice(contratActuel.id, { periodMonth: 3, dueDate: new Date(2026, 2, 5), status: "PAID", paidAt: new Date(2026, 2, 10) });
    await createInvoice(contratActuel.id, { periodMonth: 4, dueDate: new Date(2026, 3, 5), status: "LATE" });
    await createInvoice(contratActuel.id, { periodMonth: 5, dueDate: new Date(2099, 0, 5), status: "PENDING" });
    await createInvoice(contratActuel.id, { periodMonth: 6, dueDate: new Date(2026, 5, 5), status: "CANCELLED" });

    const res = await request(app).get(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    // points = 2 (à temps) + 0,5 (en retard) = 2,5 ; total = 4 (l'impayé compte
    // pour 0 point mais fait bien partie du total) -> 2,5 / 4 = 62,5 % -> 63
    expect(res.body.fiabilite).toEqual({
      payeATemps: 2,
      payeEnRetard: 1,
      enRetardActuel: 1,
      score: 63,
      niveau: "moyen",
    });
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

  /**
   * Régression : deleteTenant ne supprime jamais le compte de connexion
   * "portail" — voir deleteMyAccount (auth.controller.ts), c'est une identité
   * qui appartient à la personne, pas à l'agence. Mais users.email est
   * UNIQUE : sans ce correctif, ce compte laissé derrière squattait l'email
   * pour toujours, et plus AUCUNE agence ne pouvait jamais recréer d'accès
   * portail pour cette même personne — un vrai cul-de-sac opérationnel, pas
   * juste une donnée orpheline inoffensive.
   */
  it("réutilise un compte TENANT orphelin (locataire précédent supprimé) plutôt que de bloquer l'email pour toujours", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { email: "reprise@test.local" });
    const [ghost] = await testDb
      .insert(users)
      .values({ email: "reprise@test.local", passwordHash: "hash-ancien", role: "TENANT", tokenVersion: 3 })
      .returning();

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(manager)))
      .send({ password: "NouveauMotDePasse123!" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(ghost.id);

    const [updatedTenant] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(updatedTenant.userId).toBe(ghost.id);

    // L'ancienne session (jeton émis avant la réattribution) ne doit pas
    // continuer à ouvrir l'accès à cette NOUVELLE relation locative.
    const [updatedUser] = await testDb.select().from(users).where(eq(users.id, ghost.id));
    expect(updatedUser.tokenVersion).toBe(4);
    expect(updatedUser.passwordHash).not.toBe("hash-ancien");
  });

  it("refuse de réutiliser un compte TENANT encore rattaché à la fiche active d'une autre agence", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { email: "conflit@test.local" });
    const autreManager = await createManager();
    const autreTenant = await createTenant(autreManager.id);
    const [autreUser] = await testDb
      .insert(users)
      .values({ email: "conflit@test.local", passwordHash: "hash", role: "TENANT" })
      .returning();
    await testDb.update(tenants).set({ userId: autreUser.id }).where(eq(tenants.id, autreTenant.id));

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(manager)))
      .send({ password: "MotDePasse123!" });

    expect(res.status).toBe(409);
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

  it("inclut le score de fiabilité de chaque locataire dans la liste paginée", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const property = await createProperty(manager.id);
    const contract = await createContract(property.id, tenant.id);
    for (let mois = 1; mois <= 3; mois++) {
      await createInvoice(contract.id, {
        periodMonth: mois,
        dueDate: new Date(2026, mois - 1, 5),
        status: "PAID",
        paidAt: new Date(2026, mois - 1, 5),
      });
    }

    const res = await request(app).get("/api/tenants").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items[0].fiabilite).toEqual({
      payeATemps: 3,
      payeEnRetard: 0,
      enRetardActuel: 0,
      score: 100,
      niveau: "excellent",
    });
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

  /**
   * Régression : createTenant appelait uploadPrivateFile AVANT de vérifier
   * qu'aucun locataire n'existait déjà avec cet email chez ce gestionnaire.
   * Soumettre deux fois la même fiche (double clic, ou simple erreur)
   * stockait un fichier à chaque tentative, à nos frais, avant que le 409 ne
   * survienne — un fichier jamais rattaché à aucune fiche, jamais nettoyé.
   */
  it("n'uploade jamais la pièce d'identité quand un locataire existe déjà avec cet email", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { email: "doublon@test.local" });

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .field("firstName", "Bis")
      .field("lastName", "Repetita")
      .field("phone", "+221778422993")
      .field("email", "doublon@test.local")
      .attach("idDocument", Buffer.from("contenu-document-factice"), "cni.pdf");

    expect(res.status).toBe(409);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });
});
