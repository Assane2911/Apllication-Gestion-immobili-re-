import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityLogs, agencySettings, contractCotenants, formalNotices, issueReports, messages, ownerFeeRates, owners, storedDocuments, tenants } from "../db/schema";
import {
  createContract,
  createInspection,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  createTenant,
  createTenantPortalUser,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { construireExportLocataire, construireExportProprietaire, nomFichierExport } from "./exportDonnees.service";

/**
 * Export des données d'un locataire et d'un propriétaire (RGPD art. 15 et 20) : cas limites trouvés en sabotant le service,
 * que les tests existants laissaient passer. Rien d'une autre personne dans l'export, aucun chemin de fichier ni identifiant
 * interne, tous les champs de la fiche, le responsable de traitement et le nom du fichier téléchargé.
 */
afterEach(() => {
  vi.useRealTimers();
});

const journal = (managerId: string, entityType: string, entityId: string, details: string) =>
  testDb.insert(activityLogs).values({ managerId, actorLabel: "agence", action: `${entityType}.test`, entityType, entityId, entityLabel: details, details });

describe("export d'un locataire : rien d'une autre personne", () => {
  async function agence() {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Studio Plateau" });
    const tenantA = await createTenant(manager.id, { firstName: "Awa", lastName: "Diallo" });
    const tenantB = await createTenant(manager.id, { firstName: "Moussa", lastName: "Fall" });
    const autreBien = await createProperty(manager.id, { title: "Villa Almadies" });
    const contratA = await createContract(property.id, tenantA.id);
    const contratB = await createContract(autreBien.id, tenantB.id);
    return { manager, tenantA, tenantB, contratA, contratB };
  }

  it("un locataire inconnu n'a pas d'export", async () => {
    expect(await construireExportLocataire("locataire-inconnu")).toBeNull();
  });

  it("signalements, états des lieux, mises en demeure et documents d'un autre locataire n'y figurent pas", async () => {
    const { manager, tenantA, tenantB, contratA, contratB } = await agence();
    await testDb.insert(issueReports).values([
      { contractId: contratA.id, tenantId: tenantA.id, title: "Fuite d'Awa", description: "d", photoUrl: "p.jpg" },
      { contractId: contratB.id, tenantId: tenantB.id, title: "Panne de Moussa", description: "d", photoUrl: "p.jpg" },
    ]);
    await createInspection(contratA, manager.id);
    await createInspection(contratB, manager.id);
    await testDb.insert(formalNotices).values([
      { contractId: contratA.id, managerId: manager.id, invoicesSnapshot: "[]", totalDue: 100, deadlineDays: 8 },
      { contractId: contratB.id, managerId: manager.id, invoicesSnapshot: "[]", totalDue: 999, deadlineDays: 8 },
    ]);
    await testDb.insert(storedDocuments).values([
      { managerId: manager.id, tenantId: tenantA.id, title: "Assurance d'Awa", filePath: "docs/secret-awa.pdf", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 },
      { managerId: manager.id, tenantId: tenantB.id, title: "Assurance de Moussa", filePath: "docs/secret-moussa.pdf", fileName: "b.pdf", mimeType: "application/pdf", sizeBytes: 10 },
    ]);

    const donnees = (await construireExportLocataire(tenantA.id))!;

    expect(donnees.signalements.map((s: { title: string }) => s.title)).toEqual(["Fuite d'Awa"]);
    expect(donnees.etatsDesLieux).toHaveLength(1);
    expect(donnees.etatsDesLieux[0].tenantId).toBe(tenantA.id);
    expect(donnees.misesEnDemeure).toHaveLength(1);
    expect(donnees.misesEnDemeure[0].totalDue).toBe(100);
    expect(donnees.documentsRanges.map((d: { title: string }) => d.title)).toEqual(["Assurance d'Awa"]);
  });

  it("un locataire sans bail ne reçoit que ses propres signalements", async () => {
    const { manager, tenantB, contratB } = await agence();
    const sansBail = await createTenant(manager.id, { firstName: "Sans", lastName: "Bail" });
    await testDb.insert(issueReports).values([
      { contractId: contratB.id, tenantId: tenantB.id, title: "Panne de Moussa", description: "d", photoUrl: "p.jpg" },
      { contractId: contratB.id, tenantId: sansBail.id, title: "Signalement sans bail", description: "d", photoUrl: "p.jpg" },
    ]);

    const donnees = (await construireExportLocataire(sansBail.id))!;

    expect(donnees.contrats).toEqual([]);
    expect(donnees.signalements.map((s: { title: string }) => s.title)).toEqual(["Signalement sans bail"]);
  });

  it("le fil de discussion du titulaire inclut les messages communs du bail, mais ni ceux d'un colocataire ni ceux d'un autre bail", async () => {
    const { manager, tenantA, tenantB, contratA, contratB } = await agence();
    const colocataire = await createTenant(manager.id, { firstName: "Binta", lastName: "Ba" });
    await testDb.insert(contractCotenants).values({ contractId: contratA.id, tenantId: colocataire.id });
    const message = (contractId: string, tenantId: string | null, content: string) =>
      ({ contractId, tenantId, senderId: manager.id, senderRole: "TENANT" as const, content });
    await testDb.insert(messages).values([
      message(contratA.id, null, "message commun du bail"),
      message(contratA.id, tenantA.id, "message d'Awa"),
      message(contratA.id, colocataire.id, "message de la colocataire"),
      message(contratB.id, tenantB.id, "message de Moussa"),
      message(contratB.id, tenantA.id, "message d'Awa rangé sur un autre bail"),
    ]);

    const donnees = (await construireExportLocataire(tenantA.id))!;

    expect(donnees.messages.map((m: { content: string }) => m.content).sort()).toEqual(["message commun du bail", "message d'Awa"]);
  });

  it("le journal d'activité reprend ses signalements, et seulement les siens", async () => {
    const { manager, tenantA, tenantB, contratA, contratB } = await agence();
    const [signalementA] = await testDb.insert(issueReports).values({ contractId: contratA.id, tenantId: tenantA.id, title: "A", description: "d", photoUrl: "p.jpg" }).returning();
    const [signalementB] = await testDb.insert(issueReports).values({ contractId: contratB.id, tenantId: tenantB.id, title: "B", description: "d", photoUrl: "p.jpg" }).returning();
    await journal(manager.id, "issue", signalementA.id, "signalement d'Awa");
    await journal(manager.id, "issue", signalementB.id, "signalement de Moussa");

    const donnees = (await construireExportLocataire(tenantA.id))!;

    expect(donnees.journalActivite.map((j: { details: string | null }) => j.details)).toEqual(["signalement d'Awa"]);
  });
});

describe("export d'un locataire : contenu", () => {
  it("la fiche, le bien, la qualité et le responsable de traitement sont complets ; la date est celle de l'export", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    const manager = await createManager();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port", phone: "+221338000000", address: "Rue 1, Dakar" });
    const property = await createProperty(manager.id, { title: "Studio Plateau", address: "12 rue Félix Faure", surface: 42 });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diallo", civility: "MME", phone: "+221771112233", idDocument: "pieces/awa.jpg" });
    const compte = await createTenantPortalUser(tenant);
    await testDb.update(tenants).set({ anonymizedAt: new Date("2026-11-01T00:00:00Z") }).where(eq(tenants.id, tenant.id));
    const [ligne] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    const contrat = await createContract(property.id, tenant.id);

    const donnees = (await construireExportLocataire(tenant.id))!;

    expect(donnees.exportGenereLe).toBe("2026-11-24T10:00:00.000Z");
    expect(donnees.aProposDeCetExport).toContain("articles 15 et 20 du RGPD");
    expect(donnees.responsableDuTraitement).toEqual({ agencyName: "Agence du Port", email: manager.email, telephone: "+221338000000", adresse: "Rue 1, Dakar" });
    expect(donnees.locataire).toEqual({
      id: tenant.id,
      civility: "MME",
      firstName: "Awa",
      lastName: "Diallo",
      email: tenant.email,
      phone: "+221771112233",
      pieceIdentiteDetenue: true,
      compteDePortail: true,
      anonymizedAt: new Date("2026-11-01T00:00:00Z"),
      ficheCreeeLe: ligne.createdAt,
    });
    expect(compte.id).toBeTruthy();
    expect(donnees.contrats[0]).toMatchObject({ id: contrat.id, qualite: "TITULAIRE", bien: { id: property.id, title: "Studio Plateau", address: "12 rue Félix Faure", surface: 42 } });
  });

  it("sans réglages d'agence, le responsable de traitement porte des valeurs nulles (et non absentes)", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);

    const donnees = (await construireExportLocataire(tenant.id))!;

    expect(donnees.responsableDuTraitement).toEqual({ agencyName: null, email: manager.email, telephone: null, adresse: null });
    expect(JSON.parse(JSON.stringify(donnees.responsableDuTraitement))).toHaveProperty("agencyName", null);
  });

  it("les documents rangés n'exposent ni le chemin du fichier ni le gestionnaire", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    await testDb.insert(storedDocuments).values({ managerId: manager.id, tenantId: tenant.id, title: "Assurance", filePath: "docs/secret.pdf", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 });

    const [document] = (await construireExportLocataire(tenant.id))!.documentsRanges;

    expect(document.title).toBe("Assurance");
    expect(document).not.toHaveProperty("filePath");
    expect(document).not.toHaveProperty("managerId");
  });

  it("un message vocal est signalé sans exposer le chemin de l'enregistrement, qu'il ait un chemin, une durée ou les deux", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contrat = await createContract(property.id, tenant.id);
    const message = (content: string, extra: Partial<typeof messages.$inferInsert>) => ({ contractId: contrat.id, tenantId: tenant.id, senderId: manager.id, senderRole: "TENANT" as const, content, ...extra });
    await testDb.insert(messages).values([
      message("avec chemin seul", { audioPath: "messages/secret.webm" }),
      message("avec durée seule", { audioDurationSec: 5 }),
      message("texte", {}),
    ]);

    const donnees = (await construireExportLocataire(tenant.id))!;

    const par = (contenu: string) => donnees.messages.find((m: { content: string }) => m.content === contenu)!;
    expect(par("avec chemin seul").vocal).toBe(true);
    expect(par("avec durée seule").vocal).toBe(true);
    expect(par("texte").vocal).toBe(false);
    for (const m of donnees.messages) expect(m).not.toHaveProperty("audioPath");
  });
});

describe("nomFichierExport", () => {
  it("le nom est daté, en minuscules, sans accents ni caractères spéciaux", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));

    expect(nomFichierExport({ firstName: "Éloïse", lastName: "N'Diaye Ça" })).toBe("donnees-eloise-n-diaye-ca-2026-11-24.json");
  });
});

describe("export d'un propriétaire", () => {
  it("un propriétaire inconnu n'a pas d'export", async () => {
    expect(await construireExportProprietaire("proprietaire-inconnu")).toBeNull();
  });

  it("la fiche, le responsable de traitement, la date et l'avertissement sur les locataires sont complets", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    const manager = await createManager();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port", phone: "+221338000000", address: "Rue 1, Dakar" });
    const owner = await createOwner(manager.id, {
      civility: "M",
      firstName: "Ibrahima",
      lastName: "Sow",
      companyName: "Sow Immobilier",
      email: "sow@test.local",
      phone: "+221770001122",
      address: "5 avenue Cheikh Anta Diop",
      iban: "SN08SN0100152000048500003035",
      bic: "CBAOSNDA",
      managementFeeRate: 7.5,
      notes: "Préfère le matin",
      language: "pt",
    });
    await createOwnerPortalUser(owner);
    await testDb.update(owners).set({ anonymizedAt: new Date("2026-11-01T00:00:00Z") }).where(eq(owners.id, owner.id));
    const [ligne] = await testDb.select().from(owners).where(eq(owners.id, owner.id));

    const donnees = (await construireExportProprietaire(owner.id))!;

    expect(donnees.exportGenereLe).toBe("2026-11-24T10:00:00.000Z");
    expect(donnees.aProposDeCetExport).toContain("articles 15 et 20 du RGPD");
    expect(donnees.aProposDeCetExport).toContain("Les données des locataires de vos biens ne figurent pas ici");
    expect(donnees.responsableDuTraitement).toEqual({ agencyName: "Agence du Port", email: manager.email, telephone: "+221338000000", adresse: "Rue 1, Dakar" });
    expect(donnees.proprietaire).toEqual({
      id: owner.id,
      civility: "M",
      firstName: "Ibrahima",
      lastName: "Sow",
      companyName: "Sow Immobilier",
      email: "sow@test.local",
      phone: "+221770001122",
      address: "5 avenue Cheikh Anta Diop",
      iban: "SN08SN0100152000048500003035",
      bic: "CBAOSNDA",
      managementFeeRate: 7.5,
      notes: "Préfère le matin",
      language: "pt",
      compteDePortail: true,
      anonymizedAt: new Date("2026-11-01T00:00:00Z"),
      ficheCreeeLe: ligne.createdAt,
    });
  });

  it("sans réglages d'agence, le responsable de traitement porte des valeurs nulles", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);

    const donnees = (await construireExportProprietaire(owner.id))!;

    expect(donnees.responsableDuTraitement).toEqual({ agencyName: null, email: manager.email, telephone: null, adresse: null });
  });

  it("le taux de commission et le journal d'un autre propriétaire n'y figurent pas", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { firstName: "Fatou", lastName: "Diop" });
    const autre = await createOwner(manager.id, { firstName: "Moussa", lastName: "Sy" });
    await testDb.insert(ownerFeeRates).values([
      { ownerId: owner.id, effectiveYear: 2026, effectiveMonth: 1, rate: 8 },
      { ownerId: autre.id, effectiveYear: 2026, effectiveMonth: 1, rate: 12 },
    ]);
    await journal(manager.id, "owner", owner.id, "fiche de Fatou");
    await journal(manager.id, "owner", autre.id, "fiche de Moussa");

    const donnees = (await construireExportProprietaire(owner.id))!;

    expect(donnees.historiqueDuTauxDeCommission.map((t: { rate: number }) => t.rate)).toEqual([8]);
    expect(donnees.journalActivite.map((j: { details: string | null }) => j.details)).toEqual(["fiche de Fatou"]);
  });
});
