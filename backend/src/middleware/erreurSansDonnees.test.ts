import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { masquerDonneesSensibles } from "../instrument";
import { logActivity } from "../services/activity.service";
import { erreurSansDonnees, masquerValeursSql, masquerValeursSqlDansJson } from "../utils/erreurSansDonnees";
import { testDb } from "../test/setupTestDb";
import { errorHandler } from "./errorHandler";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  captureException: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

const EMAIL = "awa.sow@exemple.sn";
const TELEPHONE = "+221771234567";
const EMPREINTE = "$2a$12$empreinteDeMotDePasseSecrete";

/** Le message d'une vraie erreur Drizzle : la requête, puis la ligne `params:` avec les valeurs écrites. */
function erreurDeBase(): Error {
  const err = new Error(
    `Failed query: insert into "tenants" ("id", "email", "phone") values ($1, $2, $3)\nparams: id_42,${EMAIL},${TELEPHONE},${EMPREINTE}`
  );
  (err as Error & { cause?: unknown }).cause = new Error(`duplicate key value violates unique constraint — Key (email)=(${EMAIL}) already exists.`);
  return err;
}

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

/** Tout ce qu'un appel à console.error a écrit, message, trace et cause comprises. */
function texteJournalise(appels: unknown[][]): string {
  const morceaux: string[] = [];
  const voir = (valeur: unknown, profondeur = 0) => {
    if (profondeur > 5) return;
    if (valeur instanceof Error) {
      morceaux.push(valeur.message, valeur.stack ?? "");
      voir((valeur as Error & { cause?: unknown }).cause, profondeur + 1);
    } else {
      morceaux.push(String(valeur));
    }
  };
  for (const appel of appels) for (const argument of appel) voir(argument);
  return morceaux.join("\n");
}

describe("Les valeurs d'une requête en échec n'entrent ni dans les journaux ni dans Sentry", () => {
  it("errorHandler : une erreur de base répond 500 générique et journalise la requête SANS ses valeurs", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = fakeRes();

    await errorHandler(erreurDeBase(), { method: "POST", path: "/api/tenants" } as Request, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
    const ecrit = texteJournalise(journal.mock.calls);
    expect(ecrit).toContain('insert into "tenants"');
    for (const donnee of [EMAIL, TELEPHONE, EMPREINTE]) expect(ecrit).not.toContain(donnee);
  });

  it("le journal d'activité : un échec d'écriture ne journalise pas les valeurs (noms, détails) de la ligne", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(testDb, "insert").mockImplementation((() => {
      throw erreurDeBase();
    }) as never);

    await logActivity({ managerId: "m1", action: "tenant.create", entityType: "tenant", entityLabel: "Awa Sow", details: `Locataire créé : ${EMAIL}` });

    const ecrit = texteJournalise(journal.mock.calls);
    expect(ecrit).toContain("Échec de l'enregistrement du journal d'activité");
    for (const donnee of [EMAIL, TELEPHONE, EMPREINTE]) expect(ecrit).not.toContain(donnee);
  });

  it("masquerValeursSql : garde la requête, masque les valeurs et celle d'une contrainte violée", () => {
    const sortie = masquerValeursSql(String(erreurDeBase().message) + `\nKey (email)=(${EMAIL}) already exists.`);
    expect(sortie).toContain('insert into "tenants"');
    expect(sortie).toContain("params: [valeurs masquées]");
    expect(sortie).toContain("Key (email)=([masqué]) already exists.");
    for (const donnee of [EMAIL, TELEPHONE, EMPREINTE]) expect(sortie).not.toContain(donnee);
  });

  it("masquerValeursSqlDansJson : masque dans un événement Sentry sérialisé, sans casser le JSON ni les champs voisins", () => {
    const evenement = {
      exception: { values: [{ type: "Error", value: erreurDeBase().message }] },
      request: { url: "https://api.exemple.sn/api/tenants", method: "POST" },
      tags: { source: "cron" },
    };

    const sortie = JSON.parse(masquerValeursSqlDansJson(JSON.stringify(evenement)));

    expect(sortie.exception.values[0].value).toContain('insert into "tenants"');
    expect(sortie.exception.values[0].value).toContain("params: [valeurs masquées]");
    expect(JSON.stringify(sortie)).not.toContain(EMAIL);
    expect(sortie.request).toEqual(evenement.request);
    expect(sortie.tags).toEqual(evenement.tags);
  });

  it("Sentry : un événement perd les valeurs de la requête ET le jeton d'agenda, et garde le reste", () => {
    const jeton = "abcdefghijklmnopqrstuvwx0123456789";
    const evenement = {
      exception: { values: [{ type: "Error", value: erreurDeBase().message }] },
      request: { url: `https://api.exemple.sn/api/agenda/ics/${jeton}.ics`, method: "GET" },
    };

    const sortie = JSON.stringify(masquerDonneesSensibles(evenement));

    for (const donnee of [EMAIL, TELEPHONE, EMPREINTE, jeton]) expect(sortie).not.toContain(donnee);
    expect(sortie).toContain('insert into \\"tenants\\"');
    expect(sortie).toContain("/agenda/ics/[masqué]");
  });

  it("erreurSansDonnees : n'altère pas l'erreur d'origine et rend tel quel ce qui n'est pas une erreur", () => {
    const origine = erreurDeBase();
    const copie = erreurSansDonnees(origine) as Error;

    expect(copie).not.toBe(origine);
    expect(origine.message).toContain(EMAIL);
    expect(copie.message).not.toContain(EMAIL);
    expect(erreurSansDonnees("texte")).toBe("texte");
    expect(erreurSansDonnees(undefined)).toBeUndefined();
  });
});
