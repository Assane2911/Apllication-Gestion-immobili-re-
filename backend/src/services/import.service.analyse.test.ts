import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { properties, tenants } from "../db/schema";
import { createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import type { CsvLu } from "../utils/csvImport";
import { MONTANT_MAXIMUM, SURFACE_MAXIMUM } from "../utils/montant";
import {
  analyserBiens,
  analyserLocataires,
  compterBiens,
  COLONNES_OBLIGATOIRES,
  ImportInvalide,
  importerBiens,
  importerLocataires,
  MODELES_CSV,
} from "./import.service";

/**
 * Analyse et écriture des imports de biens et de locataires, appelées directement : chaque règle de ligne (longueurs, nombres,
 * devise, statut, civilité, téléphone, e-mail), les doublons (dans la base et dans le fichier), le plafond de la formule et la
 * règle « rien n'est écrit qu'après analyse ». Le fichier des routes vérifie le parcours ; ici, chaque ligne du tableur.
 */

/** Un fichier déjà lu : `entetes` normalisés (minuscules, sans accents), une ligne = ses valeurs par en-tête. */
function fichier(entetes: string[], lignes: Array<Record<string, string>>): CsvLu {
  return { delimiteur: ";", entetes, lignes: lignes.map((valeurs, i) => ({ ligne: i + 2, valeurs })) };
}

const ENTETES_BIENS = ["titre", "adresse", "surface", "loyer", "devise", "statut", "description"];
const bien = (extra: Record<string, string> = {}): Record<string, string> => ({
  titre: "Studio Centre-ville",
  adresse: "12 rue des Écoles, Dakar",
  surface: "28",
  loyer: "250000",
  ...extra,
});
const OPTIONS = { deviseParDefaut: "XOF", maximumBiens: null as number | null };
const biens = (managerId: string, lignes: Array<Record<string, string>>, options = OPTIONS) =>
  analyserBiens(managerId, fichier(ENTETES_BIENS, lignes), options);

const ENTETES_LOCATAIRES = ["civilite", "prenom", "nom", "telephone", "email"];
const locataire = (extra: Record<string, string> = {}): Record<string, string> => ({
  prenom: "Moussa",
  nom: "Diop",
  telephone: "+221 77 123 45 67",
  email: "moussa.diop@example.com",
  ...extra,
});
const locataires = (managerId: string, lignes: Array<Record<string, string>>) => analyserLocataires(managerId, fichier(ENTETES_LOCATAIRES, lignes));

const codes = (l: { details: Array<{ code: string }> }) => l.details.map((d) => d.code);

describe("analyserBiens : champs d'une ligne", () => {
  it("une ligne complète est valide, avec ses valeurs lues (devise et statut par défaut)", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien({ description: "Meublé" })]);

    expect(a.lignes[0]).toMatchObject({
      ligne: 2,
      statut: "OK",
      messages: [],
      details: [],
      donnees: { title: "Studio Centre-ville", address: "12 rue des Écoles, Dakar", surface: 28, rent: 250000, currency: "XOF", status: "AVAILABLE", description: "Meublé" },
    });
    expect(a.resume).toEqual({ total: 1, valides: 1, doublons: 0, erreurs: 0 });
    expect(a.type).toBe("properties");
    expect(a.delimiteur).toBe(";");
  });

  it("titre : trop court (moins de 2 caractères) ou trop long (plus de 200) est refusé, avec le texte et le code", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien({ titre: "A" }), bien({ titre: "T".repeat(201) }), bien({ titre: "T".repeat(200), adresse: "ok adresse" }), bien({ titre: "", adresse: "x2" })]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_TITLE_SHORT"]);
    expect(a.lignes[0].messages[0]).toContain("Titre manquant ou trop court");
    expect(codes(a.lignes[1])).toEqual(["IMPORT_ROW_TITLE_LONG"]);
    expect(a.lignes[2].statut).toBe("OK"); // 200 : la limite est incluse
    expect(codes(a.lignes[3])).toEqual(["IMPORT_ROW_TITLE_SHORT"]);
  });

  it("adresse : trop courte (moins de 2) ou trop longue (plus de 300)", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien({ adresse: "X" }), bien({ adresse: "A".repeat(301) }), bien({ adresse: "A".repeat(300) })]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_ADDRESS_SHORT"]);
    expect(codes(a.lignes[1])).toEqual(["IMPORT_ROW_ADDRESS_LONG"]);
    expect(a.lignes[2].statut).toBe("OK");
  });

  it("description : au plus 5 000 caractères", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien({ description: "D".repeat(5001) }), bien({ titre: "Autre bien", description: "D".repeat(5000) })]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_DESCRIPTION_LONG"]);
    expect(a.lignes[1].statut).toBe("OK");
  });

  it("surface : manquante, illisible, nulle, négative ou démesurée sont refusées ; décimale à virgule acceptée", async () => {
    const m = await createManager();

    const a = await biens(m.id, [
      bien({ surface: "" }),
      bien({ surface: "grande" }),
      bien({ surface: "0" }),
      bien({ surface: "-12" }),
      bien({ surface: String(SURFACE_MAXIMUM + 1) }),
      bien({ surface: "28,5", titre: "Studio B" }),
    ]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_AREA_MISSING"]);
    expect(a.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_AREA_MISSING" }); // pas de valeur à montrer
    expect(a.lignes[0].messages[0]).toBe("Surface manquante.");
    expect(a.lignes[1].details[0]).toEqual({ code: "IMPORT_ROW_AREA_INVALID", params: { value: "grande" } });
    expect(a.lignes[1].messages[0]).toBe("Surface invalide : « grande ».");
    for (const i of [2, 3, 4]) expect(codes(a.lignes[i])).toEqual(["IMPORT_ROW_AREA_INVALID"]);
    expect(a.lignes[5]).toMatchObject({ statut: "OK", donnees: { surface: 28.5 } });
  });

  it("loyer : manquant, illisible, nul ou démesuré sont refusés ; les milliers à l'espace ou au point sont lus", async () => {
    const m = await createManager();

    const a = await biens(m.id, [
      bien({ loyer: "" }),
      bien({ loyer: "cher" }),
      bien({ loyer: "0" }),
      bien({ loyer: String(MONTANT_MAXIMUM + 1) }),
      bien({ loyer: "250 000", titre: "Studio B" }),
      bien({ loyer: "250.000", titre: "Studio C" }),
    ]);

    expect(a.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_RENT_MISSING" });
    expect(a.lignes[1].details[0]).toEqual({ code: "IMPORT_ROW_RENT_INVALID", params: { value: "cher" } });
    expect(a.lignes[1].messages[0]).toBe("Loyer invalide : « cher ».");
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_RENT_INVALID"]);
    expect(codes(a.lignes[3])).toEqual(["IMPORT_ROW_RENT_INVALID"]);
    expect(a.lignes[4]).toMatchObject({ statut: "OK", donnees: { rent: 250000 } });
    expect(a.lignes[5]).toMatchObject({ statut: "OK", donnees: { rent: 250000 } });
  });

  it("devise : celle du gestionnaire si la colonne est vide, celle du fichier (même en minuscules) si elle est connue, sinon refus", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien({ devise: "" }), bien({ devise: "eur", titre: "B2" }), bien({ devise: "XOF", titre: "B3" }), bien({ devise: "ZZZ", titre: "B4" })]);

    expect(a.lignes[0].donnees.currency).toBe("XOF");
    expect(a.lignes[1].donnees.currency).toBe("EUR");
    expect(a.lignes[2].donnees.currency).toBe("XOF");
    expect(a.lignes[3].details[0]).toEqual({ code: "IMPORT_ROW_CURRENCY_UNKNOWN", params: { value: "ZZZ" } });
    expect(a.lignes[3].messages[0]).toBe("Devise inconnue : « ZZZ ».");
  });

  it("statut : les synonymes français et anglais, avec accents et majuscules, sont compris ; un statut inconnu est refusé", async () => {
    const m = await createManager();
    const synonymes: Array<[string, string]> = [
      ["Disponible", "AVAILABLE"],
      ["libre", "AVAILABLE"],
      ["VACANT", "AVAILABLE"],
      ["occupé", "OCCUPIED"],
      ["Loué", "OCCUPIED"],
      ["OCCUPIED", "OCCUPIED"],
      ["Travaux", "MAINTENANCE"],
      ["entretien", "MAINTENANCE"],
      ["maintenance", "MAINTENANCE"],
    ];

    const a = await biens(m.id, synonymes.map(([statut], i) => bien({ statut, titre: `Bien ${i}` })));

    synonymes.forEach(([, attendu], i) => expect(a.lignes[i].donnees.status).toBe(attendu));
    const b = await biens(m.id, [bien({ statut: "en rêve" })]);
    expect(b.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_PROPERTY_STATUS_UNKNOWN", params: { value: "en rêve" } });
    expect(b.lignes[0].statut).toBe("ERREUR");
  });

  it("une ligne cumule ses erreurs, dans l'ordre des colonnes, avec les valeurs lues conservées pour l'aperçu", async () => {
    const m = await createManager();

    const a = await biens(m.id, [{ titre: "", adresse: "", surface: "x", loyer: "", devise: "ZZZ", statut: "?", description: "d" }]);

    expect(a.lignes[0].statut).toBe("ERREUR");
    expect(codes(a.lignes[0])).toEqual([
      "IMPORT_ROW_TITLE_SHORT",
      "IMPORT_ROW_ADDRESS_SHORT",
      "IMPORT_ROW_AREA_INVALID",
      "IMPORT_ROW_RENT_MISSING",
      "IMPORT_ROW_CURRENCY_UNKNOWN",
      "IMPORT_ROW_PROPERTY_STATUS_UNKNOWN",
    ]);
    expect(a.lignes[0].messages).toHaveLength(6); // un texte par code, au même rang
    expect(a.lignes[0].donnees).toMatchObject({ title: "", surface: null, rent: null, description: "d" });
    expect(a.resume).toEqual({ total: 1, valides: 0, doublons: 0, erreurs: 1 });
  });

  it("les noms de colonnes équivalents sont acceptés (anglais, synonymes), et la première colonne remplie gagne", async () => {
    const m = await createManager();
    const csv = fichier(["nom", "address", "m2", "rent", "monnaie", "etat", "notes"], [
      { nom: "Villa", address: "Corniche", m2: "90", rent: "400000", monnaie: "EUR", etat: "libre", notes: "Vue mer" },
    ]);

    const a = await analyserBiens(m.id, csv, OPTIONS);

    expect(a.lignes[0]).toMatchObject({ statut: "OK", donnees: { title: "Villa", address: "Corniche", surface: 90, rent: 400000, currency: "EUR", status: "AVAILABLE", description: "Vue mer" } });
  });
});

describe("analyserBiens : colonnes équivalentes", () => {
  it("une colonne vide ne masque pas une colonne équivalente remplie (« titre » vide, « nom » rempli)", async () => {
    const m = await createManager();
    const csv = fichier(["titre", "nom", "adresse", "surface", "loyer"], [{ titre: "", nom: "Villa Corniche", adresse: "Corniche", surface: "90", loyer: "400000" }]);

    const a = await analyserBiens(m.id, csv, OPTIONS);

    expect(a.lignes[0]).toMatchObject({ statut: "OK", donnees: { title: "Villa Corniche" } });
  });
});

describe("analyserBiens : fichier", () => {
  it("des colonnes obligatoires absentes refusent TOUT le fichier, en nommant les colonnes et leurs équivalents", async () => {
    const m = await createManager();
    const csv = fichier(["titre", "adresse"], [{ titre: "A", adresse: "B" }]);

    const erreur = await analyserBiens(m.id, csv, OPTIONS).catch((e) => e);

    expect(erreur).toBeInstanceOf(ImportInvalide);
    expect(erreur.code).toBe("IMPORT_MISSING_COLUMNS");
    expect(erreur.message).toContain("« surface » (ou superficie, m2)");
    expect(erreur.message).toContain("« loyer » (ou rent, loyermensuel)");
    expect(erreur.message).not.toContain("« titre »");
    expect(erreur.message).toContain("Téléchargez le modèle");
    expect(erreur.params).toEqual({ columns: expect.stringContaining("« surface »") });
  });

  it("un fichier sans ligne de données est valide et vide", async () => {
    const m = await createManager();

    const a = await biens(m.id, []);

    expect(a.lignes).toEqual([]);
    expect(a.resume).toEqual({ total: 0, valides: 0, doublons: 0, erreurs: 0 });
  });

  it("doublons : avec un bien existant de l'agence, ou plus haut dans le fichier — sans tenir compte des accents, majuscules et espaces", async () => {
    const m = await createManager();
    await createProperty(m.id, { title: "Résidence Été", address: "5 Rue  de la Paix" });

    const a = await biens(m.id, [
      bien({ titre: "RESIDENCE ETE", adresse: "5 rue de la paix" }),
      bien({ titre: "Nouveau", adresse: "Ici" }),
      bien({ titre: " nouveau ", adresse: "ICI" }),
    ]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["DOUBLON", "OK", "DOUBLON"]);
    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_PROPERTY_DUPLICATE"]);
    expect(a.lignes[0].messages[0]).toContain("existe déjà");
    expect(a.resume).toEqual({ total: 3, valides: 1, doublons: 2, erreurs: 0 });
  });

  it("le même titre à une adresse différente n'est pas un doublon", async () => {
    const m = await createManager();
    await createProperty(m.id, { title: "Studio", address: "A" + "1" });

    const a = await biens(m.id, [bien({ titre: "Studio", adresse: "Adresse B2" })]);

    expect(a.lignes[0].statut).toBe("OK");
  });

  it("les biens d'une AUTRE agence ne comptent ni comme doublons ni dans le plafond", async () => {
    const m = await createManager();
    const autre = await createManager();
    await createProperty(autre.id, { title: "Studio Centre-ville", address: "12 rue des Écoles, Dakar" });

    const a = await biens(m.id, [bien()], { deviseParDefaut: "XOF", maximumBiens: 1 });

    expect(a.lignes[0].statut).toBe("OK");
    expect(a.capacite).toEqual({ maximum: 1, existants: 0, restant: 1 });
  });

  it("une ligne en erreur ne bloque pas les autres, et un doublon invalide n'est jamais compté deux fois", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien({ surface: "" }), bien({ titre: "Bon" }), bien({ titre: "Bon" })]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "OK", "DOUBLON"]);
  });
});

describe("analyserBiens : plafond de la formule", () => {
  it("les places restantes sont comptées avec les biens existants : au-delà, la ligne est refusée avec le plafond annoncé", async () => {
    const m = await createManager();
    await createProperty(m.id, { title: "Existant", address: "E" + "1" });

    const a = await biens(m.id, [bien({ titre: "Un" }), bien({ titre: "Deux" }), bien({ titre: "Trois" })], { deviseParDefaut: "XOF", maximumBiens: 3 });

    expect(a.lignes.map((l) => l.statut)).toEqual(["OK", "OK", "ERREUR"]);
    expect(a.lignes[2].details[0]).toEqual({ code: "IMPORT_ROW_PLAN_LIMIT", params: { max: 3 } });
    expect(a.lignes[2].messages[0]).toContain("Limite de 3 biens atteinte");
    expect(a.capacite).toEqual({ maximum: 3, existants: 1, restant: 2 });
  });

  it("un doublon et une ligne en erreur ne consomment aucune place", async () => {
    const m = await createManager();
    await createProperty(m.id, { title: "Dupli", address: "Cate" });

    const a = await biens(m.id, [bien({ surface: "" }), bien({ titre: "Dupli", adresse: "Cate" }), bien({ titre: "Seule" })], { deviseParDefaut: "XOF", maximumBiens: 2 });

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "DOUBLON", "OK"]);
  });

  it("plafond atteint d'avance (ou dépassé) : toutes les lignes valides sont refusées, et les places restantes ne sont jamais négatives", async () => {
    const m = await createManager();
    await createProperty(m.id, { title: "P1", address: "A1" });
    await createProperty(m.id, { title: "P2", address: "A2" });
    await createProperty(m.id, { title: "P3", address: "A3" });

    const a = await biens(m.id, [bien()], { deviseParDefaut: "XOF", maximumBiens: 2 });

    expect(a.lignes[0].statut).toBe("ERREUR");
    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_PLAN_LIMIT"]);
    expect(a.capacite).toEqual({ maximum: 2, existants: 3, restant: 0 });
  });

  it("sans plafond (formule illimitée) : aucune limite, et le message de capacité l'indique par null", async () => {
    const m = await createManager();

    const a = await biens(m.id, Array.from({ length: 12 }, (_, i) => bien({ titre: `Bien ${i}`, adresse: `Adresse ${i}` })));

    expect(a.resume.valides).toBe(12);
    expect(a.capacite).toEqual({ maximum: null, existants: 0, restant: null });
  });

  it("un plafond de 0 refuse toute ligne valide, et le message annonce 0", async () => {
    const m = await createManager();

    const a = await biens(m.id, [bien()], { deviseParDefaut: "XOF", maximumBiens: 0 });

    expect(a.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_PLAN_LIMIT", params: { max: 0 } });
  });
});

describe("analyserLocataires", () => {
  it("une ligne complète est valide : e-mail en minuscules, téléphone au format international", async () => {
    const m = await createManager();

    const a = await locataires(m.id, [locataire({ civilite: "M.", email: "Moussa.Diop@Example.COM", telephone: "00221 77 123 45 67" })]);

    expect(a.type).toBe("tenants");
    expect(a.lignes[0]).toMatchObject({
      statut: "OK",
      donnees: { civility: "M", firstName: "Moussa", lastName: "Diop", phone: "+221771234567", email: "moussa.diop@example.com" },
    });
  });

  it("prénom et nom : manquants ou de plus de 100 caractères refusés", async () => {
    const m = await createManager();

    const a = await locataires(m.id, [
      locataire({ prenom: "" }),
      locataire({ nom: "", email: "a@example.com" }),
      locataire({ prenom: "P".repeat(101), email: "b@example.com" }),
      locataire({ nom: "N".repeat(101), email: "c@example.com" }),
      locataire({ prenom: "P".repeat(100), email: "d@example.com" }),
    ]);

    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_FIRSTNAME_MISSING"]);
    expect(codes(a.lignes[1])).toEqual(["IMPORT_ROW_LASTNAME_MISSING"]);
    expect(codes(a.lignes[2])).toEqual(["IMPORT_ROW_FIRSTNAME_LONG"]);
    expect(codes(a.lignes[3])).toEqual(["IMPORT_ROW_LASTNAME_LONG"]);
    expect(a.lignes[4].statut).toBe("OK");
    // La limite est incluse pour le nom aussi.
    const limite = await locataires(m.id, [locataire({ nom: "N".repeat(100), email: "e@example.com" })]);
    expect(limite.lignes[0].statut).toBe("OK");
  });

  it("e-mail : manquant, mal formé (espaces, sans point, sans domaine) ou de plus de 254 caractères est refusé", async () => {
    const m = await createManager();
    const trop = `${"a".repeat(250)}@x.fr`;

    const a = await locataires(m.id, [
      locataire({ email: "" }),
      locataire({ email: "pas-un-email" }),
      locataire({ email: "moussa diop@example.com" }),
      locataire({ email: "moussa@example" }),
      locataire({ email: "moussa@example.c" }),
      locataire({ email: trop }),
    ]);

    expect(a.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_EMAIL_MISSING" });
    expect(a.lignes[0].messages[0]).toBe("Adresse email manquante.");
    expect(a.lignes[1].details[0]).toEqual({ code: "IMPORT_ROW_EMAIL_INVALID", params: { value: "pas-un-email" } });
    expect(a.lignes[1].messages[0]).toContain("Adresse email invalide");
    for (const i of [2, 3, 4, 5]) expect(codes(a.lignes[i])).toEqual(["IMPORT_ROW_EMAIL_INVALID"]);
    // 254 caractères : la limite est incluse.
    const limite = await locataires(m.id, [locataire({ email: `${"a".repeat(249)}@x.fr` })]);
    expect(limite.lignes[0].statut).toBe("OK");
  });

  it("téléphone : manquant ou sans indicatif refusé (avec le message d'aide), la valeur saisie reste affichée à l'aperçu", async () => {
    const m = await createManager();

    const a = await locataires(m.id, [locataire({ telephone: "" }), locataire({ telephone: "77 123 45 67", email: "b@example.com" })]);

    expect(a.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_PHONE_MISSING" });
    expect(a.lignes[0].messages[0]).toBe("Numéro de téléphone manquant.");
    expect(a.lignes[1].details[0]).toEqual({ code: "PHONE_INVALID" });
    expect(a.lignes[1].messages[0]).toContain("indicatif du pays");
    expect(a.lignes[1].donnees.phone).toBe("77 123 45 67");
  });

  it("civilité : M., Mr, Monsieur, Mme, Madame, Mrs, Ms sont comprises ; vide donne « non précisée » ; inconnue est refusée", async () => {
    const m = await createManager();
    const cas: Array<[string, "M" | "MME" | null]> = [
      ["M", "M"],
      ["M.", "M"],
      ["mr", "M"],
      ["Monsieur", "M"],
      ["Mme", "MME"],
      ["MADAME", "MME"],
      ["Mrs", "MME"],
      ["ms", "MME"],
      ["", null],
    ];

    const a = await locataires(m.id, cas.map(([civilite], i) => locataire({ civilite, email: `l${i}@example.com` })));

    cas.forEach(([, attendu], i) => expect(a.lignes[i].donnees.civility).toBe(attendu));
    const b = await locataires(m.id, [locataire({ civilite: "Dr" })]);
    expect(b.lignes[0].details[0]).toEqual({ code: "IMPORT_ROW_CIVILITY_UNKNOWN", params: { value: "Dr" } });
    expect(b.lignes[0].messages[0]).toBe("Civilité inconnue : « Dr » (M ou Mme).");
  });

  it("doublons : avec un locataire existant de l'agence (sans tenir compte des majuscules), ou plus haut dans le fichier", async () => {
    const m = await createManager();
    await createTenant(m.id, { email: "deja@example.com" });

    const a = await locataires(m.id, [
      locataire({ email: "DEJA@example.com" }),
      locataire({ email: "nouveau@example.com" }),
      locataire({ email: "Nouveau@Example.com", prenom: "Autre" }),
    ]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["DOUBLON", "OK", "DOUBLON"]);
    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_TENANT_DUPLICATE"]);
    expect(a.lignes[0].messages[0]).toContain("existe déjà");
    expect(a.resume).toEqual({ total: 3, valides: 1, doublons: 2, erreurs: 0 });
  });

  it("un locataire existant dont l'e-mail a été saisi avec des majuscules est reconnu comme doublon", async () => {
    const m = await createManager();
    await createTenant(m.id, { email: "Deja.Majuscules@Example.com" });

    const a = await locataires(m.id, [locataire({ email: "deja.majuscules@example.com" })]);

    expect(a.lignes[0].statut).toBe("DOUBLON");
  });

  it("un locataire d'une AUTRE agence avec le même e-mail n'est pas un doublon (l'unicité est par agence)", async () => {
    const m = await createManager();
    const autre = await createManager();
    await createTenant(autre.id, { email: "partage@example.com" });

    const a = await locataires(m.id, [locataire({ email: "partage@example.com" })]);

    expect(a.lignes[0].statut).toBe("OK");
  });

  it("une ligne en erreur n'est jamais déclarée doublon, et ne réserve pas son e-mail", async () => {
    const m = await createManager();

    const a = await locataires(m.id, [locataire({ prenom: "" }), locataire()]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "OK"]);
  });

  it("des colonnes obligatoires absentes refusent tout le fichier", async () => {
    const m = await createManager();

    const erreur = await analyserLocataires(m.id, fichier(["prenom", "nom"], [])).catch((e) => e);

    expect(erreur).toBeInstanceOf(ImportInvalide);
    expect(erreur.code).toBe("IMPORT_MISSING_COLUMNS");
    expect(erreur.message).toContain("« telephone »");
    expect(erreur.message).toContain("« email »");
  });
});

describe("écriture des imports", () => {
  it("importerBiens n'écrit que les lignes valides, sans description vide, et renvoie leur nombre", async () => {
    const m = await createManager();
    const a = await biens(m.id, [bien({ titre: "Écrit", description: "" }), bien({ titre: "Refusé", surface: "" }), bien({ titre: "Écrit 2", description: "Notes", statut: "travaux" })]);

    expect(await importerBiens(m.id, a)).toBe(2);

    const ecrits = await testDb.select().from(properties).where(eq(properties.managerId, m.id));
    expect(ecrits.map((p: { title: string }) => p.title).sort()).toEqual(["Écrit", "Écrit 2"]);
    const [premier] = ecrits.filter((p: { title: string }) => p.title === "Écrit");
    expect(premier).toMatchObject({ description: null, surface: 28, rent: 250000, currency: "XOF", status: "AVAILABLE" });
    const [second] = ecrits.filter((p: { title: string }) => p.title === "Écrit 2");
    expect(second).toMatchObject({ description: "Notes", status: "MAINTENANCE" });
  });

  it("rien de valide : rien n'est écrit et le résultat est 0", async () => {
    const m = await createManager();
    const a = await biens(m.id, [bien({ surface: "" })]);

    expect(await importerBiens(m.id, a)).toBe(0);
    expect(await compterBiens(m.id)).toBe(0);
  });

  it("compterBiens ne compte que les biens de l'agence", async () => {
    const m = await createManager();
    const autre = await createManager();
    await createProperty(m.id);
    await createProperty(m.id, { title: "Deux" });
    await createProperty(autre.id);

    expect(await compterBiens(m.id)).toBe(2);
    expect(await compterBiens(autre.id)).toBe(1);
  });

  it("importerLocataires n'écrit que les lignes valides, pour la bonne agence, avec le téléphone normalisé", async () => {
    const m = await createManager();
    const a = await locataires(m.id, [locataire({ civilite: "Mme" }), locataire({ email: "b@example.com", prenom: "" })]);

    expect(await importerLocataires(m.id, a)).toBe(1);

    const [ecrit] = await testDb.select().from(tenants).where(eq(tenants.managerId, m.id));
    expect(ecrit).toMatchObject({ civility: "MME", firstName: "Moussa", lastName: "Diop", phone: "+221771234567", email: "moussa.diop@example.com" });
  });

  it("importerLocataires : rien de valide donne 0 sans toucher à la base", async () => {
    const m = await createManager();
    const a = await locataires(m.id, [locataire({ email: "" })]);

    expect(await importerLocataires(m.id, a)).toBe(0);
    expect(await testDb.select().from(tenants).where(eq(tenants.managerId, m.id))).toEqual([]);
  });

  it("un locataire créé entre l'analyse et l'écriture (deuxième onglet) est ignoré sans erreur, et seules les vraies écritures sont comptées", async () => {
    const m = await createManager();
    const a = await locataires(m.id, [locataire({ email: "course@example.com" }), locataire({ email: "libre@example.com", prenom: "Awa" })]);
    await createTenant(m.id, { email: "course@example.com" }); // créé après l'analyse

    expect(await importerLocataires(m.id, a)).toBe(1);

    const emails = (await testDb.select().from(tenants).where(eq(tenants.managerId, m.id))).map((t: { email: string }) => t.email).sort();
    expect(emails).toEqual(["course@example.com", "libre@example.com"]);
  });
});

describe("modèles et colonnes", () => {
  it("chaque modèle téléchargeable contient toutes les colonnes obligatoires de son type", () => {
    expect(MODELES_CSV.properties.split("\n")[0]).toBe("titre;adresse;surface;loyer;devise;statut;description");
    expect(MODELES_CSV.tenants.split("\n")[0]).toBe("civilite;prenom;nom;telephone;email");
    expect(MODELES_CSV.contracts.split("\n")[0].split(";")).toEqual(
      expect.arrayContaining(["bien", "email_locataire", "loyer", "depot", "debut", "fin"])
    );
    expect(COLONNES_OBLIGATOIRES.properties).toEqual(["title", "address", "surface", "rent"]);
  });

  it("la ligne d'exemple de chaque modèle est elle-même importable sans erreur", async () => {
    const m = await createManager();
    const lire = (modele: string) => {
      const [entete, exemple] = modele.trim().split("\n");
      const noms = entete.split(";");
      const valeurs = exemple.split(";");
      return fichier(noms, [Object.fromEntries(noms.map((n, i) => [n, valeurs[i]]))]);
    };

    const b = await analyserBiens(m.id, lire(MODELES_CSV.properties), OPTIONS);
    const l = await analyserLocataires(m.id, lire(MODELES_CSV.tenants));

    expect(b.resume).toEqual({ total: 1, valides: 1, doublons: 0, erreurs: 0 });
    expect(l.resume).toEqual({ total: 1, valides: 1, doublons: 0, erreurs: 0 });
  });
});
