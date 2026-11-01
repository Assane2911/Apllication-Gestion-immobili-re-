import { describe, expect, it } from "vitest";
import { motDePasseTemporaire } from "./motDePasseTemporaire";

describe("motDePasseTemporaire", () => {
  it("respecte la longueur demandée, avec un minimum de 8", () => {
    expect(motDePasseTemporaire()).toHaveLength(12);
    expect(motDePasseTemporaire(16)).toHaveLength(16);
    expect(motDePasseTemporaire(3)).toHaveLength(8);
  });

  it("contient majuscule, minuscule et chiffre, sans caractère ambigu", () => {
    for (let i = 0; i < 50; i++) {
      const mdp = motDePasseTemporaire();
      expect(mdp).toMatch(/[A-Z]/);
      expect(mdp).toMatch(/[a-z]/);
      expect(mdp).toMatch(/[0-9]/);
      expect(mdp).not.toMatch(/[01OlI]/);
    }
  });

  it("ne renvoie pas deux fois la même valeur", () => {
    expect(new Set(Array.from({ length: 20 }, () => motDePasseTemporaire())).size).toBe(20);
  });
});
