import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { owners } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createOwner, createProperty, createTenant, tokenFor, tokenProprietaire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import type { Langue } from "../utils/langue";
import { type CrgExportData, generateCrgHtml } from "./pdf.service";

/**
 * Lot 3A : le compte-rendu de gestion (CRG) est écrit à l'attention du propriétaire, dans SA langue. Les autres
 * documents générés (quittance, bail, état des lieux, avenant, mise en demeure) restent en français : ce sont des
 * écrits à portée juridique.
 */
const LANGUES: Langue[] = ["fr", "en", "es", "pt"];
const AUTRES: Array<"en" | "es" | "pt"> = ["en", "es", "pt"];
const MOTS_FRANCAIS =
  /\b(COMPTE-RENDU|Compte-Rendu|Compte-rendu|Période|Propriétaire|Détail|Bien|Loyers|Reversements?|reverser|Versé|Reste|Coordonnées|bancaires|Aucun|Aucune|généré|valeur informative|établi|Taux|Moyen|Montant|Agence|Mandataire)\b/;
const texteDe = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const crg: CrgExportData = {
  agencyName: "<i>Teranga</i> Immo",
  ownerName: "Fatou <b>Diop</b>",
  ownerCompanyName: "SCI <u>Diop</u>",
  iban: "FR7630006000011234567890189",
  bic: "AGRIFRPP",
  managementFeeRate: 10,
  month: 6,
  year: 2026,
  properties: [{ propertyId: "p1", propertyTitle: "Villa <b>Ngor</b>", currency: "XOF", loyersEncaisses: 250000, chargesDeduites: 1234.5, commission: 25000, netAReverser: 223765.5 }],
  totalLoyersByCurrency: { XOF: 250000 },
  totalChargesByCurrency: { XOF: 1234.5 },
  totalCommissionByCurrency: { XOF: 25000 },
  totalNetByCurrency: { XOF: 223765.5 },
  reversements: [{ currency: "XOF", amount: 100000, paidAt: new Date(Date.UTC(2026, 6, 5, 12)), method: "BANK_TRANSFER", reference: "VIR-<b>1</b>" }],
  resteAReverserByCurrency: { XOF: 123765.5 },
};
const vide: CrgExportData = { ...crg, iban: null, bic: null, ownerCompanyName: null, properties: [], totalLoyersByCurrency: {}, totalChargesByCurrency: {}, totalCommissionByCurrency: {}, totalNetByCurrency: {}, reversements: [], resteAReverserByCurrency: { XOF: -500 } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 6, 10, 12)));
});
afterEach(() => vi.useRealTimers());

describe("generateCrgHtml — langue du propriétaire", () => {
  it("sans langue, ou en français : le document d'avant", () => {
    const html = generateCrgHtml(crg);
    expect(generateCrgHtml({ ...crg, langue: "fr" })).toBe(html);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("COMPTE-RENDU DE GESTION");
    expect(html).toContain("Période : Juin 2026");
    expect(html).toContain("Taux de commission :</strong> 10 %");
    expect(html).toContain("Document généré le 10 juillet 2026");
    expect(html).toContain("Reste à reverser (XOF)");
    expect(html).toContain("Virement");
  });

  it.each(AUTRES)("en %s : tout est traduit, sans reste de français", (langue) => {
    const html = generateCrgHtml({ ...crg, langue });
    expect(html).toContain(`<html lang="${langue}">`);
    expect(texteDe(html)).not.toMatch(MOTS_FRANCAIS);
  });

  it.each(AUTRES)("en %s : les états vides sont traduits aussi (aucun bien, aucun reversement, aucune coordonnée, versé en trop)", (langue) => {
    const html = generateCrgHtml({ ...vide, langue });
    expect(texteDe(html)).not.toMatch(MOTS_FRANCAIS);
    expect(texteDe(html)).not.toMatch(/\bAucun/);
  });

  it("chaque langue donne un document différent des autres", () => {
    expect(new Set(LANGUES.map((l) => generateCrgHtml({ ...crg, langue: l }))).size).toBe(4);
    expect(new Set(LANGUES.map((l) => generateCrgHtml({ ...vide, langue: l }))).size).toBe(4);
  });

  it("la période, la date de génération, le taux, les montants et les moyens suivent la langue", () => {
    const en = texteDe(generateCrgHtml({ ...crg, langue: "en" }));
    expect(en).toContain("Period: June 2026");
    expect(en).toContain("Document generated on July 10, 2026");
    expect(en).toContain("10%");
    expect(en).toContain("250,000 FCFA");
    expect(en).toContain("Bank transfer");
    const es = texteDe(generateCrgHtml({ ...crg, langue: "es" }));
    expect(es).toContain("Período: Junio 2026");
    expect(es).toContain("10 de julio de 2026");
    expect(es).toContain("250.000 FCFA");
    expect(es).toContain("Transferencia");
    const pt = texteDe(generateCrgHtml({ ...crg, langue: "pt" }));
    expect(pt).toContain("Período: Junho 2026");
    expect(pt).toContain("10 de julho de 2026");
    expect(pt).toContain("Transferência");
  });

  it("le titre du document est traduit aussi (onglet du navigateur, nom de fichier à l'enregistrement)", () => {
    expect(generateCrgHtml({ ...crg, langue: "en" })).toMatch(/<title>Management Report - June 2026 - Fatou/);
    expect(generateCrgHtml({ ...crg, langue: "es" })).toMatch(/<title>Informe de gestión - Junio 2026/);
    expect(generateCrgHtml({ ...crg, langue: "pt" })).toMatch(/<title>Relatório de gestão - Junho 2026/);
  });

  it("le versé en trop et le reste à reverser changent de libellé selon le signe", () => {
    expect(texteDe(generateCrgHtml({ ...vide, langue: "en" }))).toContain("Overpaid (XOF)");
    expect(texteDe(generateCrgHtml({ ...crg, langue: "en" }))).toContain("Remaining to be paid (XOF)");
    expect(texteDe(generateCrgHtml({ ...vide }))).toContain("Versé en trop (XOF)");
  });

  it("les valeurs saisies restent échappées, dans toutes les langues", () => {
    for (const l of LANGUES) {
      const html = generateCrgHtml({ ...crg, langue: l });
      for (const brut of ["<i>Teranga</i>", "<b>Diop</b>", "<u>Diop</u>", "<b>Ngor</b>", "<b>1</b>"]) expect(html).not.toContain(brut);
    }
  });

  it("l'IBAN et le BIC sont conservés tels quels", () => {
    for (const l of LANGUES) expect(generateCrgHtml({ ...crg, langue: l })).toContain("FR7630006000011234567890189");
  });
});

describe("exports du CRG — langue du propriétaire", () => {
  async function agence(langue: string | null) {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const owner = await createOwner(manager.id, { managementFeeRate: 10, email: "proprio@test.local" });
    await testDb.update(owners).set({ language: langue }).where(eq(owners.id, owner.id));
    const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { periodMonth: 9, amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });
    return { manager, owner, h: authHeader(tokenFor(manager)) };
  }

  it("l'export du gestionnaire est dans la langue du propriétaire, quelle que soit la sienne", async () => {
    const { owner, h } = await agence("pt");
    const res = await request(app).get(`/api/crg/${owner.id}/export?month=9&year=2026`).set(h).set("Accept-Language", "en");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="pt">');
    expect(res.text).toContain("RELATÓRIO DE GESTÃO");
  });

  it("l'export du propriétaire, depuis son espace, aussi", async () => {
    const { owner } = await agence("es");
    const hProprio = authHeader(await tokenProprietaire(owner));
    const res = await request(app).get("/api/crg/mine/export?month=9&year=2026").set(hProprio);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain("INFORME DE GESTIÓN");
  });

  it("sans langue sur la fiche (d'avant), en français comme avant", async () => {
    const { owner, h } = await agence(null);
    const res = await request(app).get(`/api/crg/${owner.id}/export?month=9&year=2026`).set(h).set("Accept-Language", "en");
    expect(res.text).toContain('<html lang="fr">');
    expect(res.text).toContain("COMPTE-RENDU DE GESTION");
  });
});
