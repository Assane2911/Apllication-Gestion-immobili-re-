import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CODES_PAYS_ACCEPTES, deviseDuPays, estPaysAccepte, paysSchema } from "./pays";

/**
 * Le pont entre les deux paquets, comme pour les devises (voir devises.test.ts) : le frontend porte la table des
 * pays avec leur téléphone et leur devise, le serveur n'a besoin que des codes et de la devise, pour refuser ce
 * qui n'est pas dans la zone et choisir la devise d'un compte. Deux listes écrites à la main finissent par différer :
 * ce test lit le fichier du frontend et compare. La CI clone le dépôt entier, donc un fichier introuvable signale un
 * déplacement à traiter, pas une situation à ignorer.
 */
const CHEMIN_FRONTEND = path.resolve(__dirname, "../../../frontend/src/data/pays.ts");

function paysDuFrontend(): Array<{ code: string; devise: string }> {
  const source = fs.readFileSync(CHEMIN_FRONTEND, "utf-8");
  const bloc = source.match(/export const PAYS = \[([\s\S]*?)\n\] as const/);
  if (!bloc) throw new Error(`Table PAYS introuvable dans ${CHEMIN_FRONTEND}`);
  return Array.from(bloc[1].matchAll(/^\s*\{\s*code:\s*"([A-Z]{2})"[^}]*devise:\s*"([A-Z]{3})"/gm)).map((m) => ({ code: m[1], devise: m[2] }));
}

describe("Pays acceptés par le serveur", () => {
  it("expose exactement les pays que le frontend propose, avec la même devise", () => {
    const attendus = paysDuFrontend();

    expect(attendus.length).toBeGreaterThan(0);
    expect([...CODES_PAYS_ACCEPTES].sort()).toEqual(attendus.map((p) => p.code).sort());
    for (const { code, devise } of attendus) expect(deviseDuPays(code), `devise de ${code}`).toBe(devise);
  });

  it("se limite à la France et aux huit pays de l'UEMOA", () => {
    expect([...CODES_PAYS_ACCEPTES].sort()).toEqual(["BF", "BJ", "CI", "FR", "GW", "ML", "NE", "SN", "TG"]);
  });

  it("met le franc CFA (XOF) pour les pays de l'UEMOA et l'euro pour la France", () => {
    for (const code of ["SN", "CI", "ML", "BF", "BJ", "TG", "NE", "GW"]) expect(deviseDuPays(code)).toBe("XOF");
    expect(deviseDuPays("FR")).toBe("EUR");
  });

  it("refuse un pays hors zone, y compris ceux qui étaient proposés avant", () => {
    for (const code of ["CM", "MA", "CA", "CH", "BE", "GN", "US", "", "ZZ"]) expect(estPaysAccepte(code), code).toBe(false);
  });

  it("deviseDuPays échoue sur un pays inconnu plutôt que d'inventer une devise", () => {
    expect(() => deviseDuPays("CM")).toThrow();
  });
});

describe("paysSchema", () => {
  it("accepte un code valide, quelle que soit la casse ou les espaces, et le renvoie en majuscules", () => {
    expect(paysSchema.parse("sn")).toBe("SN");
    expect(paysSchema.parse(" fr ")).toBe("FR");
  });

  it("refuse un pays hors zone avec un code d'erreur que l'interface traduit", () => {
    const resultat = paysSchema.safeParse("CM");

    expect(resultat.success).toBe(false);
    if (!resultat.success) {
      const issue = resultat.error.issues[0] as { params?: { code?: string } };
      expect(issue.params?.code).toBe("COUNTRY_UNSUPPORTED");
    }
  });

  it("refuse l'absence de pays et une valeur qui n'est pas du texte", () => {
    expect(paysSchema.safeParse(undefined).success).toBe(false);
    expect(paysSchema.safeParse(null).success).toBe(false);
    expect(paysSchema.safeParse(33).success).toBe(false);
  });
});
