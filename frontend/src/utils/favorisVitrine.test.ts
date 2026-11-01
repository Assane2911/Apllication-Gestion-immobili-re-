import { beforeEach, describe, expect, it } from "vitest";
import type { Listing } from "../types";
import { basculerFavori, lireFavoris, resumeAnnonce } from "./favorisVitrine";

function annonce(id: string): Listing {
  return {
    id,
    type: "RENT",
    title: `Annonce ${id}`,
    description: "Une description qu'on ne garde pas",
    price: 450,
    currency: "EUR",
    pricePeriod: "MONTH",
    surface: 55,
    rooms: 2,
    location: "Dakar",
    country: "SN",
    imageUrl: null,
    contactEmail: "agence@test.local",
    status: "PUBLISHED",
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("favorisVitrine", () => {
  beforeEach(() => localStorage.clear());

  it("ne garde de l'annonce que de quoi dessiner sa carte", () => {
    const resume = resumeAnnonce(annonce("a"));
    expect(resume).not.toHaveProperty("description");
    expect(resume).not.toHaveProperty("contactEmail");
    expect(resume).toMatchObject({ id: "a", title: "Annonce a", price: 450 });
  });

  it("ajoute en tête, retire au deuxième appel et mémorise dans le navigateur", () => {
    let favoris = basculerFavori([], resumeAnnonce(annonce("a")));
    favoris = basculerFavori(favoris, resumeAnnonce(annonce("b")));
    expect(favoris.map((a) => a.id)).toEqual(["b", "a"]);
    expect(lireFavoris().map((a) => a.id)).toEqual(["b", "a"]);

    favoris = basculerFavori(favoris, resumeAnnonce(annonce("b")));
    expect(favoris.map((a) => a.id)).toEqual(["a"]);
    expect(lireFavoris().map((a) => a.id)).toEqual(["a"]);
  });

  it("oublie les plus anciens au-delà de cinquante", () => {
    let favoris: ReturnType<typeof lireFavoris> = [];
    for (let i = 0; i < 55; i++) favoris = basculerFavori(favoris, resumeAnnonce(annonce(`a${i}`)));
    expect(favoris).toHaveLength(50);
    expect(favoris[0].id).toBe("a54");
  });

  it("donne une liste vide quand le contenu est illisible", () => {
    localStorage.setItem("immo.favoris-vitrine", "{pas du json");
    expect(lireFavoris()).toEqual([]);
    localStorage.setItem("immo.favoris-vitrine", JSON.stringify({ pas: "un tableau" }));
    expect(lireFavoris()).toEqual([]);
  });
});
