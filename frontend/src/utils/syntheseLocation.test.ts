import { describe, expect, it } from "vitest";
import type { Listing, ListingLead } from "../types";
import { aRepondreVite, ageEnJours, csvDemandes, lienVitrine, lienWhatsapp, syntheseAnnonces, syntheseDemandes, trierAnnonces } from "./syntheseLocation";

const annonce = (s: Partial<Listing>): Listing =>
  ({ id: "a", type: "RENT", title: "Studio", description: "", price: 500, currency: "EUR", pricePeriod: "MONTH", location: "Dakar", status: "PUBLISHED", featured: false, createdAt: "", updatedAt: "", ...s }) as Listing;

const demande = (s: Partial<ListingLead>): ListingLead =>
  ({ id: "d", listingId: "a", managerId: "m", prospectName: "Awa Diallo", prospectEmail: "a@b.sn", prospectPhone: "+221771234567", requestType: "INFO", status: "NEW", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "", ...s }) as ListingLead;

describe("annonces", () => {
  it("compte les annonces par statut, à la une et masquées", () => {
    expect(
      syntheseAnnonces([
        annonce({ id: "1" }),
        annonce({ id: "2", status: "DRAFT", featured: true }),
        annonce({ id: "3", status: "ARCHIVED" }),
        annonce({ id: "4", hiddenByAdminAt: "2026-10-01T00:00:00.000Z" }),
      ])
    ).toEqual({ publiees: 2, brouillons: 1, archivees: 1, vedettes: 1, masquees: 1 });
  });

  it("trie par prix ou par titre sans modifier la liste d'origine", () => {
    const l = [annonce({ id: "a", title: "Villa", price: 900 }), annonce({ id: "b", title: "Atelier", price: 300 }), annonce({ id: "c", title: "Studio", price: 600 })];
    expect(trierAnnonces(l, "prixDesc").map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(trierAnnonces(l, "prixAsc").map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(trierAnnonces(l, "titre").map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(trierAnnonces(l, "recent").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(l.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("construit l'adresse publique de l'annonce", () => {
    expect(lienVitrine("https://immoplatformpro.com", "abc")).toBe("https://immoplatformpro.com/vitrine/annonces/abc");
  });
});

describe("demandes", () => {
  const maintenant = new Date("2026-11-05T10:00:00.000Z");

  it("calcule l'âge d'une demande en jours entiers", () => {
    expect(ageEnJours("2026-11-01T10:00:00.000Z", maintenant)).toBe(4);
    expect(ageEnJours("2026-11-05T09:00:00.000Z", maintenant)).toBe(0);
    expect(ageEnJours("2026-12-01T00:00:00.000Z", maintenant)).toBe(0);
  });

  it("repère une demande nouvelle restée sans réponse", () => {
    expect(aRepondreVite(demande({}), maintenant)).toBe(true);
    expect(aRepondreVite(demande({ createdAt: "2026-11-05T08:00:00.000Z" }), maintenant)).toBe(false);
    expect(aRepondreVite(demande({ status: "CONTACTED" }), maintenant)).toBe(false);
  });

  it("résume l'entonnoir et le taux d'aboutissement", () => {
    const s = syntheseDemandes(
      [
        demande({ id: "1" }),
        demande({ id: "2", status: "CONTACTED", requestType: "VISIT" }),
        demande({ id: "3", status: "VISITED" }),
        demande({ id: "4", status: "CONVERTED" }),
        demande({ id: "5", status: "ARCHIVED" }),
      ],
      maintenant
    );
    expect(s).toEqual({ nouvelles: 1, aRepondre: 1, visitesAOrganiser: 1, enCours: 2, abouties: 1, tauxAboutissement: 25 });
  });

  it("ne donne pas de taux sans demande active", () => {
    expect(syntheseDemandes([], maintenant).tauxAboutissement).toBeNull();
    expect(syntheseDemandes([demande({ status: "ARCHIVED" })], maintenant).tauxAboutissement).toBeNull();
  });

  it("ne fabrique un lien WhatsApp que pour un numéro international", () => {
    expect(lienWhatsapp("+221 77 123 45 67")).toBe("https://wa.me/221771234567");
    expect(lienWhatsapp("00221771234567")).toBe("https://wa.me/221771234567");
    expect(lienWhatsapp("0771234567")).toBeNull();
    expect(lienWhatsapp("+12")).toBeNull();
  });

  it("exporte les demandes en CSV, le « + » du numéro neutralisé", () => {
    const csv = csvDemandes([demande({ listingTitle: "Villa Baobab", message: 'Bonjour "Awa"' })], { date: "Date", name: "Nom", email: "Email", phone: "Téléphone", listing: "Annonce", type: "Type", status: "Statut", message: "Message" }, () => "Information", () => "Nouveau");
    expect(csv.split("\n")[1]).toBe('"2026-11-01";"Awa Diallo";"a@b.sn";"\'+221771234567";"Villa Baobab";"Information";"Nouveau";"Bonjour ""Awa"""');
  });
});
