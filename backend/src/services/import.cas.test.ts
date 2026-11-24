import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contracts } from "../db/schema";
import { createContract, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import type { CsvLu } from "../utils/csvImport";
import { MONTANT_MAXIMUM, SURFACE_MAXIMUM } from "../utils/montant";
import { analyserBiens, analyserContrats, analyserLocataires, ImportInvalide, importerContrats } from "./import.service";

/**
 * Audit par sabotage de import.service.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Trois sortes de lacunes : chaque NOM d'en-tête accepté pour un champ (un tableur ne s'appelle pas toujours « titre » ou « loyer » :
 * « intitulé », « m2 », « caution », « entrée »… — retirer un alias cassait l'import des fichiers qui l'emploient, sans qu'un test
 * le voie), les bornes exactes (plafonds atteints, bornes qui se touchent) et les textes ou synonymes (types de bail, statuts).
 */

const MAINTENANT = new Date(Date.UTC(2026, 9, 12, 9, 0, 0));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
});
afterEach(() => vi.useRealTimers());

function fichier(entetes: string[], lignes: Array<Record<string, string>>, delimiteur: CsvLu["delimiteur"] = ";"): CsvLu {
  return { delimiteur, entetes, lignes: lignes.map((valeurs, i) => ({ ligne: i + 2, valeurs })) };
}
const OPTIONS = { deviseParDefaut: "XOF", maximumBiens: null as number | null };
const codes = (l: { details: Array<{ code: string }> }) => l.details.map((d) => d.code);

/* ───────────────────────────── Alias de colonnes ───────────────────────────── */

type Champ<D> = { alias: string[]; valeur: string; lu: (d: D) => unknown; attendu: unknown; obligatoire: string | null };

const BIENS_BASE: Record<string, string> = { titre: "Studio", adresse: "12 rue du Port", surface: "28", loyer: "250000" };
const CHAMPS_BIENS: Record<string, Champ<{ title: string; address: string; surface: number | null; rent: number | null; currency: string; status: string; description: string }>> = {
  title: { alias: ["titre", "title", "nom", "bien", "intitule", "designation"], valeur: "Villa Almadies", lu: (d) => d.title, attendu: "Villa Almadies", obligatoire: "titre" },
  address: { alias: ["adresse", "address"], valeur: "Rue des Almadies", lu: (d) => d.address, attendu: "Rue des Almadies", obligatoire: "adresse" },
  surface: { alias: ["surface", "superficie", "m2", "surfacem2"], valeur: "42", lu: (d) => d.surface, attendu: 42, obligatoire: "surface" },
  rent: { alias: ["loyer", "rent", "loyermensuel", "loyerhorscharges"], valeur: "300000", lu: (d) => d.rent, attendu: 300000, obligatoire: "loyer" },
  currency: { alias: ["devise", "currency", "monnaie"], valeur: "EUR", lu: (d) => d.currency, attendu: "EUR", obligatoire: null },
  status: { alias: ["statut", "status", "etat"], valeur: "OCCUPIED", lu: (d) => d.status, attendu: "OCCUPIED", obligatoire: null },
  description: { alias: ["description", "commentaire", "notes"], valeur: "Vue mer", lu: (d) => d.description, attendu: "Vue mer", obligatoire: null },
};

describe("import des biens : chaque nom d'en-tête accepté", () => {
  const cas = Object.entries(CHAMPS_BIENS).flatMap(([champ, c]) => c.alias.map((alias) => [champ, alias] as const));

  it.each(cas)("%s : la colonne « %s » est lue", async (champ, alias) => {
    const manager = await createManager();
    const c = CHAMPS_BIENS[champ];
    const ligne = { ...BIENS_BASE };
    if (c.obligatoire) delete ligne[c.obligatoire];
    ligne[alias] = c.valeur;

    const analyse = await analyserBiens(manager.id, fichier(Object.keys(ligne), [ligne]), OPTIONS);

    expect(analyse.lignes[0].statut).toBe("OK");
    expect(c.lu(analyse.lignes[0].donnees)).toEqual(c.attendu);
  });
});

const LOCATAIRES_BASE: Record<string, string> = { prenom: "Moussa", nom: "Diop", telephone: "+221 77 123 45 67", email: "moussa@example.com" };
const CHAMPS_LOCATAIRES: Record<string, Champ<{ civility: string | null; firstName: string; lastName: string; phone: string; email: string }>> = {
  civility: { alias: ["civilite", "civility", "titre"], valeur: "Mme", lu: (d) => d.civility, attendu: "MME", obligatoire: null },
  firstName: { alias: ["prenom", "firstname", "prenoms"], valeur: "Awa", lu: (d) => d.firstName, attendu: "Awa", obligatoire: "prenom" },
  lastName: { alias: ["nom", "lastname", "nomdefamille"], valeur: "Ndiaye", lu: (d) => d.lastName, attendu: "Ndiaye", obligatoire: "nom" },
  phone: { alias: ["telephone", "tel", "phone", "mobile", "portable"], valeur: "+221 78 000 00 00", lu: (d) => d.phone, attendu: "+221780000000", obligatoire: "telephone" },
  email: { alias: ["email", "courriel", "mail", "adresseemail"], valeur: "awa@example.com", lu: (d) => d.email, attendu: "awa@example.com", obligatoire: "email" },
};

describe("import des locataires : chaque nom d'en-tête accepté", () => {
  const cas = Object.entries(CHAMPS_LOCATAIRES).flatMap(([champ, c]) => c.alias.map((alias) => [champ, alias] as const));

  it.each(cas)("%s : la colonne « %s » est lue", async (champ, alias) => {
    const manager = await createManager();
    const c = CHAMPS_LOCATAIRES[champ];
    const ligne = { ...LOCATAIRES_BASE };
    if (c.obligatoire) delete ligne[c.obligatoire];
    ligne[alias] = c.valeur;

    const analyse = await analyserLocataires(manager.id, fichier(Object.keys(ligne), [ligne]));

    expect(analyse.lignes[0].statut).toBe("OK");
    expect(c.lu(analyse.lignes[0].donnees)).toEqual(c.attendu);
  });
});

const CONTRATS_BASE: Record<string, string> = { bien: "Studio Centre-ville", emaillocataire: "moussa.diop@example.com", loyer: "250000", depot: "500000", debut: "01/03/2026", fin: "28/02/2028" };
type D = {
  propertyId: string | null;
  tenantId: string | null;
  rent: number | null;
  deposit: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  paymentDay: number | null;
  leaseType: string;
  applicableLaw: string | null;
  status: string;
  billingFrom: string | null;
};
// `attendu` d'un champ qui dépend de la base de test est calculé dans le test (voir `resoudre`).
const CHAMPS_CONTRATS: Record<string, { alias: string[]; valeur: string; lu: (d: D) => unknown; attendu: unknown; obligatoire: string | null }> = {
  property: { alias: ["bien", "titrebien", "titre", "property", "logement"], valeur: "Studio Centre-ville", lu: (d) => d.propertyId, attendu: "STUDIO", obligatoire: "bien" },
  propertyAddress: { alias: ["adressebien", "adresse", "address"], valeur: "3 avenue Jumelle B", lu: (d) => d.propertyId, attendu: "JUMELLE_B", obligatoire: null },
  tenantEmail: { alias: ["emaillocataire", "email", "courriel", "mail", "tenantemail"], valeur: "moussa.diop@example.com", lu: (d) => d.tenantId, attendu: "MOUSSA", obligatoire: "emaillocataire" },
  rent: { alias: ["loyer", "rent", "loyermensuel"], valeur: "310000", lu: (d) => d.rent, attendu: 310000, obligatoire: "loyer" },
  deposit: { alias: ["depot", "depotdegarantie", "caution", "cautionnement", "deposit"], valeur: "620000", lu: (d) => d.deposit, attendu: 620000, obligatoire: "depot" },
  currency: { alias: ["devise", "currency", "monnaie"], valeur: "EUR", lu: (d) => d.currency, attendu: "EUR", obligatoire: null },
  startDate: { alias: ["debut", "datedebut", "datededebut", "startdate", "entree", "dateentree"], valeur: "05/04/2026", lu: (d) => d.startDate, attendu: "2026-04-05", obligatoire: "debut" },
  endDate: { alias: ["fin", "datefin", "datedefin", "enddate"], valeur: "05/04/2029", lu: (d) => d.endDate, attendu: "2029-04-05", obligatoire: "fin" },
  paymentDay: { alias: ["jourecheance", "jourdepaiement", "jourloyer", "paymentday"], valeur: "15", lu: (d) => d.paymentDay, attendu: 15, obligatoire: null },
  leaseType: { alias: ["typedebail", "typebail", "type", "leasetype"], valeur: "commercial", lu: (d) => d.leaseType, attendu: "COMMERCIAL", obligatoire: null },
  applicableLaw: { alias: ["droitapplicable", "droit", "applicablelaw"], valeur: "Droit sénégalais", lu: (d) => d.applicableLaw, attendu: "Droit sénégalais", obligatoire: null },
  status: { alias: ["statut", "status", "etat"], valeur: "terminé", lu: (d) => d.status, attendu: "ENDED", obligatoire: null },
  billingFrom: { alias: ["facturationdepuis", "facturerapartirde", "facturationapartirde", "billingfrom"], valeur: "01/12/2026", lu: (d) => d.billingFrom, attendu: "2026-12-01", obligatoire: null },
};

async function agenceContrats() {
  const manager = await createManager();
  const studio = await createProperty(manager.id, { title: "Studio Centre-ville", address: "12 rue des Écoles", currency: "XOF" });
  await createProperty(manager.id, { title: "Villa Jumelle", address: "1 avenue Jumelle A", currency: "XOF" });
  const jumelleB = await createProperty(manager.id, { title: "Villa Jumelle", address: "3 avenue Jumelle B", currency: "XOF" });
  const moussa = await createTenant(manager.id, { email: "moussa.diop@example.com" });
  return { manager, studio, jumelleB, moussa };
}

describe("import des contrats : chaque nom d'en-tête accepté", () => {
  const cas = Object.entries(CHAMPS_CONTRATS).flatMap(([champ, c]) => c.alias.map((alias) => [champ, alias] as const));

  it.each(cas)("%s : la colonne « %s » est lue", async (champ, alias) => {
    const { manager, studio, jumelleB, moussa } = await agenceContrats();
    const c = CHAMPS_CONTRATS[champ];
    const ligne = { ...CONTRATS_BASE };
    if (c.obligatoire) delete ligne[c.obligatoire];
    // L'adresse du bien ne sert qu'à départager deux biens de même titre.
    if (champ === "propertyAddress") ligne.bien = "Villa Jumelle";
    ligne[alias] = c.valeur;

    const analyse = await analyserContrats(manager.id, fichier(Object.keys(ligne), [ligne]), MAINTENANT);

    const resoudre = (v: unknown) => (v === "STUDIO" ? studio.id : v === "JUMELLE_B" ? jumelleB.id : v === "MOUSSA" ? moussa.id : v);
    expect(analyse.lignes[0].statut).toBe("OK");
    expect(c.lu(analyse.lignes[0].donnees)).toEqual(resoudre(c.attendu));
  });
});

/* ───────────────────────────── Bornes et textes ───────────────────────────── */

describe("import : refus d'un fichier dont il manque des colonnes", () => {
  it("une seule colonne obligatoire manquante suffit à refuser le fichier", async () => {
    const manager = await createManager();

    await expect(analyserBiens(manager.id, fichier(["titre", "adresse", "surface"], []), OPTIONS)).rejects.toMatchObject({ code: "IMPORT_MISSING_COLUMNS" });
  });

  it("plusieurs colonnes manquantes : le message nomme chacune avec ses alias, séparées par « ; », et l'invitation à télécharger le modèle", async () => {
    const manager = await createManager();

    const erreur = await analyserBiens(manager.id, fichier(["surface", "loyer"], []), OPTIONS).catch((e) => e);

    expect(erreur).toBeInstanceOf(ImportInvalide);
    expect(erreur.params).toEqual({ columns: "« titre » (ou title, nom) ; « adresse » (ou address)" });
    expect(erreur.message).toBe("Colonnes manquantes : « titre » (ou title, nom) ; « adresse » (ou address). Téléchargez le modèle pour voir l'en-tête attendu.");
  });
});

describe("import des biens : bornes et textes", () => {
  const ligne = (extra: Record<string, string> = {}) => ({ titre: "Studio", adresse: "12 rue du Port", surface: "28", loyer: "250000", ...extra });
  const analyse = async (lignes: Array<Record<string, string>>) => {
    const manager = await createManager();
    return analyserBiens(manager.id, fichier(["titre", "adresse", "surface", "loyer", "statut", "description"], lignes), OPTIONS);
  };

  it("une surface et un loyer égaux au plafond sont acceptés", async () => {
    const a = await analyse([ligne({ surface: String(SURFACE_MAXIMUM), loyer: String(MONTANT_MAXIMUM) })]);

    expect(a.lignes[0].statut).toBe("OK");
  });

  it("les textes des refus de longueur sont ceux de l'écran", async () => {
    const a = await analyse([ligne({ titre: "x".repeat(201), adresse: "y".repeat(301), description: "z".repeat(5001) })]);

    expect(a.lignes[0].messages).toEqual([
      "Titre trop long (200 caractères maximum).",
      "Adresse trop longue (300 caractères maximum).",
      "Description trop longue (5 000 caractères maximum).",
    ]);
  });

  it("le statut AVAILABLE écrit en toutes lettres est lu", async () => {
    const a = await analyse([ligne({ statut: "AVAILABLE" }), ligne({ titre: "Autre", statut: "OCCUPIED" })]);

    expect(a.lignes.map((l) => l.donnees.status)).toEqual(["AVAILABLE", "OCCUPIED"]);
  });

  it("deux biens dont les titres et adresses se recollent ne sont pas des doublons (« aab » + « c cc » ≠ « aa » + « bc cc »)", async () => {
    const a = await analyse([ligne({ titre: "aab", adresse: "c cc" }), ligne({ titre: "aa", adresse: "bc cc" })]);

    expect(a.lignes.map((l) => l.statut)).toEqual(["OK", "OK"]);
  });
});

describe("import des locataires : e-mail et délimiteur", () => {
  it("un e-mail suivi d'un caractère parasite est refusé", async () => {
    const manager = await createManager();
    const entetes = ["prenom", "nom", "telephone", "email"];
    const base = { prenom: "Moussa", nom: "Diop", telephone: "+221 77 123 45 67" };

    const a = await analyserLocataires(
      manager.id,
      fichier(entetes, [
        { ...base, email: "moussa@example.co x" },
        { ...base, email: "moussa@example.co@x" },
        { ...base, email: "moussa@example.com" },
      ])
    );

    expect(a.lignes.map((l) => l.statut)).toEqual(["ERREUR", "ERREUR", "OK"]);
    expect(codes(a.lignes[0])).toEqual(["IMPORT_ROW_EMAIL_INVALID"]);
  });

  it("l'analyse rend le délimiteur du fichier", async () => {
    const manager = await createManager();

    const a = await analyserLocataires(manager.id, fichier(["prenom", "nom", "telephone", "email"], [], ","));

    expect(a.delimiteur).toBe(",");
  });
});

describe("import des contrats : synonymes, bornes et textes", () => {
  const entetes = ["bien", "emaillocataire", "loyer", "depot", "debut", "fin", "typedebail", "statut", "facturationdepuis"];
  const ligne = (extra: Record<string, string> = {}) => ({ ...CONTRATS_BASE, ...extra });
  const analyse = async (lignes: Array<Record<string, string>>, e = entetes) => {
    const ctx = await agenceContrats();
    return { ...ctx, analyse: await analyserContrats(ctx.manager.id, fichier(e, lignes), MAINTENANT) };
  };

  it.each([
    ["habitation", "HABITATION"],
    ["habitationnel", "HABITATION"],
    ["logement", "HABITATION"],
    ["nu", "HABITATION"],
    ["meublé", "MEUBLE"],
    ["meublée", "MEUBLE"],
    ["habitation meublée", "MEUBLE"],
    ["habitation-meublée", "MEUBLE"],
    ["habitation’meublée", "MEUBLE"],
    ["habitation meublé", "MEUBLE"],
    ["commercial", "COMMERCIAL"],
    ["commerce", "COMMERCIAL"],
    ["professionnel", "PROFESSIONNEL"],
    ["professionnelle", "PROFESSIONNEL"],
    ["bureau", "PROFESSIONNEL"],
  ])("le type de bail « %s » est lu comme %s", async (saisie, attendu) => {
    const { analyse: a } = await analyse([ligne({ typedebail: saisie })]);

    expect(a.lignes[0].donnees.leaseType).toBe(attendu);
  });

  it.each([
    ["active", "ACTIVE"],
    ["actif", "ACTIVE"],
    ["en cours", "ACTIVE"],
    ["en_cours", "ACTIVE"],
    ["en-cours", "ACTIVE"],
    ["ended", "ENDED"],
    ["terminé", "ENDED"],
    ["échu", "ENDED"],
    ["fini", "ENDED"],
    ["terminated", "TERMINATED"],
    ["résilié", "TERMINATED"],
  ])("le statut « %s » est lu comme %s", async (saisie, attendu) => {
    const { analyse: a } = await analyse([ligne({ statut: saisie })]);

    expect(a.lignes[0].donnees.status).toBe(attendu);
  });

  it("un loyer et un dépôt égaux au plafond sont acceptés", async () => {
    const { analyse: a } = await analyse([ligne({ loyer: String(MONTANT_MAXIMUM), depot: String(MONTANT_MAXIMUM) })]);

    expect(a.lignes[0].statut).toBe("OK");
  });

  it("un bien introuvable garde la devise par défaut (EUR) dans les valeurs affichées à l'aperçu", async () => {
    const { analyse: a } = await analyse([ligne({ bien: "Bien inconnu" })]);

    expect(a.lignes[0].statut).toBe("ERREUR");
    expect(a.lignes[0].donnees.currency).toBe("EUR");
  });

  it("la date de fin manquante ou invalide a son propre texte", async () => {
    const { analyse: a } = await analyse([ligne({ fin: "" }), ligne({ fin: "31/02/2028" })]);

    expect(a.lignes[0].messages).toEqual(["Date de fin manquante."]);
    expect(a.lignes[1].messages).toEqual(["Date de fin invalide : « 31/02/2028 » (jj/mm/aaaa)."]);
  });

  it("une première facture qui tombe le mois de la fin du bail est annoncée (« 11/2026 »), pas supprimée", async () => {
    const { analyse: a } = await analyse([ligne({ debut: "01/03/2026", fin: "01/11/2026", facturationdepuis: "01/11/2026" })]);

    expect(a.lignes[0].donnees.premiereFacture).toBe("11/2026");
  });

  it("l'analyse rend le délimiteur du fichier", async () => {
    const ctx = await agenceContrats();

    const a = await analyserContrats(ctx.manager.id, fichier(entetes, [], "\t"), MAINTENANT);

    expect(a.delimiteur).toBe("\t");
  });

  it("un bail existant qui commence le jour où le nouveau finit ne le chevauche pas, à l'analyse comme à l'écriture", async () => {
    const { manager, studio, moussa } = await agenceContrats();
    await createContract(studio.id, moussa.id, { status: "ACTIVE", startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2027, 8, 1)) });
    const lignes = [ligne({ debut: "01/09/2025", fin: "01/09/2026" })];

    const a = await analyserContrats(manager.id, fichier(entetes, lignes), MAINTENANT);
    expect(a.lignes[0].statut).toBe("OK");

    expect(await importerContrats(manager.id, a)).toBe(1);
  });

  it("l'écriture garde la date de début de la ligne", async () => {
    const { manager, studio } = await agenceContrats();
    const a = await analyserContrats(manager.id, fichier(entetes, [ligne({ debut: "05/04/2026", fin: "05/04/2029" })]), MAINTENANT);

    await importerContrats(manager.id, a);

    const [bail] = await testDb.select().from(contracts).where(eq(contracts.propertyId, studio.id));
    expect(bail.startDate.toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(bail.endDate.toISOString().slice(0, 10)).toBe("2029-04-05");
  });
});
