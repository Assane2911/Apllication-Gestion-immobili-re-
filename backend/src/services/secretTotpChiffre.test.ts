import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../config/env";
import { lireCleTotp } from "../config/cleTotp";
import { chiffrerSecretTotp, dechiffrerSecretTotp, secretTotpEstChiffre } from "./secretTotpChiffre";

/**
 * Le secret de double authentification (TOTP) était stocké en clair dans `users.totp_secret` : une lecture de la base
 * (tableau de bord, clé de service, fuite) permettait de calculer les codes à 6 chiffres du compte, dont celui de
 * l'administrateur. Il est maintenant chiffré (AES-256-GCM) avec une clé dédiée, `TOTP_ENCRYPTION_KEY`, distincte de
 * `JWT_SECRET` : changer l'un ne doit pas rendre l'autre illisible.
 *
 * Sans clé, le comportement reste celui d'avant (clair), signalé au démarrage : rien ne casse tant que la clé n'est pas posée.
 */
const CLE = crypto.randomBytes(32);
const SECRET = "JBSWY3DPEHPK3PXP";

describe("lireCleTotp", () => {
  it("accepte 32 octets en base64", () => {
    expect(lireCleTotp(CLE.toString("base64"))).toEqual({ cle: CLE, invalide: false });
  });

  it("une valeur absente ou vide n'est pas une erreur : pas de clé", () => {
    expect(lireCleTotp(undefined)).toEqual({ cle: null, invalide: false });
    expect(lireCleTotp("")).toEqual({ cle: null, invalide: false });
  });

  it("refuse une clé de mauvaise longueur, et le dit", () => {
    expect(lireCleTotp(crypto.randomBytes(16).toString("base64"))).toEqual({ cle: null, invalide: true });
    expect(lireCleTotp("pas-du-base64-valide!!")).toEqual({ cle: null, invalide: true });
  });
});

describe("chiffrement du secret TOTP", () => {
  const avant = env.totpEncryptionKey;
  beforeEach(() => {
    env.totpEncryptionKey = CLE;
  });
  afterEach(() => {
    env.totpEncryptionKey = avant;
  });

  it("chiffre puis déchiffre, et ce qui est stocké ne contient pas le secret", () => {
    const stocke = chiffrerSecretTotp(SECRET);
    expect(stocke).not.toContain(SECRET);
    expect(secretTotpEstChiffre(stocke)).toBe(true);
    expect(dechiffrerSecretTotp(stocke)).toBe(SECRET);
  });

  it("deux chiffrements du même secret donnent deux valeurs différentes (vecteur d'initialisation aléatoire)", () => {
    expect(chiffrerSecretTotp(SECRET)).not.toBe(chiffrerSecretTotp(SECRET));
  });

  it("détecte une valeur altérée au lieu de renvoyer un secret faux", () => {
    const stocke = chiffrerSecretTotp(SECRET);
    const [v, iv, tag, ct] = stocke.split(":");
    const abime = Buffer.from(ct, "base64");
    abime[0] ^= 0xff;
    expect(() => dechiffrerSecretTotp([v, iv, tag, abime.toString("base64")].join(":"))).toThrow();
  });

  it("refuse de déchiffrer avec une autre clé", () => {
    const stocke = chiffrerSecretTotp(SECRET);
    env.totpEncryptionKey = crypto.randomBytes(32);
    expect(() => dechiffrerSecretTotp(stocke)).toThrow();
  });

  it("lit encore un secret ancien, stocké en clair", () => {
    expect(secretTotpEstChiffre(SECRET)).toBe(false);
    expect(dechiffrerSecretTotp(SECRET)).toBe(SECRET);
  });

  it("sans clé : le secret reste en clair (comportement d'avant), mais une valeur chiffrée ne peut pas être lue", () => {
    const stocke = chiffrerSecretTotp(SECRET);
    env.totpEncryptionKey = null;
    expect(chiffrerSecretTotp(SECRET)).toBe(SECRET);
    expect(dechiffrerSecretTotp(SECRET)).toBe(SECRET);
    expect(() => dechiffrerSecretTotp(stocke)).toThrow(/TOTP_ENCRYPTION_KEY/);
  });
});
