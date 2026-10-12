import { describe, expect, it } from "vitest";
import { app } from "../app";
import { type RoleEquipe, verifierAutorisationEquipe } from "../utils/rolesEquipe";

/**
 * Parcourt TOUTES les routes réellement enregistrées dans l'application et
 * vérifie ce que la matrice des rôles autorise en écriture à chaque rôle
 * restreint. Une route ajoutée demain sans règle est refusée par défaut ;
 * ce test garde l'inverse : qu'aucune règle trop large n'ouvre par erreur
 * une écriture sensible.
 */
interface RouteEnregistree {
  methode: string;
  chemin: string;
}

function cheminDepuisRegexp(source: string): string {
  return source
    .replace("^", "")
    .replace("\\/?(?=\\/|$)", "")
    .replace("(?:\\/(?=$))?", "")
    .replace(/\\\//g, "/")
    .replace("$", "");
}

function collecter(pile: any[], prefixe: string, sortie: RouteEnregistree[]) {
  for (const couche of pile) {
    if (couche.route) {
      for (const methode of Object.keys(couche.route.methods)) {
        const brut = typeof couche.route.path === "string" ? couche.route.path : "";
        sortie.push({ methode: methode.toUpperCase(), chemin: (prefixe + brut).replace(/:[A-Za-z]+/g, "x").replace(/\/+$/, "") || "/" });
      }
    } else if (couche.name === "router" && couche.handle?.stack) {
      collecter(couche.handle.stack, prefixe + cheminDepuisRegexp(couche.regexp.source), sortie);
    }
  }
}

const routes: RouteEnregistree[] = [];
collecter((app as any)._router.stack, "", routes);
const ecritures = routes.filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.methode) && r.chemin.startsWith("/api/"));

const autorisees = (role: RoleEquipe) =>
  ecritures.filter((r) => verifierAutorisationEquipe(role, r.methode, r.chemin).autorise).map((r) => `${r.methode} ${r.chemin.replace("/api", "")}`);

const PERSONNELLES = /^(POST|PUT|PATCH|DELETE) \/(auth\/|notifications\/(seen|read)$|suggestions$)/;

describe("couverture des rôles sur les routes réellement enregistrées", () => {
  it("le parcours trouve bien les routes de l'application", () => {
    expect(ecritures.length).toBeGreaterThan(60);
    expect(ecritures.some((r) => r.methode === "POST" && r.chemin === "/api/invoices/x/mark-paid")).toBe(true);
    expect(ecritures.some((r) => r.methode === "PUT" && r.chemin === "/api/agency")).toBe(true);
    expect(ecritures.some((r) => r.methode === "PATCH" && r.chemin === "/api/team/x/role")).toBe(true);
  });

  it("READ_ONLY : aucune écriture hors actions personnelles", () => {
    const hors = autorisees("READ_ONLY").filter((r) => !PERSONNELLES.test(r));
    expect(hors).toEqual([]);
  });

  it.each(["AGENT", "ACCOUNTANT"] as const)("%s : jamais de réglages d'agence, d'équipe, d'abonnement ni de compte", (role) => {
    const sensibles = autorisees(role).filter((r) => /\/(agency|team|subscription|conservation|admin)(\/|$)|\/auth\/account$/.test(r.split(" ")[1]) && !PERSONNELLES.test(r));
    expect(sensibles).toEqual([]);
  });

  it("AGENT : aucune suppression, aucune anonymisation, aucun encaissement", () => {
    const interdit = autorisees("AGENT").filter(
      (r) => r.startsWith("DELETE ") ? !PERSONNELLES.test(r) : /anonymiser|mark-paid|\/cancel$/.test(r)
    );
    expect(interdit).toEqual([]);
  });

  it("ACCOUNTANT : n'écrit que sur les factures et les dépenses", () => {
    const hors = autorisees("ACCOUNTANT").filter((r) => !PERSONNELLES.test(r) && !/ \/(invoices|expenses)(\/|$)/.test(r));
    expect(hors).toEqual([]);
  });

  it("l'instantané des écritures autorisées reste lisible et revu à chaque évolution", () => {
    expect({
      AGENT: autorisees("AGENT").filter((r) => !PERSONNELLES.test(r)).sort(),
      ACCOUNTANT: autorisees("ACCOUNTANT").filter((r) => !PERSONNELLES.test(r)).sort(),
    }).toMatchSnapshot();
  });
});
