import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { envoyerMessageWhatsapp, rentDueReminderWhatsappVariables, rentDueSoonReminderWhatsappVariables } from "./whatsapp.service";

describe("envoyerMessageWhatsapp", () => {
  const original = { ...env.whatsapp };

  afterEach(() => {
    env.whatsapp.accessToken = original.accessToken;
    env.whatsapp.phoneNumberId = original.phoneNumberId;
    env.whatsapp.templateLanguage = original.templateLanguage;
    vi.unstubAllGlobals();
  });

  it("simule l'envoi (ne fait aucun appel rÃ©seau) quand l'API Meta n'est pas configurÃ©e", async () => {
    env.whatsapp.accessToken = "";
    env.whatsapp.phoneNumberId = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "Bonjour" });

    expect(resultat).toEqual({ simulated: true, raison: "non_configure" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("une fois l'API Meta configurÃ©e", () => {
    beforeEach(() => {
      env.whatsapp.accessToken = "un_token_permanent_meta";
      env.whatsapp.phoneNumberId = "123456789012345";
      env.whatsapp.templateLanguage = "fr";
    });

    it("simule l'envoi (sans appel rÃ©seau) quand le modÃ¨le (Message Template Meta) n'est pas configurÃ©", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: true, raison: "modele_non_configure" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuse (sans appel rÃ©seau) un numÃ©ro sans indicatif pays reconnaissable", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("0600000000", "avis_echeance_loyer", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: true, error: true, raison: "numero_invalide" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("appelle l'API Meta WhatsApp Cloud avec les bons paramÃ¨tres (URL Graph, Bearer, modÃ¨le/langue/paramÃ¨tres positionnels)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.xxx" }] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221 77 123 45 67", "avis_echeance_loyer", {
        "1": "Amine",
        "2": "septembre 2026",
      });

      expect(resultat).toEqual({ simulated: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://graph.facebook.com/v21.0/${env.whatsapp.phoneNumberId}/messages`);
      expect(options.headers.Authorization).toBe(`Bearer ${env.whatsapp.accessToken}`);
      expect(options.headers["Content-Type"]).toBe("application/json");

      const corps = JSON.parse(options.body as string);
      expect(corps).toEqual({
        messaging_product: "whatsapp",
        to: "221771234567",
        type: "template",
        template: {
          name: "avis_echeance_loyer",
          language: { code: "fr" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: "Amine" },
                { type: "text", text: "septembre 2026" },
              ],
            },
          ],
        },
      });
    });

    it("ordonne les paramÃ¨tres positionnellement mÃªme si les clÃ©s des variables sont fournies dans le dÃ©sordre", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);

      await envoyerMessageWhatsapp("+221771234567", "rappel_avant_echeance_loyer", {
        "3": "Studio meublÃ©",
        "1": "Amine",
        "2": "septembre 2026",
      });

      const corps = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(corps.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
        "Amine",
        "septembre 2026",
        "Studio meublÃ©",
      ]);
    });

    it("renvoie une erreur (sans lever) quand Meta rÃ©pond en Ã©chec", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"message":"Template not found"}}' });
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_api" });
    });

    it("renvoie une erreur (sans lever) en cas d'Ã©chec rÃ©seau", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_reseau" });
    });
  });
});

describe("variables des modÃ¨les WhatsApp (Message Templates)", () => {
  it("rentDueReminderWhatsappVariables fournit le nom, le mois/annÃ©e, le bien, le montant et le lien de paiement", () => {
    const variables = rentDueReminderWhatsappVariables({
      tenantName: "Amine Silva",
      propertyTitle: "Studio meublÃ©",
      amount: 180,
      currency: "EUR",
      periodMonth: 9,
      periodYear: 2026,
      frontendUrl: "https://app.example.com",
    });

    expect(variables).toEqual({
      "1": "Amine Silva",
      "2": "septembre 2026",
      "3": "Studio meublÃ©",
      "4": "180 â‚¬",
      "5": "https://app.example.com/portail/paiements",
    });
  });

  it("rentDueSoonReminderWhatsappVariables ajoute le nombre de jours restants", () => {
    const variables = rentDueSoonReminderWhatsappVariables({
      tenantName: "Carla Neto",
      propertyTitle: "Villa avec jardin",
      amount: 650,
      currency: "XOF",
      periodMonth: 9,
      periodYear: 2026,
      daysLeft: 3,
      frontendUrl: "https://app.example.com",
    });

    expect(variables).toEqual({
      "1": "Carla Neto",
      "2": "septembre 2026",
      "3": "Villa avec jardin",
      "4": "3",
      "5": "650 XOF",
      "6": "https://app.example.com/portail/paiements",
    });
  });
});