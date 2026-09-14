import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createManager, createTenant, tokenFor } from "../test/authHelpers";
import { echapperLike } from "./search.controller";

describe("echapperLike", () => {
  it("neutralise les jokers de LIKE", () => {
    expect(echapperLike("100%")).toBe("100\\%");
    expect(echapperLike("a_b")).toBe("a\\_b");
    expect(echapperLike("%_%")).toBe("\\%\\_\\%");
  });

  it("échappe aussi l'antislash, et une seule fois", () => {
    // L'antislash est traité dans la même passe que les jokers. Échapper les
    // jokers d'abord reviendrait à échapper ensuite les antislashs qu'on
    // vient d'ajouter, et le motif ne correspondrait plus à rien.
    expect(echapperLike("a\\b")).toBe("a\\\\b");
    expect(echapperLike("a\\%b")).toBe("a\\\\\\%b");
  });

  it("laisse un texte ordinaire intact", () => {
    expect(echapperLike("Dupont")).toBe("Dupont");
    expect(echapperLike("12 rue de l'Église")).toBe("12 rue de l'Église");
  });
});

describe("GET /api/search — jokers saisis par l'utilisateur", () => {
  // Régression. Le motif était construit par `%${q}%` sans traitement. Ce
  // n'était pas une injection SQL — drizzle passe bien la valeur en paramètre
  // — mais le contenu du paramètre reste interprété par LIKE. Chercher « _ »
  // remontait donc TOUT le carnet d'adresses, et un motif comme « %a%b%c% »
  // force un balayage complet de quatre tables à chaque frappe.
  it("ne traite pas % comme un joker", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { firstName: "Amadou", lastName: "Diallo" });
    await createTenant(manager.id, { firstName: "Fatou", lastName: "Ndiaye" });

    const res = await request(app)
      .get("/api/search")
      .query({ q: "%%" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    // Avant le correctif, « %% » renvoyait tous les locataires du compte.
    expect(res.body.results).toEqual([]);
  });

  it("ne traite pas _ comme un joker", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app)
      .get("/api/search")
      .query({ q: "__" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it("trouve encore un locataire dont le nom contient réellement le caractère", async () => {
    // Le pendant du test précédent : neutraliser le joker ne doit pas rendre
    // le caractère introuvable pour qui le porte vraiment dans son nom.
    const manager = await createManager();
    await createTenant(manager.id, { firstName: "Jean_Pierre", lastName: "Sow" });
    await createTenant(manager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app)
      .get("/api/search")
      .query({ q: "n_P" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].title).toContain("Jean_Pierre");
  });

  it("continue de trouver une recherche ordinaire", async () => {
    const manager = await createManager();
    await createTenant(manager.id, { firstName: "Amadou", lastName: "Diallo" });

    const res = await request(app)
      .get("/api/search")
      .query({ q: "Diallo" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });
});
