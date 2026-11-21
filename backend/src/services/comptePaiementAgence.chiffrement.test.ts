import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { agencyPaymentAccounts } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import {
  agenceAUnComptePaiement,
  chargerCompteEncaissant,
  chiffrementDisponible,
  enregistrerCompteAgence,
  lireIdentifiantsAgence,
  lireResumeAgence,
} from "./comptePaiementAgence.service";

/**
 * Le chiffrement des identifiants de paiement des agences : ce qui se passe quand la clé change, disparaît ou est mal
 * formée, ou quand une valeur en base est altérée. Dans tous ces cas le compte doit être traité comme NON configuré (jamais
 * d'identifiants approximatifs, jamais d'erreur qui remonte jusqu'au locataire qui paie), et aucun secret ne doit finir
 * dans les journaux.
 */

const CLE_HEX = "ab".repeat(32);
const AUTRE_CLE_HEX = "cd".repeat(32);
const SECRETS = { masterKey: "MASTER-SECRETE-123456", privateKey: "PRIVEE-SECRETE-123456", token: "TOKEN-SECRET-WXYZ" };

async function agenceAvecCompte() {
  const manager = await createManager();
  await enregistrerCompteAgence(manager.id, { ...SECRETS, mode: "live", currency: "xof", enabled: true });
  return manager;
}

describe("chiffrement des identifiants de paiement des agences", () => {
  const cleOriginale = env.payments.keysEncryptionKey;

  beforeEach(() => {
    env.payments.keysEncryptionKey = CLE_HEX;
  });
  afterEach(() => {
    env.payments.keysEncryptionKey = cleOriginale;
    vi.restoreAllMocks();
  });

  it("relit les identifiants enregistrés avec une clé en hexadécimal", async () => {
    const manager = await agenceAvecCompte();

    const identifiants = await lireIdentifiantsAgence(manager.id);

    expect(identifiants).toMatchObject({ ...SECRETS, mode: "live", currency: "XOF" });
  });

  it("accepte aussi une clé de 32 octets en base64", async () => {
    env.payments.keysEncryptionKey = Buffer.alloc(32, 7).toString("base64");
    expect(chiffrementDisponible()).toBe(true);
    const manager = await agenceAvecCompte();

    expect(await lireIdentifiantsAgence(manager.id)).toMatchObject(SECRETS);
  });

  it("refuse une clé absente ou mal formée (trop courte, base64 de 16 octets) : le chiffrement n'est pas disponible", async () => {
    for (const mauvaise of ["", "   ", "abc", Buffer.alloc(16, 1).toString("base64")]) {
      env.payments.keysEncryptionKey = mauvaise;
      expect(chiffrementDisponible(), `clé « ${mauvaise} »`).toBe(false);
    }
    const manager = await createManager();
    await expect(enregistrerCompteAgence(manager.id, { ...SECRETS, mode: "test", currency: "XOF", enabled: true })).rejects.toMatchObject({
      statusCode: 503,
      code: "AGENCY_PAYMENTS_UNAVAILABLE",
    });
  });

  it("traite le compte comme non configuré quand la clé a changé, sans jamais afficher un secret dans les journaux", async () => {
    const manager = await agenceAvecCompte();
    env.payments.keysEncryptionKey = AUTRE_CLE_HEX;
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await lireIdentifiantsAgence(manager.id)).toBeNull();
    expect(await chargerCompteEncaissant(manager.id)).toBeNull();
    expect(await agenceAUnComptePaiement(manager.id)).toBe(false);

    const journal = erreur.mock.calls.flat().join(" ");
    expect(journal).toContain(manager.id);
    expect(journal).toContain("illisibles");
    for (const secret of Object.values(SECRETS)) expect(journal).not.toContain(secret);
  });

  it("traite le compte comme non configuré quand la clé a disparu", async () => {
    const manager = await agenceAvecCompte();
    env.payments.keysEncryptionKey = "";
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await lireIdentifiantsAgence(manager.id)).toBeNull();
  });

  it("refuse une valeur altérée en base (l'authentification GCM échoue), au lieu de renvoyer un identifiant faux", async () => {
    const manager = await agenceAvecCompte();
    const [ligne] = await testDb.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, manager.id));
    const [iv, tag, donnees] = ligne.tokenEnc.split(".");
    const donneesAlterees = Buffer.from(donnees, "base64");
    donneesAlterees[0] ^= 0xff;
    await testDb
      .update(agencyPaymentAccounts)
      .set({ tokenEnc: [iv, tag, donneesAlterees.toString("base64")].join(".") })
      .where(eq(agencyPaymentAccounts.managerId, manager.id));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await lireIdentifiantsAgence(manager.id)).toBeNull();
  });

  it("refuse une valeur mal formée en base (il manque une partie)", async () => {
    const manager = await agenceAvecCompte();
    await testDb.update(agencyPaymentAccounts).set({ masterKeyEnc: "pas-un-chiffre" }).where(eq(agencyPaymentAccounts.managerId, manager.id));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await lireIdentifiantsAgence(manager.id)).toBeNull();
    expect(await agenceAUnComptePaiement(manager.id)).toBe(false);
  });

  it("n'expose à l'interface que les quatre derniers caractères du jeton, jamais un identifiant", async () => {
    const manager = await agenceAvecCompte();

    const resume = await lireResumeAgence(manager.id);

    expect(resume).toEqual({ configure: true, enabled: true, mode: "live", currency: "XOF", tokenLast4: "WXYZ" });
    const brut = JSON.stringify(resume);
    for (const secret of Object.values(SECRETS)) expect(brut).not.toContain(secret);
  });

  it("chiffre chaque valeur avec un IV différent : deux enregistrements du même secret ne se ressemblent pas", async () => {
    const a = await agenceAvecCompte();
    const b = await agenceAvecCompte();

    const [ligneA] = await testDb.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, a.id));
    const [ligneB] = await testDb.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, b.id));

    expect(ligneA.tokenEnc).not.toBe(ligneB.tokenEnc);
    expect(ligneA.tokenEnc).not.toContain(SECRETS.token);
  });
});
