import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import {
  avisEcheanceWhatsapp,
  envoyerMessageWhatsapp,
  overdueReminderWhatsappVariables,
  rentDueDatedReminderWhatsappVariables,
  rentDueReminderWhatsappVariables,
  rentDueSoonReminderWhatsappVariables,
} from "./whatsapp.service";

/**
 * Audit par sabotage de whatsapp.service.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les lacunes : la langue et la méthode de l'appel à Meta, ce que les journaux laissent voir d'un numéro de téléphone,
 * les cas limites de la normalisation des variables (valeur absente, coupure d'un caractère à deux unités, espace en
 * bout de coupure), les douze noms de mois, la devise par défaut des trois modèles et deux détails du choix du modèle
 * d'avis d'échéance (année de l'échéance, avertissement).
 */

vi.mock("./whatsappUsage.service", () => ({ enregistrerEnvoiWhatsapp: vi.fn().mockResolvedValue(undefined) }));
const CONTEXTE = { managerId: "agence-test", type: "avis_echeance" } as const;

const original = { ...env.whatsapp };
let avertir: ReturnType<typeof vi.spyOn>;
let signaler: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  env.whatsapp.accessToken = "un_token_permanent_meta";
  env.whatsapp.phoneNumberId = "123456789012345";
  env.whatsapp.templateLanguage = "fr";
  avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
  signaler = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  env.whatsapp.accessToken = original.accessToken;
  env.whatsapp.phoneNumberId = original.phoneNumberId;
  env.whatsapp.templateLanguage = original.templateLanguage;
  env.whatsapp.templateNameRentDue = original.templateNameRentDue;
  env.whatsapp.templateNameRentDueDated = original.templateNameRentDueDated;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const journal = (espion: ReturnType<typeof vi.spyOn>) => JSON.stringify(espion.mock.calls);
const accepte = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
const corpsEnvoye = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe("configuration de l'API Meta", () => {
  it("un jeton sans identifiant de numéro n'est pas une configuration : envoi simulé, aucun appel réseau", async () => {
    env.whatsapp.accessToken = "un_token_permanent_meta";
    env.whatsapp.phoneNumberId = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "x" }, CONTEXTE);

    expect(resultat).toEqual({ simulated: true, raison: "non_configure" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("appel à Meta", () => {
  it("poste la requête, dans la langue configurée du modèle", async () => {
    env.whatsapp.templateLanguage = "en";
    const fetchMock = accepte();
    vi.stubGlobal("fetch", fetchMock);

    await envoyerMessageWhatsapp("+221771234567", "avis_echeance_loyer", { "1": "x" }, CONTEXTE);

    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(corpsEnvoye(fetchMock).template.language).toEqual({ code: "en" });
  });

  it("place les variables dans l'ordre de leur numéro, y compris au-delà de neuf", async () => {
    const fetchMock = accepte();
    vi.stubGlobal("fetch", fetchMock);

    await envoyerMessageWhatsapp("+221771234567", "modele", { "10": "dixième", "2": "deuxième", "1": "première" }, CONTEXTE);

    const textes = corpsEnvoye(fetchMock).template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(textes).toEqual(["première", "deuxième", "dixième"]);
  });
});

describe("normalisation d'une variable pour Meta", () => {
  const texteEnvoye = async (valeur: unknown) => {
    const fetchMock = accepte();
    vi.stubGlobal("fetch", fetchMock);
    await envoyerMessageWhatsapp("+221771234567", "modele", { "1": valeur as string }, CONTEXTE);
    return corpsEnvoye(fetchMock).template.components[0].parameters[0].text as string;
  };

  it("une valeur absente (undefined ou null) devient « - », pas le mot « undefined » ou « null »", async () => {
    expect(await texteEnvoye(undefined)).toBe("-");
    expect(await texteEnvoye(null)).toBe("-");
  });

  it("la coupure à 1 024 caractères ne scinde pas un caractère à deux unités et ne laisse pas d'espace à la fin", async () => {
    const avecEmoji = "a".repeat(1023) + "😀" + "b";
    expect(await texteEnvoye(avecEmoji)).toBe("a".repeat(1023) + "😀");

    const coupeSurEspace = "a".repeat(1023) + " b";
    expect(await texteEnvoye(coupeSurEspace)).toBe("a".repeat(1023));
  });
});

describe("ce que les journaux laissent voir d'un numéro", () => {
  it("un numéro illisible est masqué : un numéro court n'apparaît pas du tout, un numéro de 4 caractères non plus", async () => {
    await envoyerMessageWhatsapp("123", "modele", { "1": "x" }, CONTEXTE);
    expect(journal(avertir)).toContain("(***)");
    expect(journal(avertir)).not.toContain("123");

    avertir.mockClear();
    await envoyerMessageWhatsapp("1234", "modele", { "1": "x" }, CONTEXTE);
    expect(journal(avertir)).toContain("(***)");
    expect(journal(avertir)).not.toContain("1234");
  });

  it("un numéro illisible plus long est tronqué : seuls le début et les deux derniers chiffres figurent", async () => {
    await envoyerMessageWhatsapp("0612345678", "modele", { "1": "x" }, CONTEXTE);

    expect(journal(avertir)).toContain("0612***78");
    expect(journal(avertir)).not.toContain("0612345678");
  });

  it("un échec réseau et un échec de Meta masquent le numéro de la même façon (début de 4 caractères, 2 derniers chiffres)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("coupé")));
    await envoyerMessageWhatsapp("+221771234567", "modele", { "1": "x" }, CONTEXTE);
    expect(journal(signaler)).toContain("+221***67");
    expect(journal(signaler)).not.toContain("771234567");

    signaler.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "numéro refusé" }));
    await envoyerMessageWhatsapp("+221771234567", "modele", { "1": "x" }, CONTEXTE);
    expect(journal(signaler)).toContain("+221***67");
    expect(journal(signaler)).toContain("HTTP 400");
    expect(journal(signaler)).toContain("numéro refusé");
    expect(journal(signaler)).not.toContain("771234567");
  });

  it("un corps de réponse illisible ne fait pas lever l'envoi : l'échec est rendu, sans exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => Promise.reject(new Error("flux coupé")) }));

    const resultat = await envoyerMessageWhatsapp("+221771234567", "modele", { "1": "x" }, CONTEXTE);

    expect(resultat).toEqual({ simulated: false, error: true, raison: "erreur_api" });
  });
});

describe("mois en toutes lettres, devise par défaut", () => {
  const params = <T extends object = object>(periodMonth: number, extra: T = {} as T) => ({
    tenantName: "Amine",
    propertyTitle: "Studio",
    amount: 180,
    periodMonth,
    periodYear: 2026,
    frontendUrl: "https://app.example.com",
    ...extra,
  });
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  it.each(MOIS.map((nom, i) => [i + 1, nom] as const))("le mois %i s'écrit « %s » suivi de l'année", (numero, nom) => {
    expect(rentDueReminderWhatsappVariables(params(numero))["2"]).toBe(`${nom} 2026`);
  });

  it("un numéro de mois hors de 1 à 12 s'écrit tel quel plutôt que de laisser un blanc", () => {
    expect(rentDueReminderWhatsappVariables(params(13))["2"]).toBe("13 2026");
  });

  it("sans devise, les trois modèles écrivent le montant en euros", () => {
    const euros = /180\s€/;
    expect(rentDueReminderWhatsappVariables(params(6))["4"]).toMatch(euros);
    expect(rentDueDatedReminderWhatsappVariables(params(6, { dueDate: new Date("2026-06-24T00:00:00Z") }))["4"]).toMatch(euros);
    expect(overdueReminderWhatsappVariables(params(6, { daysLate: 3 }))["4"]).toMatch(euros);
  });

  it("le modèle de rappel avant échéance écrit le montant dans sa devise", () => {
    expect(rentDueSoonReminderWhatsappVariables(params(6, { currency: "XOF", daysLeft: 3 }))["5"].replace(/[\s  ]/g, "")).toBe("180FCFA");
  });
});

describe("choix du modèle d'avis d'échéance", () => {
  const avis = (dueDate: Date, periodMonth = 3, periodYear = 2026) => ({
    tenantName: "Amine",
    propertyTitle: "Studio",
    amount: 180,
    currency: "EUR",
    periodMonth,
    periodYear,
    dueDate,
    frontendUrl: "https://app.example.com",
  });

  it("une échéance au 5 du même mois mais d'une AUTRE année n'est pas « le 5 » du mois facturé", () => {
    env.whatsapp.templateNameRentDueDated = "";
    env.whatsapp.templateNameRentDue = "avis_echeance_loyer";

    const autreAnnee = avisEcheanceWhatsapp(avis(new Date(2027, 2, 5), 3, 2026));
    expect(autreAnnee.templateName).toBe("");

    const memeAnnee = avisEcheanceWhatsapp(avis(new Date(2026, 2, 5), 3, 2026));
    expect(memeAnnee.templateName).toBe("avis_echeance_loyer");
  });

  it("sans ancien modèle configuré, aucun avertissement n'est émis ; avec lui, une échéance hors du 5 en émet un", () => {
    env.whatsapp.templateNameRentDueDated = "";
    env.whatsapp.templateNameRentDue = "";
    avisEcheanceWhatsapp(avis(new Date(2026, 2, 24)));
    expect(avertir).not.toHaveBeenCalled();

    env.whatsapp.templateNameRentDue = "avis_echeance_loyer";
    avisEcheanceWhatsapp(avis(new Date(2026, 2, 24)));
    expect(avertir).toHaveBeenCalledTimes(1);

    avertir.mockClear();
    avisEcheanceWhatsapp(avis(new Date(2026, 2, 5)));
    expect(avertir).not.toHaveBeenCalled();
  });
});
