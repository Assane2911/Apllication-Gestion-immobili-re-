import { afterEach, describe, expect, it, vi } from "vitest";
import { aAnnoncer, ANNONCE_AVANT_MS, definirEtat, enCours, type EtatMaintenance, lireEtat, lireEtatCourant, lireEtatDepuisErreur, minutesRestantes, reinitialiserEtat, sAbonner } from "./maintenance";

const H = 3_600_000;
const NOW = new Date("2026-11-02T12:00:00.000Z").getTime();
const fenetre = (debutMs: number, finMs: number, message: string | null = null): EtatMaintenance => ({ debut: new Date(NOW + debutMs).toISOString(), fin: new Date(NOW + finMs).toISOString(), message });

afterEach(() => reinitialiserEtat());

describe("enCours / aAnnoncer", () => {
  it("en cours : début inclus, fin exclue", () => {
    const f = fenetre(0, H);
    expect(enCours(f, NOW - 1)).toBe(false);
    expect(enCours(f, NOW)).toBe(true);
    expect(enCours(f, NOW + H - 1)).toBe(true);
    expect(enCours(f, NOW + H)).toBe(false);
    expect(enCours(null, NOW)).toBe(false);
  });

  it("à annoncer : seulement dans les 24 h qui précèdent le début, jamais une fois commencée", () => {
    expect(aAnnoncer(fenetre(H, 2 * H), NOW)).toBe(true);
    expect(aAnnoncer(fenetre(ANNONCE_AVANT_MS, ANNONCE_AVANT_MS + H), NOW)).toBe(true);
    expect(aAnnoncer(fenetre(ANNONCE_AVANT_MS + 1000, ANNONCE_AVANT_MS + H), NOW)).toBe(false);
    expect(aAnnoncer(fenetre(-H, H), NOW)).toBe(false);
    expect(aAnnoncer(null, NOW)).toBe(false);
  });

  it("minutes restantes : arrondies au-dessus, jamais négatives", () => {
    expect(minutesRestantes(fenetre(-H, 90_000), NOW)).toBe(2);
    expect(minutesRestantes(fenetre(-H, 60_000), NOW)).toBe(1);
    expect(minutesRestantes(fenetre(-2 * H, -H), NOW)).toBe(0);
  });
});

describe("lireEtat", () => {
  it("lit une fenêtre valide, avec ou sans message (un message blanc vaut aucun)", () => {
    const f = fenetre(0, H);
    expect(lireEtat({ ...f, message: "Migration" })).toEqual({ ...f, message: "Migration" });
    expect(lireEtat({ ...f, message: "   " })?.message).toBeNull();
    expect(lireEtat({ debut: f.debut, fin: f.fin })?.message).toBeNull();
  });

  it("écarte tout ce qui n'a pas la bonne forme, au lieu de lire une fenêtre à moitié", () => {
    const f = fenetre(0, H);
    for (const brut of [null, undefined, "x", 12, {}, { debut: f.debut }, { debut: 1, fin: 2 }, { debut: "pas une date", fin: f.fin }, { debut: f.fin, fin: f.debut }, { debut: f.debut, fin: f.debut }]) {
      expect(lireEtat(brut)).toBeNull();
    }
  });
});

describe("lireEtatDepuisErreur", () => {
  it("lit les dates d'une réponse 503 MAINTENANCE, et seulement d'elle", () => {
    const f = fenetre(-H, H);
    expect(lireEtatDepuisErreur({ code: "MAINTENANCE", params: { debut: f.debut, fin: f.fin, message: "Bientôt" } })).toEqual({ ...f, message: "Bientôt" });
    expect(lireEtatDepuisErreur({ code: "MAINTENANCE", params: { debut: f.debut, fin: f.fin, message: "" } })?.message).toBeNull();
    expect(lireEtatDepuisErreur({ code: "AUTRE", params: { debut: f.debut, fin: f.fin } })).toBeNull();
    expect(lireEtatDepuisErreur({ code: "MAINTENANCE" })).toBeNull();
    expect(lireEtatDepuisErreur(undefined)).toBeNull();
  });
});

describe("magasin", () => {
  it("garde l'état, prévient ceux qui écoutent, et ne prévient pas pour un état identique", () => {
    const ecouteur = vi.fn();
    const arret = sAbonner(ecouteur);
    expect(lireEtatCourant()).toBeNull();

    definirEtat(fenetre(0, H));
    expect(ecouteur).toHaveBeenCalledTimes(1);
    expect(lireEtatCourant()).toEqual(fenetre(0, H));

    definirEtat({ ...fenetre(0, H) }); // même contenu, autre objet
    expect(ecouteur).toHaveBeenCalledTimes(1);

    definirEtat(fenetre(0, 2 * H));
    expect(ecouteur).toHaveBeenCalledTimes(2);
    definirEtat(null);
    expect(ecouteur).toHaveBeenCalledTimes(3);
    expect(lireEtatCourant()).toBeNull();
    definirEtat(null);
    expect(ecouteur).toHaveBeenCalledTimes(3);

    arret();
    definirEtat(fenetre(0, H));
    expect(ecouteur).toHaveBeenCalledTimes(3);
  });
});
