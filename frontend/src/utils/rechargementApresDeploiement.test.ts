import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  estFichierDisparu,
  installerRechargementAutomatique,
  rechargementEnCours,
  rechargerUneFois,
  reinitialiserRechargementPourTests,
} from "./rechargementApresDeploiement";

// Un onglet resté ouvert pendant un déploiement réclame des fichiers qui n'existent plus (leur nom contient une
// empreinte qui change à chaque build) : « Failed to fetch dynamically imported module ». Un rechargement suffit.
describe("estFichierDisparu", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://www.immoplatformpro.com/assets/LoginPage-CTQ4Vm4-.js",
    "error loading dynamically imported module: https://x/assets/a.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/index-PLJxgH9B.css",
  ])("reconnaît « %s »", (message) => {
    expect(estFichierDisparu(new TypeError(message))).toBe(true);
  });

  it("ne confond pas avec une erreur ordinaire", () => {
    expect(estFichierDisparu(new Error("boom"))).toBe(false);
    expect(estFichierDisparu(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(estFichierDisparu(null)).toBe(false);
    expect(estFichierDisparu("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("rechargerUneFois", () => {
  const recharger = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserRechargementPourTests();
    recharger.mockReset();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: recharger }, writable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("recharge la page la première fois", () => {
    expect(rechargerUneFois(1_000_000)).toBe(true);
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it("ne recharge pas une seconde fois dans la minute (pas de boucle si le fichier manque vraiment)", () => {
    expect(rechargerUneFois(1_000_000)).toBe(true);
    expect(rechargerUneFois(1_000_000 + 30_000)).toBe(false);
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it("recharge de nouveau après un délai raisonnable (un autre déploiement)", () => {
    expect(rechargerUneFois(1_000_000)).toBe(true);
    expect(rechargerUneFois(1_000_000 + 61_000)).toBe(true);
    expect(recharger).toHaveBeenCalledTimes(2);
  });

  it("ne recharge pas si le stockage de session est inaccessible (impossible de se protéger d'une boucle)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(rechargerUneFois(1_000_000)).toBe(false);
    expect(recharger).not.toHaveBeenCalled();
  });
});

describe("installerRechargementAutomatique", () => {
  const recharger = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserRechargementPourTests();
    recharger.mockReset();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: recharger }, writable: true });
  });

  it("recharge sur vite:preloadError et empêche l'erreur de se propager", () => {
    installerRechargementAutomatique();
    const evenement = new Event("vite:preloadError", { cancelable: true });

    window.dispatchEvent(evenement);

    expect(recharger).toHaveBeenCalledTimes(1);
    expect(evenement.defaultPrevented).toBe(true);
  });

  it("laisse l'erreur se propager si la page a déjà été rechargée il y a moins d'une minute (avant cette page)", () => {
    sessionStorage.setItem("rechargement-apres-deploiement", String(Date.now()));
    installerRechargementAutomatique();
    const evenement = new Event("vite:preloadError", { cancelable: true });

    window.dispatchEvent(evenement);

    expect(recharger).not.toHaveBeenCalled();
    expect(evenement.defaultPrevented).toBe(false);
  });

});

/**
 * Plusieurs mécanismes (l'événement de Vite, `lazyWithReload`, le filet d'erreurs) peuvent réagir au MÊME fichier
 * disparu. Le premier recharge ; les suivants doivent le savoir pour ne pas recharger une seconde fois ni laisser
 * apparaître l'écran d'erreur le temps que la page se remplace.
 */
describe("rechargementEnCours", () => {
  const recharger = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reinitialiserRechargementPourTests();
    recharger.mockReset();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: recharger }, writable: true });
  });

  it("est faux tant que rien n'a rechargé", () => {
    expect(rechargementEnCours()).toBe(false);
  });

  it("devient vrai dès que le rechargement est lancé, pour toute la vie de la page", () => {
    rechargerUneFois(1_000_000);

    expect(rechargementEnCours()).toBe(true);
    expect(rechargementEnCours()).toBe(true);
  });

  it("reste faux quand le rechargement est refusé (déjà rechargé il y a moins d'une minute, avant cette page)", () => {
    sessionStorage.setItem("rechargement-apres-deploiement", String(1_000_000));

    expect(rechargerUneFois(1_000_000 + 10_000)).toBe(false);

    expect(rechargementEnCours()).toBe(false);
  });

  it("l'événement vite:preloadError le marque aussi", () => {
    installerRechargementAutomatique();

    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    expect(rechargementEnCours()).toBe(true);
  });

  it("un second événement pendant le rechargement est absorbé, sans second rechargement", () => {
    installerRechargementAutomatique();
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    const second = new Event("vite:preloadError", { cancelable: true });

    window.dispatchEvent(second);

    expect(recharger).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);
  });
});
