import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, properties, tenants } from "../db/schema";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Import CSV de biens et de locataires : la migration depuis un tableur, premier
 * frein à l'adoption pour un cabinet qui a déjà ses données.
 */
async function agence(plan: "STARTER" | "PRO" | "ENTERPRISE" = "ENTERPRISE", extra: Record<string, unknown> = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: plan, ...extra });
  return { manager, h: authHeader(tokenFor(manager)) };
}

const apercu = (h: Record<string, string>, type: string, csv: string) => request(app).post("/api/import/preview").set(h).send({ type, csv });
const importer = (h: Record<string, string>, type: string, csv: string) => request(app).post("/api/import").set(h).send({ type, csv });
const biensDe = (managerId: string) => testDb.select().from(properties).where(eq(properties.managerId, managerId));
const locatairesDe = (managerId: string) => testDb.select().from(tenants).where(eq(tenants.managerId, managerId));

const CSV_BIENS = [
  "Titre;Adresse;Surface;Loyer;Devise;Statut;Description",
  "Studio A;12 rue des Écoles, Dakar;28;250 000;XOF;Disponible;Studio meublé",
  "Villa B;3 avenue Ndiaye;120;1 250,50;EUR;Occupé;",
  "Garage;;15;50;EUR;;",
  "Loft C;8 quai Sud;abc;900;EUR;;",
  "Studio A;12 RUE des écoles, Dakar;30;260000;XOF;;",
].join("\r\n");

describe("import de biens — aperçu", () => {
  it("vérifie chaque ligne sans rien écrire : valides, erreurs expliquées et doublons", async () => {
    const { manager, h } = await agence();
    const res = await apercu(h, "properties", "﻿" + CSV_BIENS);

    expect(res.status).toBe(200);
    expect(res.body.delimiteur).toBe(";");
    expect(res.body.resume).toEqual({ total: 5, valides: 2, doublons: 1, erreurs: 2 });
    const [studio, villa, garage, loft, doublon] = res.body.lignes;
    expect(studio).toMatchObject({ ligne: 2, statut: "OK", donnees: { title: "Studio A", surface: 28, rent: 250000, currency: "XOF", status: "AVAILABLE" } });
    expect(villa).toMatchObject({ statut: "OK", donnees: { rent: 1250.5, status: "OCCUPIED" } });
    expect(garage).toMatchObject({ ligne: 4, statut: "ERREUR" });
    expect(garage.messages.join(" ")).toContain("Adresse");
    expect(loft.messages.join(" ")).toContain("Surface invalide : « abc »");
    // Même bien, écrit autrement (casse, accents) : repéré comme doublon du premier.
    expect(doublon).toMatchObject({ ligne: 6, statut: "DOUBLON" });
    expect(await biensDe(manager.id)).toHaveLength(0);
  });

  it("accepte les en-têtes de tous les jours : accents, majuscules, noms équivalents, séparateur virgule", async () => {
    const { h } = await agence();
    const res = await apercu(h, "properties", "Nom,Adresse,Superficie,Loyer mensuel\nStudio A,1 rue X,28,500");
    expect(res.status).toBe(200);
    expect(res.body.lignes[0]).toMatchObject({ statut: "OK", donnees: { title: "Studio A", surface: 28, rent: 500 } });
  });

  it("applique la devise du gestionnaire quand la colonne est absente, et refuse une devise inconnue", async () => {
    const { h } = await agence("ENTERPRISE", { currency: "XOF" });
    const res = await apercu(h, "properties", "titre;adresse;surface;loyer;devise\nBien A;1 rue X;20;100;\nBien B;2 rue Y;20;100;ZZZ");
    expect(res.body.lignes[0]).toMatchObject({ statut: "OK", donnees: { currency: "XOF" } });
    expect(res.body.lignes[1]).toMatchObject({ statut: "ERREUR" });
    expect(res.body.lignes[1].messages.join(" ")).toContain("Devise inconnue");
  });

  it("refuse tout le fichier, en nommant les colonnes manquantes", async () => {
    const { h } = await agence();
    const res = await apercu(h, "properties", "titre;adresse\nA;1 rue X");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Colonnes manquantes");
    expect(res.body.error).toContain("surface");
    expect(res.body.error).toContain("loyer");
  });

  it.each([
    ["fichier vide", ""],
    ["en-tête seul", "titre;adresse;surface;loyer"],
    ["guillemet non refermé", 'titre;adresse;surface;loyer\n"A;1;2;3'],
  ])("répond 400 pour %s", async (_nom, csv) => {
    const { h } = await agence();
    const res = await apercu(h, "properties", csv);
    expect(res.status).toBe(400);
  });

  it("refuse un type inconnu et plus de 500 lignes", async () => {
    const { h } = await agence();
    expect((await apercu(h, "contracts", "a;b\n1;2")).status).toBe(400);
    const lignes = Array.from({ length: 501 }, (_, i) => `Bien ${i};adresse ${i};20;100`).join("\n");
    const res = await apercu(h, "properties", "titre;adresse;surface;loyer\n" + lignes);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("500");
  });
});

describe("import de biens — écriture", () => {
  it("n'écrit que les lignes valides, pour le gestionnaire connecté, et le journalise", async () => {
    const { manager, h } = await agence();
    const res = await importer(h, "properties", CSV_BIENS);

    expect(res.status).toBe(201);
    expect(res.body.importees).toBe(2);
    expect(res.body.resume).toEqual({ total: 5, valides: 2, doublons: 1, erreurs: 2 });
    const biens = await biensDe(manager.id);
    expect(biens.map((b: { title: string }) => b.title).sort()).toEqual(["Studio A", "Villa B"]);
    expect(biens.find((b: { title: string }) => b.title === "Villa B")).toMatchObject({ rent: 1250.5, status: "OCCUPIED", currency: "EUR", description: null });

    const [journal] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.action).toBe("import.properties");
    expect(journal.details).toContain("2 biens importé(s) sur 5");
  });

  it("importé deux fois, le même fichier ne crée rien la seconde fois", async () => {
    const { manager, h } = await agence();
    await importer(h, "properties", CSV_BIENS);
    const second = await importer(h, "properties", CSV_BIENS);

    expect(second.body.importees).toBe(0);
    expect(second.body.resume.doublons).toBe(3);
    expect(await biensDe(manager.id)).toHaveLength(2);
  });

  it("rejoue l'analyse côté serveur : rien ne dépend de ce que l'aperçu a affiché", async () => {
    const { manager, h } = await agence();
    await createProperty(manager.id, { title: "Studio A", address: "12 rue des Écoles, Dakar" });
    const res = await importer(h, "properties", CSV_BIENS);
    expect(res.body.importees).toBe(1); // seul « Villa B »
  });

  it("respecte le plafond de biens de la formule (Starter : 5), comme la création à la main", async () => {
    const { manager, h } = await agence("STARTER");
    await createProperty(manager.id, { title: "Existant 1" });
    await createProperty(manager.id, { title: "Existant 2" });
    const lignes = Array.from({ length: 6 }, (_, i) => `Bien ${i + 1};adresse ${i + 1};20;100`).join("\n");

    const res = await importer(h, "properties", "titre;adresse;surface;loyer\n" + lignes);

    expect(res.body.capacite).toEqual({ maximum: 5, existants: 2, restant: 3 });
    expect(res.body.importees).toBe(3);
    expect(res.body.resume.erreurs).toBe(3);
    expect(res.body.lignes[3].messages.join(" ")).toContain("Limite de 5 biens");
    expect(await biensDe(manager.id)).toHaveLength(5);
  });

  it("la formule Entreprise n'a pas de plafond", async () => {
    const { h } = await agence("ENTERPRISE");
    const lignes = Array.from({ length: 8 }, (_, i) => `Bien ${i + 1};adresse ${i + 1};20;100`).join("\n");
    const res = await importer(h, "properties", "titre;adresse;surface;loyer\n" + lignes);
    expect(res.body.capacite.maximum).toBeNull();
    expect(res.body.importees).toBe(8);
  });

  it("isole les agences : les biens d'une autre agence ne comptent ni comme doublons ni dans le plafond", async () => {
    const autre = await createManager();
    await createProperty(autre.id, { title: "Studio A", address: "12 rue des Écoles, Dakar" });
    const { manager, h } = await agence();
    const res = await importer(h, "properties", "titre;adresse;surface;loyer\nStudio A;12 rue des Écoles, Dakar;28;250000");
    expect(res.body.importees).toBe(1);
    expect(await biensDe(manager.id)).toHaveLength(1);
    expect(await biensDe(autre.id)).toHaveLength(1);
  });
});

const CSV_LOCATAIRES = [
  "Civilité;Prénom;Nom;Téléphone;Email",
  "M.;Moussa;Diop;+221 77 123 45 67;Moussa.Diop@Example.com",
  "Madame;Awa;Sy;00221771234568;awa.sy@example.com",
  ";Ibou;Fall;77 123 45 69;ibou@example.com",
  "M;Fatou;;+221771234570;fatou@example.com",
  "M;Omar;Ba;+221771234571;pas-un-email",
  "M;Moussa;Diop;+221771234572;moussa.diop@example.com",
].join("\n");

describe("import de locataires", () => {
  it("normalise téléphone (international) et email (minuscules), traduit la civilité, explique chaque refus", async () => {
    const { manager, h } = await agence();
    const res = await apercu(h, "tenants", CSV_LOCATAIRES);

    expect(res.status).toBe(200);
    expect(res.body.resume).toEqual({ total: 6, valides: 2, doublons: 1, erreurs: 3 });
    const [moussa, awa, ibou, fatou, omar, doublon] = res.body.lignes;
    expect(moussa).toMatchObject({ statut: "OK", donnees: { civility: "M", phone: "+221771234567", email: "moussa.diop@example.com" } });
    expect(awa).toMatchObject({ statut: "OK", donnees: { civility: "MME", phone: "+221771234568" } });
    // Pas d'indicatif : refusé plutôt que deviné, comme à la création à la main.
    expect(ibou.statut).toBe("ERREUR");
    expect(ibou.messages.join(" ")).toContain("indicatif");
    expect(fatou.messages).toContain("Nom manquant.");
    expect(omar.messages.join(" ")).toContain("Adresse email invalide");
    expect(doublon).toMatchObject({ ligne: 7, statut: "DOUBLON" });
    expect(await locatairesDe(manager.id)).toHaveLength(0);
  });

  it("écrit les lignes valides, ignore les doublons existants, et ne recrée rien au second import", async () => {
    const { manager, h } = await agence();
    await createTenant(manager.id, { email: "awa.sy@example.com" });

    const res = await importer(h, "tenants", CSV_LOCATAIRES);
    expect(res.status).toBe(201);
    expect(res.body.importees).toBe(1); // Moussa seulement : Awa existe déjà
    expect(res.body.resume.doublons).toBe(2);
    const locataires = await locatairesDe(manager.id);
    expect(locataires.map((t: { email: string }) => t.email).sort()).toEqual(["awa.sy@example.com", "moussa.diop@example.com"]);

    const second = await importer(h, "tenants", CSV_LOCATAIRES);
    expect(second.body.importees).toBe(0);
    expect(await locatairesDe(manager.id)).toHaveLength(2);
  });

  it("deux agences peuvent avoir le même locataire (l'unicité est par agence)", async () => {
    const autre = await createManager();
    await createTenant(autre.id, { email: "moussa.diop@example.com" });
    const { manager, h } = await agence();
    const res = await importer(h, "tenants", "prenom;nom;telephone;email\nMoussa;Diop;+221771234567;moussa.diop@example.com");
    expect(res.body.importees).toBe(1);
    expect(await locatairesDe(manager.id)).toHaveLength(1);
  });

  it("refuse le fichier si une colonne obligatoire manque", async () => {
    const { h } = await agence();
    const res = await apercu(h, "tenants", "prenom;nom\nA;B");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("telephone");
  });
});

describe("accès", () => {
  it("modèle téléchargeable : en-têtes attendus, BOM pour Excel", async () => {
    const { h } = await agence();
    const res = await request(app).get("/api/import/modele/properties").set(h);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("modele-import-biens.csv");
    expect(res.text.startsWith("﻿titre;adresse;surface;loyer")).toBe(true);
    expect((await request(app).get("/api/import/modele/inconnu").set(h)).status).toBe(400);
  });

  it("exige une session de gestionnaire", async () => {
    expect((await request(app).post("/api/import").send({ type: "tenants", csv: "a" })).status).toBe(401);
  });
});
