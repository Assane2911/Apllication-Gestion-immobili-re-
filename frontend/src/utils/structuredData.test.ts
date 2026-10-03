import { describe, expect, it } from "vitest";
import type { Listing } from "../types";
import { buildListingJsonLd, buildOrganizationJsonLd, buildSoftwareApplicationJsonLd, jsonLdScript, SITE_URL } from "./structuredData";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "list-1",
    type: "RENT",
    title: "Appartement 2 pièces vue mer",
    description: "Bel appartement lumineux proche des commodités.",
    price: 450,
    currency: "EUR",
    pricePeriod: "MONTH",
    surface: 55,
    rooms: 2,
    location: "Dakar, Almadies",
    country: "SN",
    imageUrl: null,
    contactPhone: null,
    contactWhatsapp: null,
    contactEmail: null,
    status: "PUBLISHED",
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("jsonLdScript", () => {
  it("échappe les '<' pour empêcher une fermeture prématurée de la balise <script>", () => {
    const sortie = jsonLdScript({ description: "Avant </script><script>alert(1)</script>" });
    expect(sortie).not.toContain("</script>");
    expect(sortie).toContain("\\u003c/script>");
  });

  it("produit du JSON valide une fois les échappements retirés", () => {
    const data = { a: 1, b: "texte <ok>" };
    const sortie = jsonLdScript(data);
    expect(JSON.parse(sortie.replace(/\\u003c/g, "<"))).toEqual(data);
  });
});

describe("buildListingJsonLd", () => {
  it("construit un RealEstateListing avec le prix, l'adresse et l'URL absolue de l'annonce", () => {
    const data = buildListingJsonLd(listing()) as Record<string, unknown>;

    expect(data["@type"]).toBe("RealEstateListing");
    expect(data.name).toBe("Appartement 2 pièces vue mer");
    expect(data.url).toBe(`${SITE_URL}/vitrine/annonces/list-1`);
    expect(data.datePosted).toBe("2026-01-01T00:00:00.000Z");

    const about = data.about as Record<string, unknown>;
    expect(about["@type"]).toBe("Residence");
    expect((about.address as Record<string, unknown>).addressLocality).toBe("Dakar, Almadies");
    expect((about.address as Record<string, unknown>).addressCountry).toBe("SN");
    expect((about.floorSize as Record<string, unknown>).value).toBe(55);
    expect(about.numberOfRooms).toBe(2);

    const offers = data.offers as Record<string, unknown>;
    expect(offers.price).toBe(450);
    expect(offers.priceCurrency).toBe("EUR");
    expect((offers.priceSpecification as Record<string, unknown>).unitText).toBe("MONTH");
  });

  it("utilise le type Place (pas Residence) pour un terrain", () => {
    const data = buildListingJsonLd(listing({ type: "LAND" })) as Record<string, unknown>;
    expect((data.about as Record<string, unknown>)["@type"]).toBe("Place");
  });

  it("omet l'image quand l'annonce n'en a pas, plutôt que d'en inventer une", () => {
    const data = buildListingJsonLd(listing({ imageUrl: null })) as Record<string, unknown>;
    expect(data.image).toBeUndefined();
  });

  it("inclut une URL d'image absolue quand l'annonce en a une", () => {
    const data = buildListingJsonLd(listing({ imageUrl: "/uploads/photo.jpg" })) as Record<string, unknown>;
    expect(data.image).toContain("/uploads/photo.jpg");
  });

  it("omet priceSpecification pour une vente (pas de période mensuelle)", () => {
    const data = buildListingJsonLd(listing({ type: "SALE", pricePeriod: "ONE_TIME" as Listing["pricePeriod"] })) as Record<string, unknown>;
    expect((data.offers as Record<string, unknown>).priceSpecification).toBeUndefined();
  });
});

describe("buildOrganizationJsonLd", () => {
  it("construit une Organization avec le nom commercial réel", () => {
    const data = buildOrganizationJsonLd() as Record<string, unknown>;
    expect(data["@type"]).toBe("Organization");
    expect(data.name).toBe("ImmoPlatform Pro");
    expect(data.url).toBe(SITE_URL);
  });
});

describe("buildSoftwareApplicationJsonLd", () => {
  it("reprend la fourchette de tarifs réelle du catalogue (9 à 49 EUR)", () => {
    const data = buildSoftwareApplicationJsonLd() as Record<string, unknown>;
    const offers = data.offers as Record<string, unknown>;
    expect(offers.lowPrice).toBe(9);
    expect(offers.highPrice).toBe(49);
    expect(offers.priceCurrency).toBe("EUR");
  });
});
