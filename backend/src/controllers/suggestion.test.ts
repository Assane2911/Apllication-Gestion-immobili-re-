import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { suggestions, users } from "../db/schema";
import { authHeader, createManager, createPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Recueillir les avis des utilisateurs sur la plateforme.
 *
 * Deux principes gouvernent ce registre, et les tests ci-dessous les tiennent
 * plutôt que de les commenter : écrire doit être facile — un champ de trop est
 * une raison de renoncer, et une idée qu'on renonce à écrire ne vaut rien — et
 * la suggestion doit survivre à son auteur, puisque c'est l'idée qu'on garde,
 * pas la personne.
 */
describe("Suggestions", () => {
  it("enregistre la suggestion d'un gestionnaire, avec la page d'où elle part", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/suggestions")
      .set(authHeader(tokenFor(manager)))
      .send({ message: "Pouvoir filtrer les factures par bien.", page: "/invoices" });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Pouvoir filtrer les factures par bien.");
    expect(res.body.page).toBe("/invoices");
    expect(res.body.authorLabel).toBe(manager.email);
  });

  it("accepte aussi un locataire : l'avis ne vient pas que des gestionnaires", async () => {
    const locataire = await createPortalUser("TENANT");

    const res = await request(app)
      .post("/api/suggestions")
      .set(authHeader(tokenFor(locataire)))
      .send({ message: "Recevoir un rappel la veille de l'échéance." });

    expect(res.status).toBe(201);
    expect(res.body.authorRole).toBe("TENANT");
  });

  it("n'exige pas la page : un client qui ne l'envoie pas n'est pas refusé", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/suggestions")
      .set(authHeader(tokenFor(manager)))
      .send({ message: "Un mode sombre plus contrasté." });

    expect(res.status).toBe(201);
    expect(res.body.page).toBeNull();
  });

  it("refuse un message vide ou quasi vide", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/suggestions")
      .set(authHeader(tokenFor(manager)))
      .send({ message: "  " });

    expect(res.status).toBe(400);
  });

  it("refuse un envoi non authentifié", async () => {
    const res = await request(app).post("/api/suggestions").send({ message: "Anonyme." });

    expect(res.status).toBe(401);
  });

  it("survit à la suppression du compte de son auteur", async () => {
    // Le point qui justifie de recopier l'email plutôt que de seulement
    // référencer le compte : l'idée reste utile quand celui qui l'a eue s'en
    // va, et une suggestion orpheline sans étiquette serait un texte anonyme
    // que plus personne ne pourrait rattacher ni recontacter.
    const manager = await createManager();
    await request(app)
      .post("/api/suggestions")
      .set(authHeader(tokenFor(manager)))
      .send({ message: "Exporter le grand livre en tableur." });

    await testDb.delete(users).where(eq(users.id, manager.id));

    const [restee] = await testDb.select().from(suggestions);
    expect(restee).toBeDefined();
    expect(restee.authorId).toBeNull();
    expect(restee.authorLabel).toBe(manager.email);
    expect(restee.message).toBe("Exporter le grand livre en tableur.");
  });
});

describe("Lecture des suggestions", () => {
  it("les livre à l'administration, la plus récente d'abord", async () => {
    const admin = await createPortalUser("ADMIN");
    const manager = await createManager();
    for (const texte of ["Première idée.", "Deuxième idée."]) {
      await request(app).post("/api/suggestions").set(authHeader(tokenFor(manager))).send({ message: texte });
    }

    const res = await request(app).get("/api/admin/suggestions").set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].message).toBe("Deuxième idée.");
  });

  it("ne les livre à personne d'autre", async () => {
    // Une boîte à idées n'est pas publique : elle contient les remarques de
    // gestionnaires concurrents, nommés par leur email.
    const manager = await createManager();

    const res = await request(app).get("/api/admin/suggestions").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });
});
