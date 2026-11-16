import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLE_CHOIX,
  CLE_DATE_CHOIX,
  effacerCookiesTraceurs,
  enregistrerChoixCookies,
  EVENEMENT_ROUVRIR_CHOIX,
  lireChoixCookies,
  rouvrirChoixCookies,
} from "./consentementCookies";

const JOUR = 86_400_000;
const T0 = new Date("2026-01-01T00:00:00Z").getTime();

describe("choix sur les cookies", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("garde un accord 13 mois, un refus 6 mois, puis le redemande", () => {
    enregistrerChoixCookies("accepted", T0);
    expect(lireChoixCookies(T0 + 390 * JOUR)).toBe("accepted");
    expect(lireChoixCookies(T0 + 396 * JOUR)).toBeNull();

    enregistrerChoixCookies("rejected", T0);
    expect(lireChoixCookies(T0 + 180 * JOUR)).toBe("rejected");
    expect(lireChoixCookies(T0 + 184 * JOUR)).toBeNull();
  });

  it("un choix ancien, sans date, est conservé et daté d'aujourd'hui (on ne redemande pas à tout le monde d'un coup)", () => {
    localStorage.setItem(CLE_CHOIX, "accepted");
    expect(lireChoixCookies(T0)).toBe("accepted");
    expect(localStorage.getItem(CLE_DATE_CHOIX)).toBe(String(T0));
    expect(lireChoixCookies(T0 + 100 * JOUR)).toBe("accepted");
  });

  it("une valeur inconnue n'est pas un choix", () => {
    localStorage.setItem(CLE_CHOIX, "peut-etre");
    expect(lireChoixCookies(T0)).toBeNull();
  });

  it("un stockage indisponible ne fait jamais planter : pas de choix, et l'enregistrement dit qu'il a échoué", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(lireChoixCookies()).toBeNull();
    expect(enregistrerChoixCookies("accepted")).toBe(false);
  });

  it("« Gérer mes cookies » émet l'événement qui rouvre le bandeau", () => {
    const ecouteur = vi.fn();
    window.addEventListener(EVENEMENT_ROUVRIR_CHOIX, ecouteur);
    rouvrirChoixCookies();
    window.removeEventListener(EVENEMENT_ROUVRIR_CHOIX, ecouteur);
    expect(ecouteur).toHaveBeenCalledTimes(1);
  });

  it("efface les cookies des traceurs (Google, Meta, LinkedIn) et garde les autres", () => {
    document.cookie = "_ga=GA1.1.1; path=/";
    document.cookie = "_ga_ABC123=GS1; path=/";
    document.cookie = "_fbp=fb.1.2; path=/";
    document.cookie = "li_gc=x; path=/";
    document.cookie = "session_utile=garde; path=/";

    effacerCookiesTraceurs();

    expect(document.cookie).not.toMatch(/_ga|_fbp|li_gc/);
    expect(document.cookie).toContain("session_utile=garde");
    document.cookie = "session_utile=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });
});
