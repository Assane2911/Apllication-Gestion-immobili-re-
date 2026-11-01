import { describe, expect, it } from "vitest";
import { forceMotDePasse } from "./forceMotDePasse";

describe("forceMotDePasse", () => {
  it("ne note rien tant que rien n'est saisi, et signale un mot de passe trop court", () => {
    expect(forceMotDePasse("").niveau).toBe(0);
    expect(forceMotDePasse("Ab1!").niveau).toBe(1);
    // Même riche, un mot de passe de moins de 8 caractères reste « trop court ».
    expect(forceMotDePasse("Ab1!xyz").niveau).toBe(1);
  });

  it("classe les mots de passe valides selon le nombre de critères remplis", () => {
    expect(forceMotDePasse("abcdefgh").niveau).toBe(2);
    expect(forceMotDePasse("abcdefg1").niveau).toBe(2);
    expect(forceMotDePasse("Abcdefg1").niveau).toBe(3);
    expect(forceMotDePasse("abcdefghijkl1").niveau).toBe(3);
    expect(forceMotDePasse("Abcdefghijk1!").niveau).toBe(4);
  });

  it("détaille les critères remplis", () => {
    expect(forceMotDePasse("Abcdefghijk1!").criteres).toEqual({ longueur: true, casse: true, chiffre: true, symbole: true });
    expect(forceMotDePasse("abcdefgh").criteres).toEqual({ longueur: false, casse: false, chiffre: false, symbole: false });
  });
});
