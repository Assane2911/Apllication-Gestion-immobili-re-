import { describe, expect, it } from "vitest";
import {
  consommerCodeSecours,
  genererCodeTotp,
  genererCodesSecours,
  genererOtpauthUrl,
  genererSecretTotp,
  verifierCodeTotp,
} from "./totp.service";

describe("totp.service", () => {
  it("génère un secret et un code correspondant vérifiable", async () => {
    const secret = genererSecretTotp();
    const code = await genererCodeTotp(secret);

    expect(code).toMatch(/^\d{6}$/);
    expect(await verifierCodeTotp(secret, code)).toBe(true);
  });

  it("rejette un code arbitraire", async () => {
    const secret = genererSecretTotp();
    expect(await verifierCodeTotp(secret, "000000")).toBe(false);
  });

  it("rejette le code généré pour un AUTRE secret", async () => {
    const secretA = genererSecretTotp();
    const secretB = genererSecretTotp();
    const codePourB = await genererCodeTotp(secretB);

    expect(await verifierCodeTotp(secretA, codePourB)).toBe(false);
  });

  it("construit une URL otpauth qui porte l'émetteur, l'adresse et le secret", () => {
    const secret = genererSecretTotp();
    const url = genererOtpauthUrl("gestionnaire@demo.com", secret);

    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(encodeURIComponent("gestionnaire@demo.com"));
    expect(url).toContain(secret);
    expect(url).toContain(encodeURIComponent("ImmoPlatform Pro"));
  });

  it("génère 8 codes de secours distincts, chacun avec son propre hachage", async () => {
    const { codes, hashes } = await genererCodesSecours();

    expect(codes).toHaveLength(8);
    expect(hashes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
  });

  describe("consommerCodeSecours", () => {
    it("reconnaît un code valide et renvoie la liste sans son hachage", async () => {
      const { codes, hashes } = await genererCodesSecours();
      const hashesJson = JSON.stringify(hashes);

      const restant = await consommerCodeSecours(codes[3], hashesJson);

      expect(restant).not.toBeNull();
      expect(restant).toHaveLength(7);
    });

    it("refuse un code déjà consommé (retiré de la liste restante)", async () => {
      const { codes, hashes } = await genererCodesSecours();
      const apresPremiereConsommation = await consommerCodeSecours(codes[0], JSON.stringify(hashes));

      const deuxiemeTentative = await consommerCodeSecours(codes[0], JSON.stringify(apresPremiereConsommation));

      expect(deuxiemeTentative).toBeNull();
    });

    it("refuse un code qui n'a jamais existé", async () => {
      const { hashes } = await genererCodesSecours();
      expect(await consommerCodeSecours("ffffffffff", JSON.stringify(hashes))).toBeNull();
    });

    it("renvoie null pour une liste vide ou invalide", async () => {
      expect(await consommerCodeSecours("abcdef1234", null)).toBeNull();
      expect(await consommerCodeSecours("abcdef1234", "pas-du-json")).toBeNull();
    });
  });
});
