import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs } from "../db/schema";
import * as importService from "../services/import.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { MAX_CARACTERES_IMPORT } from "../utils/csvImport";

/**
 * Audit par sabotage de import.controller.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les lacunes : la validation du corps (fichier vide, trop gros : le CODE renvoyé), la formule effective pendant l'essai gratuit
 * (Pro, comme à la création à la main), la devise par défaut, le code et les valeurs d'une erreur de format, une panne qui ne doit
 * pas être déguisée en réponse vide, le détail du journal et les en-têtes du modèle téléchargé.
 */

afterEach(() => vi.restoreAllMocks());

async function agence(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", ...overrides });
  return { manager, h: authHeader(tokenFor(manager)) };
}
const apercu = (h: Record<string, string>, type: string, csv: string) => request(app).post("/api/import/preview").set(h).send({ type, csv });
const importer = (h: Record<string, string>, type: string, csv: string) => request(app).post("/api/import").set(h).send({ type, csv });
const journal = (managerId: string, action: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));

const LIGNE = (i: number) => `Bien ${i};${i} rue du Port;28;250000`;
const CSV = (n: number) => ["Titre;Adresse;Surface;Loyer", ...Array.from({ length: n }, (_, i) => LIGNE(i + 1))].join("\n");

describe("validation du corps", () => {
  it("un fichier vide est refusé par la validation (son code), pas par la lecture du CSV", async () => {
    const { h } = await agence();

    const res = await apercu(h, "properties", "");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR_FIELD");
    expect(res.body.params).toEqual({ fields: "csv" });
  });

  it("un fichier d'un caractère de plus que le maximum est refusé par la validation (son code)", async () => {
    const { h } = await agence();

    const res = await apercu(h, "properties", "x".repeat(MAX_CARACTERES_IMPORT + 1));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR_FIELD");
  });
});

describe("plafond de biens : la formule effective", () => {
  it("pendant l'essai gratuit, la formule effective est Pro (25 biens), pas la formule Starter attribuée à l'inscription", async () => {
    const { h } = await agence({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER", trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) });

    const res = await apercu(h, "properties", CSV(6));

    expect(res.status).toBe(200);
    expect(res.body.capacite.maximum).toBe(25);
    expect(res.body.resume).toEqual({ total: 6, valides: 6, doublons: 0, erreurs: 0 });
  });

  it("hors essai, c'est la formule du compte : Starter limite à 5 biens", async () => {
    const { h } = await agence({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });

    const res = await apercu(h, "properties", CSV(6));

    expect(res.body.capacite.maximum).toBe(5);
    expect(res.body.resume.valides).toBe(5);
    expect(res.body.lignes[5].details[0].code).toBe("IMPORT_ROW_PLAN_LIMIT");
  });

  it("un bien sans colonne « devise » prend la devise du gestionnaire, ou l'euro si elle est vide", async () => {
    const xof = await agence({ currency: "XOF" });
    const vide = await agence({ currency: "" });

    expect((await apercu(xof.h, "properties", CSV(1))).body.lignes[0].donnees.currency).toBe("XOF");
    expect((await apercu(vide.h, "properties", CSV(1))).body.lignes[0].donnees.currency).toBe("EUR");
  });
});

describe("erreurs de format et pannes", () => {
  it("un fichier auquel il manque des colonnes répond 400 avec son code et la liste des colonnes", async () => {
    const { h } = await agence();

    const res = await apercu(h, "properties", "Titre;Adresse\nStudio;1 rue X");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IMPORT_MISSING_COLUMNS");
    expect(res.body.params).toEqual({ columns: "« surface » (ou superficie, m2) ; « loyer » (ou rent, loyermensuel)" });
  });

  it("une panne de l'analyse n'est pas déguisée en réponse vide : elle reste une erreur serveur", async () => {
    const { h } = await agence();
    vi.spyOn(importService, "analyserBiens").mockRejectedValue(new Error("base indisponible"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await apercu(h, "properties", CSV(1));

    expect(res.status).toBe(500);
  });
});

describe("journal de l'import", () => {
  it("garde le type d'entité, le libellé et le détail : lignes écrites, doublons et erreurs", async () => {
    const { manager, h } = await agence();
    const csv = ["Titre;Adresse;Surface;Loyer", LIGNE(1), LIGNE(1), "Sans surface;2 rue Y;;100"].join("\n");

    const res = await importer(h, "properties", csv);
    expect(res.status).toBe(201);

    const [ligne] = await journal(manager.id, "import.properties");
    expect(ligne.entityType).toBe("import");
    expect(ligne.entityLabel).toBe("Import CSV de biens");
    expect(ligne.details).toBe("1 biens importé(s) sur 3 ligne(s) (1 doublon(s), 1 erreur(s)).");
  });

  it("l'import de locataires porte son propre libellé", async () => {
    const { manager, h } = await agence();

    await importer(h, "tenants", "Prenom;Nom;Telephone;Email\nMoussa;Diop;+221 77 123 45 67;moussa@example.com");

    const [ligne] = await journal(manager.id, "import.tenants");
    expect(ligne.entityLabel).toBe("Import CSV de locataires");
    expect(ligne.details).toBe("1 locataires importé(s) sur 1 ligne(s) (0 doublon(s), 0 erreur(s)).");
  });
});

describe("modèle CSV téléchargeable", () => {
  it.each([
    ["properties", "modele-import-biens.csv"],
    ["tenants", "modele-import-locataires.csv"],
    ["contracts", "modele-import-contrats.csv"],
  ])("le modèle %s est servi en pièce jointe, en UTF-8, sous le nom %s", async (type, nom) => {
    const { h } = await agence();

    const res = await request(app).get(`/api/import/modele/${type}`).set(h);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${nom}"`);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
  });
});
