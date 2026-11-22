import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contracts, invoices, properties } from "../db/schema";
import { createContract, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import type { CsvLu } from "../utils/csvImport";
import { MONTANT_MAXIMUM } from "../utils/montant";
import { analyserContrats, importerContrats, type DonneesContrat } from "./import.service";

/**
 * Analyse et écriture de l'import de contrats, appelées directement avec une date « d'aujourd'hui » fixée : rapprochement du bien et
 * du locataire, chaque règle de ligne (montants, dates, jour d'échéance, type, droit, statut), le premier mois facturé, les
 * doublons et chevauchements, et l'écriture qui revérifie l'agence et le chevauchement sous verrou. Le fichier des routes vérifie le
 * parcours ; ici, chaque règle du tableur.
 */

/** Dimanche 12 octobre 2026 : le mois courant est octobre 2026. */
const MAINTENANT = new Date(Date.UTC(2026, 9, 12, 9, 0, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
});
afterEach(() => vi.useRealTimers());

const ENTETES = ["bien", "adressebien", "emaillocataire", "loyer", "depot", "devise", "debut", "fin", "jourecheance", "typedebail", "droitapplicable", "statut", "facturationdepuis"];

function fichier(lignes: Array<Record<string, string>>, entetes = ENTETES): CsvLu {
  return { delimiteur: ";", entetes, lignes: lignes.map((valeurs, i) => ({ ligne: i + 2, valeurs })) };
}

const ligneOk = (extra: Record<string, string> = {}): Record<string, string> => ({
  bien: "Studio Centre-ville",
  emaillocataire: "moussa.diop@example.com",
  loyer: "250000",
  depot: "500000",
  debut: "01/03/2026",
  fin: "28/02/2028",
  ...extra,
});

async function agence() {
  const manager = await createManager();
  const studio = await createProperty(manager.id, { title: "Studio Centre-ville", address: "12 rue des Écoles", currency: "XOF" });
  const villa = await createProperty(manager.id, { title: "Villa B", address: "3 avenue Ndiaye", currency: "EUR" });
  const moussa = await createTenant(manager.id, { email: "moussa.diop@example.com" });
  const awa = await createTenant(manager.id, { email: "awa@example.com" });
  return { manager, studio, villa, moussa, awa };
}

const analyser = (managerId: string, lignes: Array<Record<string, string>>, entetes?: string[]) => analyserContrats(managerId, fichier(lignes, entetes), MAINTENANT);
const codes = (l: { details: Array<{ code: string }> }) => l.details.map((d) => d.code);

describe("analyserContrats : rapprochement du bien et du locataire", () => {
  it("une ligne complète est valide : bien et locataire retrouvés, devise du bien, valeurs lues", async () => {
    const { manager, studio, moussa } = await agence();

    const a = await analyser(manager.id, [ligneOk()]);

    expect(a.type).toBe("contracts");
    expect(a.lignes[0]).toMatchObject({
      statut: "OK",
      messages: [],
      donnees: {
        property: "Studio Centre-ville",
        propertyId: studio.id,
        tenantEmail: "moussa.diop@example.com",
        tenantId: moussa.id,
        rent: 250000,
        deposit: 500000,
        currency: "XOF",
        startDate: "2026-03-01",
        endDate: "2028-02-28",
        paymentDay: null,
        leaseType: "HABITATION",
        applicableLaw: null,
        status: "ACTIVE",
      },
    });
    expect(a.resume).toEqual({ total: 1, valides: 1, doublons: 0, erreurs: 0 });
  });

  it("bien : manquant, introuvable (avec le titre), ou retrouvé sans tenir compte des accents, majuscules et espaces", async () => {
    const { manager, studio } = await agence();

    const a = await analyser(manager.id, [ligneOk({ bien: "" }), ligneOk({ bien: "Inconnu" }), ligneOk({ bien: "  STUDIO   centre-ville " })]);

    expect(a.lignes[0].details).toEqual([{ code: "IMPORT_ROW_PROPERTY_MISSING" }]);
    expect(a.lignes[1].details).toEqual([{ code: "IMPORT_ROW_PROPERTY_NOT_FOUND", params: { title: "Inconnu" } }]);
    expect(a.lignes[1].messages[0]).toContain("Importez d'abord vos biens");
    expect(a.lignes[2]).toMatchObject({ statut: "OK", donnees: { propertyId: studio.id } });
  });

  it("deux biens de même titre : ambigu sans adresse, départagés par l'adresse, introuvable si l'adresse ne correspond à aucun", async () => {
    const { manager } = await agence();
    const a1 = await createProperty(manager.id, { title: "Duplex", address: "1 rue A" });
    await createProperty(manager.id, { title: "Duplex", address: "2 rue B" });

    const a = await analyser(manager.id, [ligneOk({ bien: "Duplex" }), ligneOk({ bien: "Duplex", adressebien: "1 RUE a" }), ligneOk({ bien: "Duplex", adressebien: "9 rue Z" })]);

    expect(a.lignes[0].details).toEqual([{ code: "IMPORT_ROW_PROPERTY_AMBIGUOUS", params: { title: "Duplex" } }]);
    expect(a.lignes[0].messages[0]).toContain("adresse_bien");
    expect(a.lignes[1]).toMatchObject({ statut: "OK", donnees: { propertyId: a1.id } });
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_PROPERTY_NOT_FOUND"]);
  });

  it("une adresse donnée pour un titre unique n'est pas exigée : le titre suffit", async () => {
    const { manager, studio } = await agence();

    const a = await analyser(manager.id, [ligneOk({ adressebien: "n'importe quoi" })]);

    expect(a.lignes[0]).toMatchObject({ statut: "OK", donnees: { propertyId: studio.id } });
  });

  it("locataire : e-mail manquant, introuvable (avec l'adresse), ou retrouvé sans tenir compte des majuscules", async () => {
    const { manager, awa } = await agence();

    const a = await analyser(manager.id, [ligneOk({ emaillocataire: "" }), ligneOk({ emaillocataire: "inconnu@example.com" }), ligneOk({ emaillocataire: "AWA@Example.com" })]);

    expect(a.lignes[0].details).toEqual([{ code: "IMPORT_ROW_TENANT_EMAIL_MISSING" }]);
    expect(a.lignes[1].details).toEqual([{ code: "IMPORT_ROW_TENANT_NOT_FOUND", params: { email: "inconnu@example.com" } }]);
    expect(a.lignes[1].messages[0]).toContain("Importez d'abord vos locataires");
    expect(a.lignes[2]).toMatchObject({ statut: "OK", donnees: { tenantId: awa.id, tenantEmail: "awa@example.com" } });
  });

  it("un locataire dont l'e-mail a été saisi avec des majuscules est retrouvé par son e-mail en minuscules", async () => {
    const { manager } = await agence();
    const maj = await createTenant(manager.id, { email: "Fatou.Majuscules@Example.COM" });

    const a = await analyser(manager.id, [ligneOk({ emaillocataire: "fatou.majuscules@example.com" })]);

    expect(a.lignes[0]).toMatchObject({ statut: "OK", donnees: { tenantId: maj.id } });
  });

  it("le bien et le locataire d'une AUTRE agence restent introuvables", async () => {
    const { manager } = await agence();
    const autre = await createManager();
    await createProperty(autre.id, { title: "Bien Autre", address: "Ailleurs" });
    await createTenant(autre.id, { email: "autre@example.com" });

    const a = await analyser(manager.id, [ligneOk({ bien: "Bien Autre" }), ligneOk({ emaillocataire: "autre@example.com" })]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_PROPERTY_NOT_FOUND"]);
    expect(codes(a.lignes[1])).toEqual(["IMPORT_ROW_TENANT_NOT_FOUND"]);
  });
});

describe("analyserContrats : montants et devise", () => {
  it("loyer : manquant, illisible, nul ou démesuré refusés ; décimale et milliers lus", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ loyer: "" }),
      ligneOk({ loyer: "cher" }),
      ligneOk({ loyer: "0" }),
      ligneOk({ loyer: String(MONTANT_MAXIMUM + 1) }),
      ligneOk({ loyer: "250 000,50", bien: "Villa B" }),
    ]);

    expect(a.lignes[0].details).toEqual([{ code: "IMPORT_ROW_RENT_MISSING" }]);
    expect(a.lignes[1].details).toEqual([{ code: "IMPORT_ROW_RENT_INVALID", params: { value: "cher" } }]);
    expect(a.lignes[1].messages[0]).toBe("Loyer invalide : « cher ».");
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_RENT_INVALID"]);
    expect(codes(a.lignes[3])).toEqual(["IMPORT_ROW_RENT_INVALID"]);
    expect(a.lignes[4]).toMatchObject({ statut: "OK", donnees: { rent: 250000.5 } });
  });

  it("dépôt : manquant (le message dit d'indiquer 0), illisible, négatif ou démesuré refusés ; 0 accepté", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ depot: "" }),
      ligneOk({ depot: "beaucoup" }),
      ligneOk({ depot: "-5" }),
      ligneOk({ depot: String(MONTANT_MAXIMUM + 1) }),
      ligneOk({ depot: "0", bien: "Villa B" }),
    ]);

    expect(a.lignes[0].details).toEqual([{ code: "IMPORT_ROW_DEPOSIT_MISSING" }]);
    expect(a.lignes[0].messages[0]).toContain("indiquez 0");
    expect(a.lignes[1].details).toEqual([{ code: "IMPORT_ROW_DEPOSIT_INVALID", params: { value: "beaucoup" } }]);
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_DEPOSIT_INVALID"]);
    expect(codes(a.lignes[3])).toEqual(["IMPORT_ROW_DEPOSIT_INVALID"]);
    expect(a.lignes[4]).toMatchObject({ statut: "OK", donnees: { deposit: 0 } });
  });

  it("devise : celle du bien par défaut, celle du fichier (même en minuscules) si elle est connue, sinon refus", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ devise: "" }), // studio : XOF
      ligneOk({ devise: "xof", bien: "Villa B", debut: "01/04/2026" }), // villa : EUR, le fichier dit xof
      ligneOk({ devise: "XOF", bien: "Villa B", debut: "01/05/2026" }),
      ligneOk({ devise: "ZZZ", bien: "Villa B", debut: "01/06/2026" }),
      ligneOk({ devise: "", bien: "Villa B", debut: "01/07/2026" }), // villa : EUR
    ]);

    expect(a.lignes[0].donnees.currency).toBe("XOF");
    expect(a.lignes[1]).toMatchObject({ statut: "OK", donnees: { currency: "XOF" } }); // minuscules acceptées, et la devise du bien (EUR) est écartée
    expect(a.lignes[2].donnees.currency).toBe("XOF");
    expect(a.lignes[3].details).toEqual([{ code: "IMPORT_ROW_CURRENCY_UNKNOWN", params: { value: "ZZZ" } }]);
    expect(a.lignes[4].donnees.currency).toBe("EUR");
  });
});

describe("analyserContrats : dates et jour d'échéance", () => {
  it("début et fin : manquants, illisibles, impossibles (31/02) ou hors des années plausibles refusés", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ debut: "", fin: "" }),
      ligneOk({ debut: "bientôt", fin: "jamais" }),
      ligneOk({ debut: "31/02/2026" }),
      ligneOk({ debut: "01/01/1979" }),
      ligneOk({ fin: "01/01/2201" }),
    ]);

    expect(a.lignes[0].details).toEqual([{ code: "IMPORT_ROW_START_MISSING" }, { code: "IMPORT_ROW_END_MISSING" }]);
    expect(a.lignes[1].details).toEqual([
      { code: "IMPORT_ROW_START_INVALID", params: { value: "bientôt" } },
      { code: "IMPORT_ROW_END_INVALID", params: { value: "jamais" } },
    ]);
    expect(a.lignes[1].messages[0]).toContain("jj/mm/aaaa");
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_START_INVALID"]);
    expect(codes(a.lignes[3])).toEqual(["IMPORT_ROW_START_INVALID"]);
    expect(codes(a.lignes[4])).toEqual(["IMPORT_ROW_END_INVALID"]);
    // Une date illisible ne produit jamais de valeur dans l'aperçu.
    expect(a.lignes[2].donnees.startDate).toBeNull();
  });

  it("les formats jj/mm/aaaa, jj.mm.aaaa, jj-mm-aaaa et aaaa-mm-jj sont lus ; les années limites 1980 et 2200 sont acceptées", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ debut: "1/3/2026", fin: "28.02.2028" }),
      ligneOk({ debut: "2026-03-02", fin: "28-02-2028", bien: "Villa B" }),
      ligneOk({ debut: "01/01/1980", fin: "31/12/2200", bien: "Villa B", emaillocataire: "awa@example.com", statut: "terminé" }),
    ]);

    expect(a.lignes[0]).toMatchObject({ statut: "OK", donnees: { startDate: "2026-03-01", endDate: "2028-02-28" } });
    expect(a.lignes[1]).toMatchObject({ statut: "OK", donnees: { startDate: "2026-03-02", endDate: "2028-02-28" } });
    expect(a.lignes[2].statut).toBe("OK");
  });

  it("fin avant ou égale au début : refusée ; fin le lendemain acceptée", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ debut: "01/03/2026", fin: "01/03/2026" }),
      ligneOk({ debut: "01/03/2026", fin: "01/02/2026" }),
      ligneOk({ debut: "01/03/2026", fin: "02/03/2026", bien: "Villa B" }),
    ]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_END_BEFORE_START"]);
    expect(codes(a.lignes[1])).toEqual(["IMPORT_ROW_END_BEFORE_START"]);
    expect(a.lignes[2].statut).toBe("OK");
  });

  it("jour d'échéance : de 1 à 31 accepté ; 0, 32, décimal et texte refusés ; vide = non précisé", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ jourecheance: "1" }),
      ligneOk({ jourecheance: "31", bien: "Villa B" }),
      ligneOk({ jourecheance: "" }),
      ligneOk({ jourecheance: "0" }),
      ligneOk({ jourecheance: "32" }),
      ligneOk({ jourecheance: "5,5" }),
      ligneOk({ jourecheance: "lundi" }),
    ]);

    expect(a.lignes[0].donnees.paymentDay).toBe(1);
    expect(a.lignes[1].donnees.paymentDay).toBe(31);
    expect(a.lignes[2].donnees.paymentDay).toBeNull();
    expect(a.lignes[3].details).toEqual([{ code: "IMPORT_ROW_DUE_DAY_INVALID", params: { value: "0" } }]);
    expect(a.lignes[3].messages[0]).toBe("Jour d'échéance invalide : « 0 » (1 à 31).");
    for (const i of [4, 5, 6]) expect(codes(a.lignes[i])).toEqual(["IMPORT_ROW_DUE_DAY_INVALID"]);
  });
});

describe("analyserContrats : type, droit et statut", () => {
  it("type de bail : synonymes (accents, espaces, majuscules) compris, habitation par défaut, inconnu refusé", async () => {
    const { manager } = await agence();
    const cas: Array<[string, string]> = [
      ["", "HABITATION"],
      ["Habitation", "HABITATION"],
      ["nu", "HABITATION"],
      ["Meublé", "MEUBLE"],
      ["habitation meublée", "MEUBLE"],
      ["Meublée", "MEUBLE"],
      ["meuble", "MEUBLE"],
      ["Commercial", "COMMERCIAL"],
      ["commerce", "COMMERCIAL"],
      ["Professionnel", "PROFESSIONNEL"],
      ["bureau", "PROFESSIONNEL"],
    ];

    const a = await analyser(manager.id, cas.map(([typedebail], i) => ligneOk({ typedebail, debut: `01/${String(i + 1).padStart(2, "0")}/2026`, bien: "Villa B", fin: "01/01/2030" })));

    cas.forEach(([, attendu], i) => expect(a.lignes[i].donnees.leaseType).toBe(attendu));
    const b = await analyser(manager.id, [ligneOk({ typedebail: "château" })]);
    expect(b.lignes[0].details).toEqual([{ code: "IMPORT_ROW_LEASE_TYPE_UNKNOWN", params: { value: "château" } }]);
    expect(b.lignes[0].messages[0]).toContain("habitation, meublé, commercial ou professionnel");
  });

  it("droit applicable : jusqu'à 300 caractères, vide = absent, au-delà refusé", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ droitapplicable: "Droit sénégalais" }),
      ligneOk({ droitapplicable: "D".repeat(300), bien: "Villa B" }),
      ligneOk({ droitapplicable: "D".repeat(301), bien: "Villa B", debut: "01/04/2026" }),
      ligneOk({ droitapplicable: "", bien: "Villa B", debut: "01/05/2026" }),
    ]);

    expect(a.lignes[0].donnees.applicableLaw).toBe("Droit sénégalais");
    expect(a.lignes[1].statut).toBe("OK");
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_LAW_LONG"]);
    expect(a.lignes[3].donnees.applicableLaw).toBeNull();
  });

  it("statut : synonymes (actif, en cours, terminé, échu, résilié…) compris, actif par défaut, inconnu refusé", async () => {
    const { manager } = await agence();
    const cas: Array<[string, string]> = [
      ["", "ACTIVE"],
      ["Actif", "ACTIVE"],
      ["en cours", "ACTIVE"],
      ["EN_COURS", "ACTIVE"],
      ["Terminé", "ENDED"],
      ["échu", "ENDED"],
      ["fini", "ENDED"],
      ["Résilié", "TERMINATED"],
      ["terminated", "TERMINATED"],
    ];

    const a = await analyser(manager.id, cas.map(([statut], i) => ligneOk({ statut, bien: "Villa B", debut: `01/${String(i + 1).padStart(2, "0")}/2026`, fin: "01/01/2030" })));

    cas.forEach(([, attendu], i) => expect(a.lignes[i].donnees.status).toBe(attendu));
    const b = await analyser(manager.id, [ligneOk({ statut: "suspendu" })]);
    expect(b.lignes[0].details).toEqual([{ code: "IMPORT_ROW_CONTRACT_STATUS_UNKNOWN", params: { value: "suspendu" } }]);
  });

  it("une ligne cumule toutes ses erreurs dans l'ordre des colonnes, et reste affichable à l'aperçu", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [{ bien: "", emaillocataire: "", loyer: "", depot: "", devise: "ZZZ", debut: "", fin: "", jourecheance: "99", typedebail: "?", statut: "?" }]);

    expect(a.lignes[0].statut).toBe("ERREUR");
    expect(codes(a.lignes[0])).toEqual([
      "IMPORT_ROW_PROPERTY_MISSING",
      "IMPORT_ROW_TENANT_EMAIL_MISSING",
      "IMPORT_ROW_RENT_MISSING",
      "IMPORT_ROW_DEPOSIT_MISSING",
      "IMPORT_ROW_CURRENCY_UNKNOWN",
      "IMPORT_ROW_START_MISSING",
      "IMPORT_ROW_END_MISSING",
      "IMPORT_ROW_DUE_DAY_INVALID",
      "IMPORT_ROW_LEASE_TYPE_UNKNOWN",
      "IMPORT_ROW_CONTRACT_STATUS_UNKNOWN",
    ]);
    expect(a.lignes[0].messages).toHaveLength(10);
    expect(a.lignes[0].donnees).toMatchObject({ propertyId: null, tenantId: null, rent: null, deposit: null, startDate: null, endDate: null });
    expect(a.resume).toEqual({ total: 1, valides: 0, doublons: 0, erreurs: 1 });
  });
});

describe("analyserContrats : premier mois facturé", () => {
  it("échéance du mois pas encore passée : on facture dès le mois courant (octobre) ; déjà passée : dès le mois suivant", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ jourecheance: "20" }), // le 20 octobre n'est pas passé au 12
      ligneOk({ jourecheance: "5", bien: "Villa B" }), // le 5 octobre est passé
      ligneOk({ jourecheance: "12", bien: "Villa B", debut: "01/04/2026", emaillocataire: "awa@example.com" }), // le jour même : pas encore « passé »
    ]);

    expect(a.lignes[0].donnees).toMatchObject({ billingFrom: "2026-10-01", premiereFacture: "10/2026" });
    expect(a.lignes[1].donnees).toMatchObject({ billingFrom: "2026-11-01", premiereFacture: "11/2026" });
    expect(a.lignes[2].donnees).toMatchObject({ billingFrom: "2026-10-01", premiereFacture: "10/2026" });
  });

  it("sans jour d'échéance, c'est le jour du début du bail qui sert (début un 3 : échéance du 3 octobre déjà passée)", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [ligneOk({ debut: "03/03/2026" })]);

    expect(a.lignes[0].donnees.billingFrom).toBe("2026-11-01");
  });

  it("un jour d'échéance de 31 est ramené au dernier jour du mois (pas de débordement sur le mois suivant)", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [ligneOk({ jourecheance: "31" })]);

    expect(a.lignes[0].donnees.billingFrom).toBe("2026-10-01"); // le 31 octobre n'est pas passé
  });

  it("« facturation depuis » remplace la règle par défaut ; une date illisible est refusée avec le texte saisi", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ facturationdepuis: "01/01/2026" }),
      ligneOk({ facturationdepuis: "demain", bien: "Villa B" }),
    ]);

    expect(a.lignes[0].donnees).toMatchObject({ billingFrom: "2026-01-01", premiereFacture: "03/2026" }); // jamais avant le début du bail
    expect(a.lignes[1].details).toEqual([{ code: "IMPORT_ROW_BILLING_FROM_INVALID", params: { value: "demain" } }]);
    expect(a.lignes[1].messages[0]).toContain("facturation depuis");
  });

  it("bail qui n'a pas commencé : la première facture est celle de son début ; bail déjà terminé avant « facturation depuis » : aucune", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ debut: "15/01/2027", fin: "31/12/2027" }),
      ligneOk({ debut: "01/03/2025", fin: "31/12/2025", bien: "Villa B" }),
    ]);

    expect(a.lignes[0].donnees.premiereFacture).toBe("01/2027");
    expect(a.lignes[1].donnees.premiereFacture).toBeNull();
  });

  it("une ligne dont la date est illisible n'a pas de première facture", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [ligneOk({ debut: "" })]);

    expect(a.lignes[0].donnees.premiereFacture).toBeNull();
  });
});

describe("analyserContrats : doublons et chevauchements", () => {
  it("un contrat existant (même bien, même locataire, même début) est un doublon ; un autre début ne l'est pas", async () => {
    const { manager, studio, moussa } = await agence();
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 2, 1)), endDate: new Date(Date.UTC(2027, 2, 1)), status: "ENDED" });

    const a = await analyser(manager.id, [ligneOk(), ligneOk({ debut: "02/03/2026", statut: "terminé" })]);

    expect(a.lignes[0].statut).toBe("DOUBLON");
    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_CONTRACT_DUPLICATE"]);
    expect(a.lignes[0].messages[0]).toContain("existe déjà");
    expect(a.lignes[1].statut).toBe("OK");
    expect(a.resume).toEqual({ total: 2, valides: 1, doublons: 1, erreurs: 0 });
  });

  it("le même bail deux fois dans le fichier : le second est un doublon", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [ligneOk(), ligneOk()]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["OK", "DOUBLON"]);
  });

  it("même bien et même début mais LOCATAIRE différent : ce n'est pas un doublon (c'est alors un chevauchement)", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [ligneOk(), ligneOk({ emaillocataire: "awa@example.com" })]);

    expect(a.lignes[1].statut).toBe("ERREUR");
    expect(codes(a.lignes[1])).toEqual(["IMPORT_ROW_CONTRACT_OVERLAP"]);
    expect(a.lignes[1].messages[0]).toContain("contrat actif sur cette période");
  });

  it("deux baux ACTIFS qui se chevauchent sur un bien : le second est refusé, qu'il chevauche un bail existant ou un bail du fichier", async () => {
    const { manager, studio, moussa } = await agence();
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)), status: "ACTIVE" });

    const a = await analyser(manager.id, [
      ligneOk({ debut: "01/06/2026", fin: "01/06/2027", emaillocataire: "awa@example.com" }), // chevauche l'existant
      ligneOk({ debut: "01/01/2028", fin: "01/01/2029", emaillocataire: "awa@example.com" }), // libre
      ligneOk({ debut: "01/06/2028", fin: "01/06/2029", emaillocataire: "awa@example.com" }), // chevauche la ligne précédente
    ]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "OK", "ERREUR"]);
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_CONTRACT_OVERLAP"]);
  });

  it("des périodes qui se touchent (fin = début suivant) ne se chevauchent pas", async () => {
    const { manager, studio, moussa } = await agence();
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)), status: "ACTIVE" });

    const a = await analyser(manager.id, [ligneOk({ debut: "31/12/2026", fin: "31/12/2027", emaillocataire: "awa@example.com" })]);

    expect(a.lignes[0].statut).toBe("OK");
  });

  it("seuls les baux ACTIFS comptent : un ancien bail terminé ne bloque pas, et un nouveau bail terminé n'est jamais refusé pour chevauchement", async () => {
    const { manager, studio, moussa } = await agence();
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)), status: "ENDED" });
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2027, 0, 1)), endDate: new Date(Date.UTC(2027, 11, 31)), status: "ACTIVE" });

    const a = await analyser(manager.id, [
      ligneOk({ debut: "01/06/2026", fin: "01/06/2027", emaillocataire: "awa@example.com" }), // actif : chevauche l'actif de 2027
      ligneOk({ debut: "01/06/2026", fin: "01/06/2027", emaillocataire: "awa@example.com", statut: "terminé" }), // terminé : jamais refusé
      ligneOk({ debut: "01/03/2026", fin: "01/12/2026", emaillocataire: "awa@example.com", bien: "Villa B" }), // autre bien
    ]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "OK", "OK"]);
  });

  it("un ancien bail TERMINÉ qui chevauche ne bloque pas un nouveau bail actif ; un bail actif plus tardif n'en bloque pas un antérieur", async () => {
    const { manager, studio, moussa } = await agence();
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)), status: "ENDED" });
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2027, 0, 1)), endDate: new Date(Date.UTC(2027, 11, 31)), status: "ACTIVE" });

    const a = await analyser(manager.id, [
      ligneOk({ debut: "01/02/2026", fin: "30/11/2026", emaillocataire: "awa@example.com" }), // ne chevauche que le terminé
      ligneOk({ debut: "01/01/2024", fin: "01/01/2025", emaillocataire: "awa@example.com" }), // finit bien avant l'actif de 2027
    ]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["OK", "OK"]);
  });

  it("un bail TERMINÉ du fichier ne réserve pas sa période : un bail actif qui le recouvre, plus bas dans le fichier, est accepté", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [
      ligneOk({ statut: "terminé", debut: "01/01/2026", fin: "31/12/2026" }),
      ligneOk({ debut: "01/06/2026", fin: "01/06/2027", emaillocataire: "awa@example.com" }),
    ]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["OK", "OK"]);
  });

  it("un bail en erreur ne réserve pas sa période : le suivant, valide, n'est pas refusé à cause de lui", async () => {
    const { manager } = await agence();

    const a = await analyser(manager.id, [ligneOk({ loyer: "" }), ligneOk()]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "OK"]);
  });

  it("les contrats d'une AUTRE agence ne comptent ni comme doublons ni comme chevauchements", async () => {
    const { manager } = await agence();
    const autre = await createManager();
    const p = await createProperty(autre.id, { title: "Studio Centre-ville", address: "12 rue des Écoles" });
    const t = await createTenant(autre.id, { email: "moussa.diop@example.com" });
    await createContract(p.id, t.id, { startDate: new Date(Date.UTC(2026, 2, 1)), endDate: new Date(Date.UTC(2028, 1, 28)), status: "ACTIVE" });

    const a = await analyser(manager.id, [ligneOk()]);

    expect(a.lignes[0].statut).toBe("OK");
  });

  it("des colonnes obligatoires absentes refusent tout le fichier", async () => {
    const { manager } = await agence();

    const erreur = await analyserContrats(manager.id, fichier([], ["bien", "loyer"]), MAINTENANT).catch((e) => e);

    expect(erreur.code).toBe("IMPORT_MISSING_COLUMNS");
    expect(erreur.message).toContain("« emaillocataire »");
    expect(erreur.message).toContain("« depot »");
    expect(erreur.message).toContain("« debut »");
    expect(erreur.message).not.toContain("« bien »");
  });
});

describe("importerContrats", () => {
  const ecrits = async (managerId: string) =>
    (await testDb.select({ c: contracts }).from(contracts).innerJoin(properties, eq(contracts.propertyId, properties.id)).where(eq(properties.managerId, managerId))).map(
      (r: { c: typeof contracts.$inferSelect }) => r.c
    );

  it("écrit les lignes valides avec toutes leurs valeurs, et marque le bien occupé seulement pour un bail actif", async () => {
    const { manager, studio, villa } = await agence();
    const a = await analyser(manager.id, [
      ligneOk({ jourecheance: "20", typedebail: "meublé", droitapplicable: "Droit sénégalais" }),
      ligneOk({ bien: "Villa B", statut: "terminé", debut: "01/01/2024", fin: "31/12/2024", emaillocataire: "awa@example.com" }),
      ligneOk({ bien: "Villa B", loyer: "" }),
    ]);

    expect(await importerContrats(manager.id, a)).toBe(2);

    const liste = await ecrits(manager.id);
    expect(liste).toHaveLength(2);
    const actif = liste.find((c: { propertyId: string }) => c.propertyId === studio.id)!;
    expect(actif).toMatchObject({ rent: 250000, deposit: 500000, currency: "XOF", paymentDay: 20, leaseType: "MEUBLE", applicableLaw: "Droit sénégalais", status: "ACTIVE" });
    expect(actif.billingFrom?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const termine = liste.find((c: { propertyId: string }) => c.propertyId === villa.id)!;
    expect(termine).toMatchObject({ status: "ENDED", applicableLaw: null, paymentDay: null });

    const [bienActif] = await testDb.select().from(properties).where(eq(properties.id, studio.id));
    const [bienTermine] = await testDb.select().from(properties).where(eq(properties.id, villa.id));
    expect(bienActif.status).toBe("OCCUPIED");
    expect(bienTermine.status).not.toBe("OCCUPIED");
  });

  it("rien de valide : rien n'est écrit et le résultat est 0", async () => {
    const { manager } = await agence();
    const a = await analyser(manager.id, [ligneOk({ loyer: "" })]);

    expect(await importerContrats(manager.id, a)).toBe(0);
    expect(await ecrits(manager.id)).toEqual([]);
  });

  it("les factures partent du premier mois facturé annoncé à l'aperçu, jamais du passé du bail", async () => {
    const { manager } = await agence();
    const a = await analyser(manager.id, [ligneOk({ jourecheance: "20", debut: "01/03/2023", fin: "28/02/2028" })]);
    expect(a.lignes[0].donnees.premiereFacture).toBe("10/2026");

    await importerContrats(manager.id, a);

    const [contrat] = await ecrits(manager.id);
    const factures = await testDb.select().from(invoices).where(eq(invoices.contractId, contrat.id));
    expect(factures.map((f: { periodMonth: number; periodYear: number }) => `${f.periodMonth}/${f.periodYear}`)).toEqual(["10/2026"]);
  });

  it("un bien qui n'appartient pas à l'agence (analyse falsifiée) est ignoré, sans erreur et sans écriture", async () => {
    const { manager } = await agence();
    const autre = await createManager();
    const bienAutre = await createProperty(autre.id, { title: "Bien étranger", address: "Ailleurs" });
    const locataire = await createTenant(autre.id, { email: "etranger@example.com" });
    const a = await analyser(manager.id, [ligneOk()]);
    a.lignes[0].donnees = { ...(a.lignes[0].donnees as DonneesContrat), propertyId: bienAutre.id, tenantId: locataire.id };

    expect(await importerContrats(manager.id, a)).toBe(0);
    expect(await ecrits(autre.id)).toEqual([]);
  });

  it("un bail actif devenu conflictuel entre l'aperçu et l'écriture est ignoré (pas fatal), les autres lignes sont écrites", async () => {
    const { manager, studio, villa, moussa } = await agence();
    const a = await analyser(manager.id, [ligneOk(), ligneOk({ bien: "Villa B", emaillocataire: "awa@example.com" })]);
    expect(a.resume.valides).toBe(2);
    // Un autre onglet crée un bail actif sur le studio après l'aperçu.
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 5, 1)), endDate: new Date(Date.UTC(2027, 5, 1)), status: "ACTIVE" });

    expect(await importerContrats(manager.id, a)).toBe(1);

    const liste = await ecrits(manager.id);
    expect(liste.filter((c: { propertyId: string }) => c.propertyId === studio.id)).toHaveLength(1); // seul celui de l'autre onglet
    expect(liste.filter((c: { propertyId: string }) => c.propertyId === villa.id)).toHaveLength(1);
  });

  it("à l'écriture, un ancien bail TERMINÉ qui recouvre la période ne bloque pas un nouveau bail actif", async () => {
    const { manager, studio, moussa } = await agence();
    const a = await analyser(manager.id, [ligneOk({ debut: "01/06/2026", fin: "01/06/2027" })]);
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)), status: "ENDED" });

    expect(await importerContrats(manager.id, a)).toBe(1);
  });

  it("à l'écriture, des périodes qui se touchent (fin d'un bail actif = début du nouveau) ne sont pas un conflit", async () => {
    const { manager, studio, moussa } = await agence();
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2025, 2, 1)), endDate: new Date(Date.UTC(2026, 2, 1)), status: "ACTIVE" });
    const a = await analyser(manager.id, [ligneOk({ debut: "01/03/2026", fin: "28/02/2028", emaillocataire: "awa@example.com" })]);
    expect(a.lignes[0].statut).toBe("OK"); // l'aperçu l'accepte déjà

    expect(await importerContrats(manager.id, a)).toBe(1);
  });

  it("le chevauchement n'est revérifié que pour un bail ACTIF : un bail terminé s'écrit même sur une période occupée", async () => {
    const { manager, studio, moussa } = await agence();
    const a = await analyser(manager.id, [ligneOk({ statut: "terminé", debut: "01/06/2026", fin: "01/06/2027" })]);
    await createContract(studio.id, moussa.id, { startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2027, 11, 31)), status: "ACTIVE" });

    expect(await importerContrats(manager.id, a)).toBe(1);
  });
});
