import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agencySettings, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { createContract, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { adresseDeReponseAgence, oublierAdressesDeReponse } from "./reponseAgence.service";
import { runRentDueReminders } from "./reminder.service";

/**
 * Les e-mails partent de l'adresse de la plateforme. Sans « Reply-To », la réponse d'un locataire à un rappel de loyer
 * (« je paie vendredi ») arrivait dans la boîte de la plateforme, que l'agence ne lit pas. C'est l'adresse de contact de
 * l'agence (Mon agence → Email) qui sert, quand elle est renseignée — jamais l'adresse de connexion du gestionnaire.
 */
async function agenceAvecEmail(email: string | null) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Baobab", email });
  return manager;
}

describe("adresse de réponse d'une agence", () => {
  it("renvoie l'adresse de contact renseignée dans « Mon agence »", async () => {
    const manager = await agenceAvecEmail("contact@baobab.sn");
    expect(await adresseDeReponseAgence(manager.id)).toBe("contact@baobab.sn");
  });

  it("n'invente rien : adresse absente, vide ou mal formée → pas de Reply-To", async () => {
    for (const email of [null, "", "   ", "pas-une-adresse", "a@b", "x@y.sn\r\nBcc: pirate@evil.test", "deux@adresses.sn, autre@adresses.sn"]) {
      oublierAdressesDeReponse();
      const manager = await agenceAvecEmail(email);
      expect(await adresseDeReponseAgence(manager.id), String(email)).toBeUndefined();
    }
  });

  it("ne donne JAMAIS l'adresse de connexion du gestionnaire quand l'agence n'a rien renseigné", async () => {
    const manager = await agenceAvecEmail(null);
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.email).toBeTruthy();
    expect(await adresseDeReponseAgence(manager.id)).toBeUndefined();
  });

  it("une agence sans réglages, ou un identifiant absent, ne fait pas échouer l'envoi", async () => {
    const manager = await createManager();
    expect(await adresseDeReponseAgence(manager.id)).toBeUndefined();
    expect(await adresseDeReponseAgence(null)).toBeUndefined();
    expect(await adresseDeReponseAgence(undefined)).toBeUndefined();
  });

  it("garde l'adresse en mémoire un court instant (une relance en lot écrit à toute une agence), et l'oublie sur demande", async () => {
    const manager = await agenceAvecEmail("contact@baobab.sn");
    expect(await adresseDeReponseAgence(manager.id)).toBe("contact@baobab.sn");

    await testDb.update(agencySettings).set({ email: "nouvelle@baobab.sn" }).where(eq(agencySettings.userId, manager.id));
    expect(await adresseDeReponseAgence(manager.id)).toBe("contact@baobab.sn");

    oublierAdressesDeReponse();
    expect(await adresseDeReponseAgence(manager.id)).toBe("nouvelle@baobab.sn");
  });
});

describe("envois aux locataires : le Reply-To est celui de l'agence", () => {
  let envoi: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
    envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function avisDuMois(emailAgence: string | null) {
    const manager = await agenceAvecEmail(emailAgence);
    const property = await createProperty(manager.id, { title: "Studio Almadies" });
    const locataire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@test.local" });
    await createContract(property.id, locataire.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    await runRentDueReminders();
    return envoi.mock.calls.find((c: unknown[]) => c[0] === "awa@test.local") as unknown[];
  }

  it("l'avis d'échéance du mois part avec l'adresse de l'agence en réponse", async () => {
    const appel = await avisDuMois("contact@baobab.sn");
    expect(appel[4]).toEqual({ replyTo: "contact@baobab.sn" });
  });

  it("sans adresse d'agence, aucune adresse de réponse n'est ajoutée", async () => {
    const appel = await avisDuMois(null);
    expect(appel[4]).toEqual({ replyTo: undefined });
  });
});
