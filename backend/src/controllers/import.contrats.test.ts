import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices, properties } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Import CSV de contrats : un bail déjà en cours chez le cabinet doit arriver SANS
 * ses loyers passés. Le cron quotidien régénère les factures de tous les contrats
 * actifs depuis le début du bail : sans date « facturer à partir de », un bail
 * de 2023 produirait des dizaines de factures en retard et des relances à des
 * locataires à jour.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const studio = await createProperty(manager.id, { title: "Studio Centre-ville", address: "12 rue des Écoles", currency: "XOF" });
  const villa = await createProperty(manager.id, { title: "Villa B", address: "3 avenue Ndiaye" });
  const moussa = await createTenant(manager.id, { email: "moussa.diop@example.com" });
  const awa = await createTenant(manager.id, { email: "awa@example.com" });
  return { manager, h: authHeader(tokenFor(manager)), studio, villa, moussa, awa };
}

const apercu = (h: Record<string, string>, csv: string) => request(app).post("/api/import/preview").set(h).send({ type: "contracts", csv });
const importer = (h: Record<string, string>, csv: string) => request(app).post("/api/import").set(h).send({ type: "contracts", csv });
type Contrat = typeof contracts.$inferSelect;
type Facture = typeof invoices.$inferSelect;
const contratsDe = async (managerId: string): Promise<Contrat[]> =>
  (await testDb.select({ c: contracts }).from(contracts).innerJoin(properties, eq(contracts.propertyId, properties.id)).where(eq(properties.managerId, managerId))).map(
    (r: { c: Contrat }) => r.c
  );
const factures = (contractId: string): Promise<Facture[]> => testDb.select().from(invoices).where(eq(invoices.contractId, contractId));

const ENTETE = "bien;email_locataire;loyer;depot;debut;fin;jour_echeance;type_de_bail;droit_applicable;statut;facturation_depuis";

describe("import de contrats — aperçu", () => {
  it("rapproche le bien par son titre et le locataire par son email, lit dates et nombres français", async () => {
    const { manager, h, studio, moussa } = await agence();
    const res = await apercu(h, [ENTETE, "studio centre-ville;MOUSSA.DIOP@example.com;250 000;500 000;01/03/2024;28/02/2027;20;meublé;Droit sénégalais;actif;"].join("\r\n"));

    expect(res.status).toBe(200);
    expect(res.body.resume).toEqual({ total: 1, valides: 1, doublons: 0, erreurs: 0 });
    expect(res.body.lignes[0].donnees).toMatchObject({
      propertyId: studio.id, tenantId: moussa.id, rent: 250000, deposit: 500000, currency: "XOF",
      startDate: "2024-03-01", endDate: "2027-02-28", paymentDay: 20, leaseType: "MEUBLE", applicableLaw: "Droit sénégalais", status: "ACTIVE",
      // Le passé n'est pas facturé : la première facture est celle du mois courant (échéance le 20, pas encore passée).
      billingFrom: "2026-10-01", premiereFacture: "10/2026",
    });
    expect(await contratsDe(manager.id)).toHaveLength(0);
  });

  it("explique chaque refus : bien ou locataire introuvable, dates, montants, jour, type, statut", async () => {
    const { h } = await agence();
    const res = await apercu(
      h,
      [
        ENTETE,
        "Inconnu;moussa.diop@example.com;100;0;01/01/2025;01/01/2026;;;;;",
        "Villa B;nobody@example.com;100;0;01/01/2025;01/01/2026;;;;;",
        "Villa B;awa@example.com;abc;;31/02/2025;01/01/2026;40;cabane;;fini?;",
        "Villa B;awa@example.com;100;0;01/06/2025;01/01/2025;;;;;",
      ].join("\n")
    );
    const [a, b, c, d] = res.body.lignes.map((l: { messages: string[] }) => l.messages.join(" | "));
    expect(a).toContain("Bien introuvable : « Inconnu »");
    expect(b).toContain("Locataire introuvable : « nobody@example.com »");
    for (const attendu of ["Loyer invalide", "Dépôt de garantie manquant", "Date de début invalide", "Jour d'échéance invalide", "Type de bail inconnu", "Statut inconnu"]) {
      expect(c).toContain(attendu);
    }
    expect(d).toContain("postérieure");
    expect(res.body.resume.erreurs).toBe(4);
  });

  it("refuse deux biens de même titre sauf si l'adresse les distingue", async () => {
    const { manager, h } = await agence();
    await createProperty(manager.id, { title: "Villa B", address: "99 autre rue" });
    const sans = await apercu(h, "bien;email;loyer;depot;debut;fin\nVilla B;awa@example.com;100;0;01/01/2026;01/01/2027");
    expect(sans.body.lignes[0].messages.join(" ")).toContain("Plusieurs biens portent le titre");
    const avec = await apercu(h, "bien;adresse_bien;email;loyer;depot;debut;fin\nVilla B;99 AUTRE rue;awa@example.com;100;0;01/01/2026;01/01/2027");
    expect(avec.body.lignes[0].statut).toBe("OK");
  });

  it("repère un contrat déjà saisi (doublon) et deux baux actifs qui se chevauchent sur un bien", async () => {
    const { manager, h, villa, moussa } = await agence();
    await createContract(villa.id, moussa.id, { startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2027-01-01T00:00:00Z") });
    const res = await apercu(
      h,
      [
        "bien;email;loyer;depot;debut;fin",
        "Villa B;moussa.diop@example.com;500;0;01/01/2026;01/01/2027",
        "Villa B;awa@example.com;500;0;01/06/2026;01/06/2027",
        "Studio Centre-ville;awa@example.com;500;0;01/01/2026;01/01/2027",
        "Studio Centre-ville;moussa.diop@example.com;500;0;01/06/2026;01/06/2027",
      ].join("\n")
    );
    expect(res.body.lignes.map((l: { statut: string }) => l.statut)).toEqual(["DOUBLON", "ERREUR", "OK", "ERREUR"]);
    expect(res.body.lignes[1].messages.join(" ")).toContain("contrat actif sur cette période");
    expect(res.body.lignes[1].details).toEqual([{ code: "IMPORT_ROW_CONTRACT_OVERLAP" }]);
    expect(res.body.lignes[0].details).toEqual([{ code: "IMPORT_ROW_CONTRACT_DUPLICATE" }]);
    expect(await contratsDe(manager.id)).toHaveLength(1);
  });

  it("refuse le fichier si une colonne obligatoire manque", async () => {
    const { h } = await agence();
    const res = await apercu(h, "bien;email;loyer\nVilla B;awa@example.com;100");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Colonnes manquantes");
  });
});

describe("import de contrats — écriture", () => {
  it("crée le bail sans facturer son passé : la première facture est celle du mois courant", async () => {
    const { manager, h, studio } = await agence();
    const res = await importer(h, [ENTETE, "Studio Centre-ville;moussa.diop@example.com;250000;500000;01/03/2023;28/02/2027;20;;;;"].join("\n"));

    expect(res.status).toBe(201);
    expect(res.body.importees).toBe(1);
    const [contrat] = await contratsDe(manager.id);
    expect(contrat).toMatchObject({ rent: 250000, deposit: 500000, currency: "XOF", paymentDay: 20, leaseType: "HABITATION", status: "ACTIVE" });
    expect(contrat.billingFrom?.toISOString()).toBe("2026-10-01T00:00:00.000Z");

    // 43 mois écoulés depuis mars 2023 : AUCUN n'est facturé, seul octobre 2026 l'est.
    const fact = await factures(contrat.id);
    expect(fact.map((f) => `${f.periodMonth}/${f.periodYear}`)).toEqual(["10/2026"]);
    expect(fact[0].amount).toBe(250000);
    expect(fact[0].status).toBe("PENDING");
    const [bien] = await testDb.select().from(properties).where(eq(properties.id, studio.id));
    expect(bien.status).toBe("OCCUPIED");
  });

  it("échéance du mois déjà passée : le mois en cours n'est pas facturé (sinon il naîtrait en retard et déclencherait une relance)", async () => {
    const { manager, h } = await agence();
    // Aujourd'hui, le 12 : l'échéance du 5 est passée.
    const apercuRes = await apercu(h, `${ENTETE}\nStudio Centre-ville;moussa.diop@example.com;250000;0;01/03/2023;28/02/2027;5;;;;`);
    expect(apercuRes.body.lignes[0].donnees).toMatchObject({ billingFrom: "2026-11-01", premiereFacture: "11/2026" });

    await importer(h, `${ENTETE}\nStudio Centre-ville;moussa.diop@example.com;250000;0;01/03/2023;28/02/2027;5;;;;`);
    const [contrat] = await contratsDe(manager.id);
    expect(await factures(contrat.id)).toHaveLength(0);
    // « facturation_depuis » permet de le facturer quand même : il sera alors en retard, à la demande du gestionnaire.
    await importer(h, `${ENTETE}\nVilla B;awa@example.com;400;0;01/03/2023;28/02/2027;5;;;;01/10/2026`);
    const autre = (await contratsDe(manager.id)).find((c) => c.rent === 400)!;
    expect((await factures(autre.id)).map((f) => f.status)).toEqual(["LATE"]);
  });

  it("la génération quotidienne ne rattrape pas non plus le passé d'un bail importé", async () => {
    const { manager, h } = await agence();
    await importer(h, `${ENTETE}\nVilla B;awa@example.com;400;0;01/01/2024;01/01/2028;20;;;;`);
    const [contrat] = await contratsDe(manager.id);
    const { generateInvoicesForContract } = await import("../services/invoice.service");
    expect(await generateInvoicesForContract(contrat)).toEqual([]);
    expect(await factures(contrat.id)).toHaveLength(1);
  });

  it("« facturation depuis » choisit le premier mois facturé (ici le mois prochain)", async () => {
    const { manager, h } = await agence();
    await importer(h, `${ENTETE}\nVilla B;awa@example.com;400;0;01/01/2024;01/01/2028;;;;;01/11/2026`);
    const [contrat] = await contratsDe(manager.id);
    expect(await factures(contrat.id)).toHaveLength(0);
    expect(contrat.billingFrom?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("un bail qui n'a pas encore commencé est facturé dès son début, pas avant", async () => {
    const { manager, h } = await agence();
    const csv = "bien;email;loyer;depot;debut;fin\nVilla B;awa@example.com;400;0;01/12/2026;01/12/2027";
    expect((await apercu(h, csv)).body.lignes[0].donnees.premiereFacture).toBe("12/2026");
    await importer(h, csv);
    const [contrat] = await contratsDe(manager.id);
    expect(await factures(contrat.id)).toHaveLength(0);

    vi.setSystemTime(new Date("2026-12-01T09:00:00Z"));
    const { generateInvoicesForContract } = await import("../services/invoice.service");
    await generateInvoicesForContract(contrat);
    expect((await factures(contrat.id)).map((f) => `${f.periodMonth}/${f.periodYear}`)).toEqual(["12/2026"]);
  });

  it("un bail terminé s'enregistre sans facture et ne marque pas le bien occupé", async () => {
    const { manager, h, villa } = await agence();
    await importer(h, `${ENTETE}\nVilla B;awa@example.com;400;0;01/01/2023;01/01/2024;;;;terminé;`);
    const [contrat] = await contratsDe(manager.id);
    expect(contrat.status).toBe("ENDED");
    expect(await factures(contrat.id)).toHaveLength(0);
    const [bien] = await testDb.select().from(properties).where(eq(properties.id, villa.id));
    expect(bien.status).not.toBe("OCCUPIED");
  });

  it("importé deux fois, le même fichier ne crée rien la seconde fois", async () => {
    const { manager, h } = await agence();
    const csv = "bien;email;loyer;depot;debut;fin\nVilla B;awa@example.com;400;0;01/01/2026;01/01/2027";
    expect((await importer(h, csv)).body.importees).toBe(1);
    const second = await importer(h, csv);
    expect(second.body.importees).toBe(0);
    expect(second.body.resume.doublons).toBe(1);
    expect(await contratsDe(manager.id)).toHaveLength(1);
  });

  it("n'écrit que les lignes valides", async () => {
    const { manager, h } = await agence();
    const res = await importer(h, "bien;email;loyer;depot;debut;fin\nVilla B;awa@example.com;400;0;01/01/2026;01/01/2027\nVilla B;inconnu@x.com;400;0;01/01/2026;01/01/2027");
    expect(res.body.importees).toBe(1);
    expect(res.body.resume).toMatchObject({ valides: 1, erreurs: 1 });
    expect(await contratsDe(manager.id)).toHaveLength(1);
  });

  it("isole les agences : un bien ou un locataire d'une autre agence reste introuvable", async () => {
    const { h } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE" });
    await createProperty(autre.id, { title: "Bien Secret", address: "ailleurs" });
    await createTenant(autre.id, { email: "autre@example.com" });
    const res = await apercu(h, "bien;email;loyer;depot;debut;fin\nBien Secret;awa@example.com;1;0;01/01/2026;01/01/2027\nVilla B;autre@example.com;1;0;01/01/2026;01/01/2027");
    expect(res.body.resume.erreurs).toBe(2);
    expect(res.body.lignes[0].messages.join(" ")).toContain("Bien introuvable");
    expect(res.body.lignes[0].details[0].code).toBe("IMPORT_ROW_PROPERTY_NOT_FOUND");
    expect(res.body.lignes[0].details[0].params).toHaveProperty("title");
    expect(res.body.lignes[1].messages.join(" ")).toContain("Locataire introuvable");
  });

  it("le modèle de contrats est téléchargeable avec ses en-têtes", async () => {
    const { h } = await agence();
    const res = await request(app).get("/api/import/modele/contracts").set(h);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("modele-import-contrats.csv");
    expect(res.text.startsWith("﻿bien;email_locataire;loyer;depot;debut;fin")).toBe(true);
  });
});
