import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  createPortalUser,
} from "../test/authHelpers";

describe("GET /api/search", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/search").query({ q: "Dupont" });
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/search")
      .query({ q: "Dupont" })
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("renvoie une liste vide pour une requête trop courte", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/search").query({ q: "a" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it("trouve un locataire par prénom", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app).get("/api/search").query({ q: "amad" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const tenantResult = res.body.results.find((r: { type: string }) => r.type === "tenant");
    expect(tenantResult).toBeTruthy();
    expect(tenantResult.title).toBe("Amadou Diallo");
  });

  it("trouve un bien par titre", async () => {
    const manager = await createManager();
    await createProperty(manager.id, { title: "Villa Les Almadies" });

    const res = await request(app).get("/api/search").query({ q: "almadies" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const propertyResult = res.body.results.find((r: { type: string }) => r.type === "property");
    expect(propertyResult).toBeTruthy();
    expect(propertyResult.title).toBe("Villa Les Almadies");
  });

  it("trouve un contrat et une facture via le nom du locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Résidence Test" });
    const tenant = await createTenant(manager.id, { firstName: "Fatou", lastName: "Ndiaye" });
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id);

    const res = await request(app).get("/api/search").query({ q: "fatou" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string }) => r.type === "contract")).toBe(true);
    expect(res.body.results.some((r: { type: string }) => r.type === "invoice")).toBe(true);
  });

  it("isole les résultats par gestionnaire", async () => {
    const manager = await createManager();
    const otherManager = await createManager();
    await createTenant(otherManager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app).get("/api/search").query({ q: "amad" }).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });
});

/**
 * Régression : chaque catégorie est limitée à 5 résultats, mais SANS tri — le commentaire de la route promettait
 * « le plus pertinent en tête » et la base renvoyait n'importe lesquelles. Chercher un locataire qui a une
 * dizaine de factures n'en montrait pas les plus récentes, et deux recherches identiques pouvaient donner des
 * résultats différents. Le paramètre `q` n'était pas borné non plus : un paramètre répété (`?q=a&q=b`) devenait
 * « a,b » et un texte de plusieurs milliers de caractères partait tel quel dans quatre requêtes en parallèle.
 */
describe("GET /api/search — tri et bornes", () => {
  it("renvoie les factures les PLUS RÉCENTES d'un locataire, dans l'ordre", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Résidence Tri" });
    const tenant = await createTenant(manager.id, { firstName: "Mariama", lastName: "Sall" });
    const contract = await createContract(property.id, tenant.id);
    // Insérées dans le désordre : l'ordre d'insertion ne doit pas décider du résultat.
    for (const mois of [3, 9, 1, 7, 5, 11, 2]) {
      await createInvoice(contract.id, { periodMonth: mois, periodYear: 2026, dueDate: new Date(2026, mois - 1, 20) });
    }

    const res = await request(app).get("/api/search").query({ q: "mariama" }).set(authHeader(tokenFor(manager)));

    const factures = res.body.results.filter((r: { type: string }) => r.type === "invoice");
    expect(factures.map((f: { title: string }) => f.title.match(/(\d+)\/2026/)![1])).toEqual(["11", "9", "7", "5", "3"]);
  });

  it("renvoie les locataires et les biens dans l'ordre alphabétique", async () => {
    const manager = await createManager();
    for (const [prenom, nom] of [["Zoé", "Martin"], ["Zoé", "Albert"], ["Zoé", "Dupont"]]) {
      await createTenant(manager.id, { firstName: prenom, lastName: nom, email: `${nom}@test.local` });
    }
    for (const titre of ["Zénith C", "Zénith A", "Zénith B"]) {
      await createProperty(manager.id, { title: titre });
    }

    const res = await request(app).get("/api/search").query({ q: "zo" }).set(authHeader(tokenFor(manager)));
    const biens = await request(app).get("/api/search").query({ q: "zénith" }).set(authHeader(tokenFor(manager)));

    const locataires = res.body.results.filter((r: { type: string }) => r.type === "tenant");
    expect(locataires.map((l: { title: string }) => l.title)).toEqual(["Zoé Albert", "Zoé Dupont", "Zoé Martin"]);
    const titres = biens.body.results.filter((r: { type: string }) => r.type === "property").map((p: { title: string }) => p.title);
    expect(titres).toEqual(["Zénith A", "Zénith B", "Zénith C"]);
  });

  it("refuse un paramètre répété ou démesuré au lieu de le recoller", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));

    expect((await request(app).get("/api/search?q=ab&q=cd").set(h)).status).toBe(400);
    expect((await request(app).get("/api/search").query({ q: "a".repeat(101) }).set(h)).status).toBe(400);
    expect((await request(app).get("/api/search").query({ q: "a".repeat(100) }).set(h)).status).toBe(200);
  });
});
