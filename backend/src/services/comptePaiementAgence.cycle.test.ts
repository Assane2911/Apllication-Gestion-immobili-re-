import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { agencyPaymentAccounts, agencySettings } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import {
  agenceAUnComptePaiement,
  basculerCompteAgence,
  chargerCompteEncaissant,
  enregistrerCompteAgence,
  lireIdentifiantsAgence,
  lireResumeAgence,
  supprimerCompteAgence,
} from "./comptePaiementAgence.service";

/**
 * La vie du compte PayDunya d'une agence : enregistrer, remplacer, suspendre, réactiver, supprimer. Un compte suspendu ne doit
 * plus encaisser (aucun identifiant ne sort), un compte supprimé non plus, et agir sur une agence ne touche jamais l'autre : un
 * loyer payé par Mobile Money doit arriver sur le compte de SON agence.
 */

const CLE_HEX = "ab".repeat(32);
const SECRETS = { masterKey: "MASTER-AAAA-1111", privateKey: "PRIVEE-BBBB-2222", token: "TOKEN-CCCC-3333" };

async function agenceAvecCompte(extra: Partial<Parameters<typeof enregistrerCompteAgence>[1]> = {}) {
  const manager = await createManager();
  await enregistrerCompteAgence(manager.id, { ...SECRETS, mode: "live", currency: "xof", enabled: true, ...extra });
  return manager;
}
const lignes = (managerId: string) => testDb.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, managerId));

describe("compte de paiement d'une agence : enregistrer, suspendre, supprimer", () => {
  const cleOriginale = env.payments.keysEncryptionKey;

  beforeEach(() => {
    env.payments.keysEncryptionKey = CLE_HEX;
  });
  afterEach(() => {
    env.payments.keysEncryptionKey = cleOriginale;
    vi.restoreAllMocks();
  });

  describe("enregistrer", () => {
    it("range la devise en majuscules, garde les quatre derniers caractères du jeton et ne stocke aucun identifiant en clair", async () => {
      const manager = await agenceAvecCompte({ currency: "xof" });

      const [ligne] = await lignes(manager.id);
      expect(ligne.currency).toBe("XOF");
      expect(ligne.tokenLast4).toBe("3333");
      expect(ligne.provider).toBe("PAYDUNYA");
      const brut = JSON.stringify(ligne);
      for (const secret of Object.values(SECRETS)) expect(brut).not.toContain(secret);
    });

    it("enregistrer une seconde fois remplace le compte (une seule ligne) : nouveaux identifiants, mode et devise", async () => {
      const manager = await agenceAvecCompte({ mode: "test", currency: "XOF" });

      await enregistrerCompteAgence(manager.id, { masterKey: "NEUF-MASTER", privateKey: "NEUF-PRIVEE", token: "NEUF-TOKEN-9999", mode: "live", currency: "eur", enabled: true });

      expect(await lignes(manager.id)).toHaveLength(1);
      expect(await lireIdentifiantsAgence(manager.id)).toMatchObject({ masterKey: "NEUF-MASTER", privateKey: "NEUF-PRIVEE", token: "NEUF-TOKEN-9999", mode: "live", currency: "EUR" });
      expect((await lireResumeAgence(manager.id)).tokenLast4).toBe("9999");
    });

    it("un mode inconnu en base est lu comme « test » : jamais un encaissement réel par accident", async () => {
      const manager = await agenceAvecCompte();
      await testDb.update(agencyPaymentAccounts).set({ mode: "prod" }).where(eq(agencyPaymentAccounts.managerId, manager.id));

      expect((await lireIdentifiantsAgence(manager.id))?.mode).toBe("test");
      expect((await lireResumeAgence(manager.id)).mode).toBe("test");
    });
  });

  describe("suspendre et réactiver", () => {
    it("un compte suspendu ne livre plus d'identifiants, n'encaisse plus, mais reste enregistré ; le réactiver rend les mêmes identifiants", async () => {
      const manager = await agenceAvecCompte();

      expect(await basculerCompteAgence(manager.id, false)).toBe(true);

      expect(await lireIdentifiantsAgence(manager.id)).toBeNull();
      expect(await chargerCompteEncaissant(manager.id)).toBeNull();
      expect(await agenceAUnComptePaiement(manager.id)).toBe(false);
      expect(await lireResumeAgence(manager.id)).toMatchObject({ configure: true, enabled: false, tokenLast4: "3333" });

      expect(await basculerCompteAgence(manager.id, true)).toBe(true);
      expect(await lireIdentifiantsAgence(manager.id)).toMatchObject(SECRETS);
      expect(await agenceAUnComptePaiement(manager.id)).toBe(true);
    });

    it("suspendre une agence qui n'a pas de compte renvoie « introuvable » sans rien créer", async () => {
      const manager = await createManager();

      expect(await basculerCompteAgence(manager.id, true)).toBe(false);

      expect(await lignes(manager.id)).toHaveLength(0);
    });

    it("suspendre une agence ne touche pas le compte d'une autre", async () => {
      const a = await agenceAvecCompte();
      const b = await agenceAvecCompte({ token: "TOKEN-AUTRE-7777" });

      await basculerCompteAgence(a.id, false);

      expect(await agenceAUnComptePaiement(a.id)).toBe(false);
      expect(await agenceAUnComptePaiement(b.id)).toBe(true);
      expect((await lireIdentifiantsAgence(b.id))?.token).toBe("TOKEN-AUTRE-7777");
    });
  });

  describe("supprimer", () => {
    it("efface le compte : plus d'identifiants, plus de résumé « configuré », et recommencer un enregistrement fonctionne", async () => {
      const manager = await agenceAvecCompte();

      await supprimerCompteAgence(manager.id);

      expect(await lignes(manager.id)).toHaveLength(0);
      expect(await lireIdentifiantsAgence(manager.id)).toBeNull();
      expect(await lireResumeAgence(manager.id)).toEqual({ configure: false, enabled: false, mode: "test", currency: "XOF", tokenLast4: "" });

      await enregistrerCompteAgence(manager.id, { ...SECRETS, mode: "test", currency: "XOF", enabled: true });
      expect(await agenceAUnComptePaiement(manager.id)).toBe(true);
    });

    it("supprimer le compte d'une agence ne touche pas celui d'une autre, et supprimer sans compte ne fait pas d'erreur", async () => {
      const a = await agenceAvecCompte();
      const b = await agenceAvecCompte();
      const sansCompte = await createManager();

      await supprimerCompteAgence(a.id);
      await expect(supprimerCompteAgence(sansCompte.id)).resolves.toBeUndefined();

      expect(await agenceAUnComptePaiement(a.id)).toBe(false);
      expect(await agenceAUnComptePaiement(b.id)).toBe(true);
    });
  });

  describe("le compte qui encaisse un loyer", () => {
    it("porte le nom de l'agence, montré au locataire sur la page de paiement, et l'identité de l'agence qui encaisse", async () => {
      const manager = await agenceAvecCompte();
      await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "  Agence du Port  " });

      const compte = await chargerCompteEncaissant(manager.id);

      expect(compte?.nomAgence).toBe("Agence du Port");
      expect(compte?.managerId).toBe(manager.id);
      expect(compte?.identifiants).toMatchObject(SECRETS);
    });

    it("sans réglages d'agence, ou avec un nom vide, le locataire voit « Agence » plutôt qu'un blanc", async () => {
      const sansReglages = await agenceAvecCompte();
      expect((await chargerCompteEncaissant(sansReglages.id))?.nomAgence).toBe("Agence");

      const nomVide = await agenceAvecCompte();
      await testDb.insert(agencySettings).values({ userId: nomVide.id, agencyName: "   " });
      expect((await chargerCompteEncaissant(nomVide.id))?.nomAgence).toBe("Agence");
    });

    it("jamais le compte d'une autre agence : chaque agence encaisse sur SES identifiants", async () => {
      const a = await agenceAvecCompte({ token: "TOKEN-A-1111" });
      const b = await agenceAvecCompte({ token: "TOKEN-B-2222" });

      expect((await chargerCompteEncaissant(a.id))?.identifiants.token).toBe("TOKEN-A-1111");
      expect((await chargerCompteEncaissant(b.id))?.identifiants.token).toBe("TOKEN-B-2222");
    });
  });
});
