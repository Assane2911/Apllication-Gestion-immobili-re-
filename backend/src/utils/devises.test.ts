import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DEVISES, DEVISES_ACCEPTEES, estDeviseAcceptee } from "./devises";

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

interface DeviseDuFrontend {
  code: string;
  symbole: string;
  position: "avant" | "apres";
}

function devisesDuFrontend(): DeviseDuFrontend[] {
  const source = fs.readFileSync(CHEMIN_FRONTEND, "utf-8");
  const bloc = source.match(/export const CURRENCIES[^{]*\{([\s\S]*?)\n\};/);
  if (!bloc) throw new Error(`Bloc CURRENCIES introuvable dans ${CHEMIN_FRONTEND}`);

  const lignes = Array.from(
    bloc[1].matchAll(/^\s{2}([A-Z]{3}):\s*\{[^}]*symbol:\s*"([^"]*)"[^}]*symbolPosition:\s*"(before|after)"/gm)
  );

  return lignes.map((m) => ({
    code: m[1],
    symbole: m[2],
    position: m[3] === "before" ? "avant" : "apres",
  }));
}

describe("Devises acceptées par le serveur", () => {
  it("expose exactement les devises que le frontend propose", () => {
    const attendues = devisesDuFrontend();

    expect(attendues.length).toBeGreaterThan(0);
    expect([...DEVISES_ACCEPTEES].sort()).toEqual(attendues.map((d) => d.code).sort());
  });

  it("écrit chaque devise avec le même symbole et du même côté que le portail", () => {
    // Le serveur met désormais les montants en forme lui aussi, pour les
    // emails et les messages WhatsApp. Deux symboles divergents donneraient un
    // « 35 000 FCFA » à l'écran et un « 35 000 F » dans le message reçu : le
    // locataire douterait du montant plutôt que de la mise en page.
    for (const attendue of devisesDuFrontend()) {
      expect(DEVISES[attendue.code], `devise absente du serveur : ${attendue.code}`).toEqual({
        symbole: attendue.symbole,
        position: attendue.position,
      });
    }
  });

  it("refuse un code absent de la liste", () => {
    expect(estDeviseAcceptee("XOF")).toBe(true);
    expect(estDeviseAcceptee("XYZ")).toBe(false);
    // La casse compte : les codes ISO 4217 sont en majuscules, et accepter
    // « xof » laisserait deux écritures de la même devise cohabiter en base.
    expect(estDeviseAcceptee("xof")).toBe(false);
  });
});
