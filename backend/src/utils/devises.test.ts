import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DEVISES_ACCEPTEES, estDeviseAcceptee } from "./devises";

/**
 * Le pont entre les deux paquets.
 *
 * Le frontend porte la liste des devises avec leur présentation ; le backend
 * n'a besoin que des codes, pour refuser ce qui n'existe pas. Sans espace
 * partagé entre `backend` et `frontend`, la liste est écrite deux fois — et
 * deux listes écrites à la main finissent toujours par différer.
 *
 * Ce test lit donc le fichier du frontend et compare. Il ne « saute » pas si
 * le fichier est absent : la CI clone le dépôt entier (voir
 * .github/workflows/ci.yml), donc un fichier introuvable signale un
 * déplacement à traiter, pas une situation normale à ignorer en silence.
 */
const CHEMIN_FRONTEND = path.resolve(__dirname, "../../../frontend/src/context/currency.ts");

function devisesDuFrontend(): string[] {
  const source = fs.readFileSync(CHEMIN_FRONTEND, "utf-8");
  const bloc = source.match(/export const CURRENCIES[^{]*\{([\s\S]*?)\n\};/);
  if (!bloc) throw new Error(`Bloc CURRENCIES introuvable dans ${CHEMIN_FRONTEND}`);

  return Array.from(bloc[1].matchAll(/^\s{2}([A-Z]{3}):\s*\{/gm)).map((m) => m[1]);
}

describe("Devises acceptées par le serveur", () => {
  it("expose exactement les devises que le frontend propose", () => {
    const attendues = devisesDuFrontend();

    expect(attendues.length).toBeGreaterThan(0);
    expect([...DEVISES_ACCEPTEES].sort()).toEqual([...attendues].sort());
  });

  it("refuse un code absent de la liste", () => {
    expect(estDeviseAcceptee("XOF")).toBe(true);
    expect(estDeviseAcceptee("XYZ")).toBe(false);
    // La casse compte : les codes ISO 4217 sont en majuscules, et accepter
    // « xof » laisserait deux écritures de la même devise cohabiter en base.
    expect(estDeviseAcceptee("xof")).toBe(false);
  });
});
