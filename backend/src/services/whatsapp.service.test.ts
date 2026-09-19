import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { envoyerMessageWhatsapp, rentDueReminderWhatsapp, rentDueSoonReminderWhatsapp } from "./whatsapp.service";

describe("envoyerMessageWhatsapp", () => {
  const original = { ...env.whatsapp };

  afterEach(() => {
    env.whatsapp.accountSid = original.accountSid;
    env.whatsapp.authToken = original.authToken;
    env.whatsapp.from = original.from;
    vi.unstubAllGlobals();
  });

  it("simule l'envoi (ne fait aucun appel réseau) quand Twilio n'est pas configuré", async () => {
    env.whatsapp.accountSid = "";
    env.whatsapp.authToken = "";
    env.whatsapp.from = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await envoyerMessageWhatsapp("+221771234567", "Bonjour");

    expect(resultat).toEqual({ simulated: true, raison: "non_configure" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("une fois Twilio configuré", () => {
    beforeEach(() => {
      env.whatsapp.accountSid = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      env.whatsapp.authToken = "un_token_secret";
      env.whatsapp.from = "whatsapp:+14155238886";
    });

    it("refuse (sans appel réseau) un numéro sans indicatif pays reconnaissable", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("0600000000", "Bonjour");

      expect(resultat).toEqual({ simulated: true, error: true, raison: "numero_invalide" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("appelle l'API Twilio avec les bons paramètres (From/To préfixés whatsapp:, Basic Auth)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SMxxx" }) });
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221 77 123 45 67", "Bonjour Amine");

      expect(resultat).toEqual({ simulated: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${env.whatsapp.accountSid}/Messages.json`);
      expect(options.headers.Authorization).toBe(
        `Basic ${Buffer.from(`${env.whatsapp.accountSid}:${env.whatsapp.authToken}`).toString("base64")}`
      );
      const corps = new URLSearchParams(options.body as string);
      expect(corps.get("From")).toBe("whatsapp:+14155238886");
      expect(corps.get("To")).toBe("whatsapp:+221771234567");
      expect(corps.get("Body")).toBe("Bonjour Amine");
    });

    it("n'ajoute pas un second préfixe whatsapp: si TWILIO_WHATSAPP_FROM le porte déjà, et l'ajoute s'il manque", async () => {
      env.whatsapp.from = "+14155238886"; // sans préfixe cette fois
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);

      await envoyerMessageWhatsapp("+221771234567", "Bonjour");

      const corps = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
      expect(corps.get("From")).toBe("whatsapp:+14155238886");
    });

    it("renvoie une erreur (sans lever) quand Twilio répond en échec", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "numéro invalide côté Twilio" });
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "Bonjour");

      expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_api" });
    });

    it("renvoie une erreur (sans lever) en cas d'échec réseau", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "Bonjour");

      expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_reseau" });
    });
  });
});

describe("gabarits de messages WhatsApp", () => {
  it("rentDueReminderWhatsapp inclut le montant, le mois et le lien de paiement", () => {
    const texte = rentDueReminderWhatsapp({
      tenantName: "Amine Silva",
      propertyTitle: "Studio meublé",
      amount: 180,
      currency: "EUR",
      periodMonth: 9,
      periodYear: 2026,
      frontendUrl: "https://app.example.com",
    });

    expect(texte).toContain("Amine Silva");
    expect(texte).toContain("septembre 2026");
    expect(texte).toContain("180 €");
    expect(texte).toContain("https://app.example.com/portail/paiements");
  });

  it("rentDueSoonReminderWhatsapp mentionne le nombre de jours restants", () => {
    const texte = rentDueSoonReminderWhatsapp({
      tenantName: "Carla Neto",
      propertyTitle: "Villa avec jardin",
      amount: 650,
      currency: "XOF",
      periodMonth: 9,
      periodYear: 2026,
      daysLeft: 3,
      frontendUrl: "https://app.example.com",
    });

    expect(texte).toContain("Carla Neto");
    expect(texte).toContain("3 jours");
    expect(texte).toContain("650 XOF");
  });
});
