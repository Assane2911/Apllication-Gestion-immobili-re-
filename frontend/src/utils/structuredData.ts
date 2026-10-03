import { fileUrl } from "../api/client";
import { COMPANY } from "../legal/companyInfo";
import type { Listing } from "../types";

/**
 * Doit rester identique à SITE_URL dans scripts/generate-sitemap.mjs — deux
 * fichiers séparés (script Node de build vs bundle navigateur), même valeur :
 * le domaine réel du frontend déployé, à mettre à jour si un nom de domaine
 * personnalisé est un jour rattaché au projet.
 */
export const SITE_URL = "https://apllication-gestion-immobili-re.vercel.app";

/**
 * schema.org n'étant pas sérialisable tel quel en JSON strict (pas
 * d'échappement de `<`), un `</script>` littéral dans une description de
 * locataire fermerait prématurément la balise une fois injecté via
 * dangerouslySetInnerHTML. `<` reste du JSON valide et neutralise le
 * risque sans toucher au contenu.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Place « Résidence » pour un bien bâti, « Lieu » générique pour un terrain — schema.org n'a pas de type dédié au terrain nu. */
function schemaOrgPlaceType(type: Listing["type"]): "Residence" | "Place" {
  return type === "LAND" ? "Place" : "Residence";
}

/**
 * RealEstateListing pour la fiche d'une annonce (VitrineListingPage) — pas de
 * rich snippet Google dédié aux annonces immobilières à ce jour (vérifié),
 * mais un balisage correct reste utile à l'indexation générale et aux
 * assistants IA qui lisent les données structurées. Structure alignée sur
 * l'usage courant du vocabulaire schema.org : RealEstateListing > about
 * (Residence/Place + adresse) + offers (Offer).
 */
export function buildListingJsonLd(listing: Listing) {
  const image = fileUrl(listing.imageUrl);

  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.title,
    description: listing.description,
    url: `${SITE_URL}/vitrine/annonces/${listing.id}`,
    datePosted: listing.createdAt,
    ...(image ? { image } : {}),
    about: {
      "@type": schemaOrgPlaceType(listing.type),
      address: {
        "@type": "PostalAddress",
        addressLocality: listing.location,
        ...(listing.country ? { addressCountry: listing.country } : {}),
      },
      ...(listing.surface != null ? { floorSize: { "@type": "QuantitativeValue", value: listing.surface, unitCode: "MTK" } } : {}),
      ...(listing.rooms != null ? { numberOfRooms: listing.rooms } : {}),
    },
    offers: {
      "@type": "Offer",
      price: listing.price,
      priceCurrency: listing.currency,
      availability: "https://schema.org/InStock",
      ...(listing.pricePeriod === "MONTH"
        ? { priceSpecification: { "@type": "UnitPriceSpecification", price: listing.price, priceCurrency: listing.currency, unitText: "MONTH" } }
        : {}),
    },
  };
}

/** Organization pour la page d'accueil — identité de l'éditeur, reprise des informations légales réelles (companyInfo.ts). */
export function buildOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: COMPANY.tradeName,
    url: SITE_URL,
    logo: `${SITE_URL}/app-icon.png`,
    email: COMPANY.contactEmail,
  };
}

/**
 * SoftwareApplication pour la page d'accueil. Fourchette de prix reprise des
 * tarifs réels du catalogue (subscription.controller.ts, TARIFS.STARTER/
 * PRO/ENTERPRISE en EUR) — à mettre à jour si ces tarifs changent, pas une
 * valeur inventée pour l'occasion.
 */
export function buildSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: COMPANY.tradeName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    offers: {
      "@type": "AggregateOffer",
      lowPrice: 9,
      highPrice: 49,
      priceCurrency: "EUR",
      offerCount: 3,
    },
  };
}
