import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import {
  avisEcheanceWhatsapp,
  envoyerMessageWhatsapp,
  rentDueReminderWhatsappVariables,
  rentDueSoonReminderWhatsappVariables,
} from "./whatsapp.service";

describe("envoyerMessageWhatsapp", () => {
  const original = { ...env.whatsapp };

  afterEach(() => {
    env.whatsapp.accessToken = original.accessToken;
    env.whatsapp.phoneNumberId = original.phoneNumberId;
    env.whatsapp.templateLanguage = original.templateLanguage;
    vi.unstubAllGlobals();
  });

  it("simule l'envoi (ne fait aucun appel réseau) quand l'API Meta n'est pas configurée", async () => {
    env.whatsapp.accessToken = "";
    env.whatsapp.phoneNumberId = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "Bonjour" });

    expect(resultat).toEqual({ simulated: true, raison: "non_configure" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("une fois l'API Meta configurée", () => {
    beforeEach(() => {
      env.whatsapp.accessToken = "un_token_permanent_meta";
      env.whatsapp.phoneNumberId = "123456789012345";
      env.whatsapp.templateLanguage = "fr";
    });

    it("simule l'envoi (sans appel réseau) quand le modèle (Message Template Meta) n'est pas configuré", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: true, raison: "modele_non_configure" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuse (sans appel réseau) un numéro sans indicatif pays reconnaissable", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("0600000000", "avis_echeance_loyer", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: true, error: true, raison: "numero_invalide" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("appelle l'API Meta WhatsApp Cloud avec les bons paramètres (URL Graph, Bearer, modèle/langue/paramètres positionnels)", async () => {
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
      // La version fait partie du contrat d'appel : la voir écrite ici oblige
      // à passer par ce test le jour où on la change, plutôt que de la faire
      // dériver sans s'en apercevoir (voir META_GRAPH_API_VERSION).
      expect(url).toBe(`https://graph.facebook.com/v25.0/${env.whatsapp.phoneNumberId}/messages`);
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

    it("ordonne les paramètres positionnellement même si les clés des variables sont fournies dans le désordre", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);

      await envoyerMessageWhatsapp("+221771234567", "rappel_avant_echeance_loyer", {
        "3": "Studio meublé",
        "1": "Amine",
        "2": "septembre 2026",
      });

      const corps = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(corps.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
        "Amine",
        "septembre 2026",
        "Studio meublé",
      ]);
    });

    it("renvoie une erreur (sans lever) quand Meta répond en échec", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"message":"Template not found"}}' });
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_api" });
    });

    it("renvoie une erreur (sans lever) en cas d'échec réseau", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      vi.stubGlobal("fetch", fetchMock);

      const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "Bonjour" });

      expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_reseau" });
    });
  });
});

describe("variables des modèles WhatsApp (Message Templates)", () => {
  it("rentDueReminderWhatsappVariables fournit le nom, le mois/année, le bien, le montant et le lien de paiement", () => {
    const variables = rentDueReminderWhatsappVariables({
      tenantName: "Amine Silva",
      propertyTitle: "Studio meublé",
      amount: 180,
      currency: "EUR",
      periodMonth: 9,
      periodYear: 2026,
      frontendUrl: "https://app.example.com",
    });

    expect(variables).toEqual({
      "1": "Amine Silva",
      "2": "septembre 2026",
      "3": "Studio meublé",
      "4": "180 €",
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
      "5": "650 FCFA",
      "6": "https://app.example.com/portail/paiements",
    });
  });
});

/**
 * L'ancien modèle Meta "avis_echeance_loyer" écrit « au plus tard le 5 » en
 * dur : le locataire d'un bail dû le 24 recevait par WhatsApp une date fausse,
 * contredite par l'email. avisEcheanceWhatsapp choisit le modèle à envoyer.
 */
describe("avisEcheanceWhatsapp — la date annoncée est celle de la facture", () => {
  const original = { ...env.whatsapp };
  const avis = (dueDate: Date) => ({
    tenantName: "Amine Silva",
    propertyTitle: "Studio meublé",
    amount: 180,
    currency: "EUR",
    periodMonth: 10,
    periodYear: 2026,
    dueDate,
    frontendUrl: "https://app.example.com",
  });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    env.whatsapp.templateNameRentDue = original.templateNameRentDue;
    env.whatsapp.templateNameRentDueDated = original.templateNameRentDueDated;
    vi.restoreAllMocks();
  });

  it("utilise le modèle daté quand il est configuré, avec la vraie date limite en {{5}}", () => {
    env.whatsapp.templateNameRentDue = "avis_echeance_loyer";
    env.whatsapp.templateNameRentDueDated = "avis_echeance_loyer_date";

    const { templateName, variables } = avisEcheanceWhatsapp(avis(new Date(2026, 9, 24)));

    expect(templateName).toBe("avis_echeance_loyer_date");
    expect(variables).toEqual({
      "1": "Amine Silva",
      "2": "octobre 2026",
      "3": "Studio meublé",
      "4": "180 €",
      "5": "24 octobre 2026",
      "6": "https://app.example.com/portail/paiements",
    });
  });

  it("garde l'ancien modèle « le 5 » pour une facture réellement due le 5 du mois facturé", () => {
    env.whatsapp.templateNameRentDue = "avis_echeance_loyer";
    env.whatsapp.templateNameRentDueDated = "";

    const { templateName, variables } = avisEcheanceWhatsapp(avis(new Date(2026, 9, 5)));

    expect(templateName).toBe("avis_echeance_loyer");
    expect(Object.keys(variables)).toEqual(["1", "2", "3", "4", "5"]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("n'envoie PAS l'ancien modèle quand la facture est due un autre jour (il annoncerait une date fausse)", () => {
    env.whatsapp.templateNameRentDue = "avis_echeance_loyer";
    env.whatsapp.templateNameRentDueDated = "";

    expect(avisEcheanceWhatsapp(avis(new Date(2026, 9, 24))).templateName).toBe("");
    // Le 5 d'un AUTRE mois que celui facturé n'est pas « le 5 octobre 2026 » non plus.
    expect(avisEcheanceWhatsapp(avis(new Date(2026, 10, 5))).templateName).toBe("");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("META_WHATSAPP_TEMPLATE_RENT_DUE_DATED"));
  });

  it("aboutit à un envoi simulé (sans appel réseau), comme un modèle non configuré", async () => {
    env.whatsapp.templateNameRentDue = "avis_echeance_loyer";
    env.whatsapp.templateNameRentDueDated = "";
    const accessToken = env.whatsapp.accessToken;
    const phoneNumberId = env.whatsapp.phoneNumberId;
    env.whatsapp.accessToken = "un_token_permanent_meta";
    env.whatsapp.phoneNumberId = "123456789012345";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { templateName, variables } = avisEcheanceWhatsapp(avis(new Date(2026, 9, 24)));
      const resultat = await envoyerMessageWhatsapp("+221771234567", templateName, variables);

      expect(resultat).toEqual({ simulated: true, raison: "modele_non_configure" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      env.whatsapp.accessToken = accessToken;
      env.whatsapp.phoneNumberId = phoneNumberId;
      vi.unstubAllGlobals();
    }
  });
});
