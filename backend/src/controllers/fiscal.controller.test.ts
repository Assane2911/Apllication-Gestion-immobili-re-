import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, expenses } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/fiscal/synthese", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026, "aujourd'hui" de la session
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calcule la synthèse annuelle scopée au gestionnaire connecté, sans fuite d'une autre agence", async () => {
    const managerA = await createManager();
    const propertyA = await createProperty(managerA.id, { title: "Villa Ngor" });
    const tenantA = await createTenant(managerA.id);
    const contractA = await createContract(propertyA.id, tenantA.id);
    await createInvoice(contractA.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await createInvoice(contractA.id, {
      amount: 500,
      periodMonth: 4,
      status: "PAID",
      paidAt: new Date(2026, 3, 5),
    });
    await testDb
      .insert(expenses)
      .values({ propertyId: propertyA.id, category: "TAX", title: "Taxe foncière", amount: 150, expenseDate: new Date(2026, 2, 10) });

    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id);
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 9000, status: "PAID", paidAt: new Date(2026, 2, 5) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 1000 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 150 });
    expect(res.body.netResultByCurrency).toEqual({ EUR: 850 });
    expect(res.body.revenueByMonth["2026-03"]).toEqual({ EUR: 500 });
    expect(res.body.revenueByMonth["2026-04"]).toEqual({ EUR: 500 });
    expect(res.body.expensesByMonth["2026-03"]).toEqual({ EUR: 150 });
    expect(res.body.expensesByCategory).toEqual({ TAX: { EUR: 150 } });
    expect(res.body.bilanParBien).toEqual([
      { propertyId: propertyA.id, propertyTitle: "Villa Ngor", currency: "EUR", revenue: 1000, expense: 150, net: 850 },
    ]);
  });

  it("ne mélange pas les devises entre deux biens réglés dans des devises différentes", async () => {
    const manager = await createManager();

    const propertyEur = await createProperty(manager.id, { currency: "EUR" });
    const tenantEur = await createTenant(manager.id);
    const contractEur = await createContract(propertyEur.id, tenantEur.id, { currency: "EUR" });
    await createInvoice(contractEur.id, { amount: 1500, currency: "EUR", status: "PAID", paidAt: new Date(2026, 4, 5) });
    await testDb.insert(expenses).values({
      propertyId: propertyEur.id,
      category: "MAINTENANCE",
      title: "Plomberie",
      amount: 100,
      currency: "EUR",
      expenseDate: new Date(2026, 4, 10),
    });

    const propertyXof = await createProperty(manager.id, { currency: "XOF" });
    const tenantXof = await createTenant(manager.id);
    const contractXof = await createContract(propertyXof.id, tenantXof.id, { currency: "XOF" });
    await createInvoice(contractXof.id, { amount: 500000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 4, 5) });
    await testDb.insert(expenses).values({
      propertyId: propertyXof.id,
      category: "MAINTENANCE",
      title: "Peinture",
      amount: 50000,
      currency: "XOF",
      expenseDate: new Date(2026, 4, 10),
    });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 1500, XOF: 500000 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 100, XOF: 50000 });
    expect(res.body.netResultByCurrency).toEqual({ EUR: 1400, XOF: 450000 });
    expect(res.body.bilanParBien).toHaveLength(2);
  });

  it("exclut les factures et dépenses d'une autre année que celle demandée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // Encaissé en 2025, ne doit pas apparaître dans la synthèse 2026.
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2025, 11, 20) });
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, category: "MAINTENANCE", title: "Travaux 2025", amount: 80, expenseDate: new Date(2025, 11, 15) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({});
    expect(res.body.totalExpensesByCurrency).toEqual({});
    expect(res.body.bilanParBien).toEqual([]);
  });

  it("utilise l'année en cours par défaut quand ?year n'est pas fourni", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // "Aujourd'hui" est le 20 septembre 2026 (system time simulé ci-dessus).
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 8, 15) });

    const res = await request(app).get("/api/fiscal/synthese").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 500 });
  });

  it("rejette une année hors des bornes acceptées", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/fiscal/synthese?year=abc").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
  });

  it("inclut toujours l'année en cours dans availableYears même sans aucune donnée", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/fiscal/synthese").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.availableYears).toContain(2026);
  });

  // Contrairement à l'export (grand-livre, réservé à Entreprise ci-dessous),
  // la synthèse à l'écran reste accessible à toutes les formules payantes.
  it("reste accessible à un gestionnaire Starter", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });

    const res = await request(app).get("/api/fiscal/synthese").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
  });
});

describe("GET /api/fiscal/grand-livre", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exporte un journal chronologique (recettes et dépenses mêlées) avec un solde cumulé correct", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
    const contract = await createContract(property.id, tenant.id);
    // Volontairement inséré dans le désordre : le journal doit re-trier par date.
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 200, expenseDate: new Date(2026, 1, 1) });
    await createInvoice(contract.id, { amount: 500, periodMonth: 4, status: "PAID", paidAt: new Date(2026, 3, 5) });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.split("\n");
    // La dépense de février doit précéder les deux loyers (mars, avril).
    const plomberieIdx = lines.findIndex((l) => l.includes("Plomberie"));
    const loyerMarsIdx = lines.findIndex((l) => l.includes("Loyer 3/2026"));
    const loyerAvrilIdx = lines.findIndex((l) => l.includes("Loyer 4/2026"));
    expect(plomberieIdx).toBeGreaterThan(-1);
    expect(plomberieIdx).toBeLessThan(loyerMarsIdx);
    expect(loyerMarsIdx).toBeLessThan(loyerAvrilIdx);
    // Solde cumulé : -200 après la dépense, puis 300, puis 800.
    expect(lines[plomberieIdx]).toContain(";-200");
    expect(lines[loyerMarsIdx]).toContain(";300");
    expect(lines[loyerAvrilIdx]).toContain(";800");
    expect(res.text).toContain("Awa Sow");
  });

  it("neutralise un intitulé de dépense qui ressemble à une formule (CWE-1236)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "=2+2" });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "=cmd|'/C calc'!A1",
      amount: 100,
      expenseDate: new Date(2026, 5, 10),
    });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(";=cmd");
    expect(res.text).not.toContain(";=2+2;");
    expect(res.text).toContain("'=cmd|'/C calc'!A1");
    expect(res.text).toContain("'=2+2");
  });

  it("ne fait pas fuiter les écritures d'un autre gestionnaire", async () => {
    const managerA = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id, { title: "Bien Confidentiel B" });
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 777, status: "PAID", paidAt: new Date(2026, 2, 5) });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Bien Confidentiel B");
    expect(res.text).not.toContain("777");
  });

  it("indique l'absence d'écritures pour un exercice sans activité", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2020").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("Aucune écriture pour cet exercice");
  });

  it("écrit montants et solde cumulé à la virgule, sans résidu de flottant", async () => {
    // Deux écritures dont la différence tombe mal en binaire : le solde
    // cumulé sortait en « 799.9999999999999 ». Et tous les montants
    // sortaient au point décimal alors que le séparateur de colonnes est le
    // point-virgule — illisibles comme nombres dans un tableur français.
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 1000.1, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "Peinture",
      amount: 200.1,
      expenseDate: new Date(2026, 2, 10),
    });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("1000,10");
    expect(res.text).toContain("200,10");
    // Solde cumulé après les deux écritures : 1000,10 - 200,10 = 800,00 —
    // et surtout pas « 799.9999999999999 ».
    expect(res.text).toContain("800,00");
    expect(res.text).not.toContain("799.99");
  });

  // Export comptable (grand livre) : réservé à Entreprise (CGU §3) — un
  // gestionnaire Pro a accès à la synthèse fiscale mais pas à cet export.
  it("refuse l'export à un gestionnaire Pro (réservé à Entreprise)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Entreprise");
  });
});

describe("GET /api/fiscal/fec", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exporte des écritures en partie double équilibrées, une ligne Débit et une ligne Crédit par mouvement", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 200, expenseDate: new Date(2026, 1, 1) });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    const lines = res.text.split("\n");
    expect(lines[0].split("\t")).toEqual([
      "JournalCode",
      "JournalLib",
      "EcritureNum",
      "EcritureDate",
      "CompteNum",
      "CompteLib",
      "CompAuxNum",
      "CompAuxLib",
      "PieceRef",
      "PieceDate",
      "EcritureLib",
      "Debit",
      "Credit",
      "EcritureLet",
      "DateLet",
      "ValidDate",
      "Montantdevise",
      "Idevise",
    ]);
    // Deux écritures (loyer + dépense), deux lignes chacune : 1 en-tête + 4.
    expect(lines.filter((l) => l.length > 0)).toHaveLength(5);

    const ligneLoyerBanque = lines.find((l) => l.includes("Loyer 3/2026") && l.includes("512000"));
    const ligneLoyerProduit = lines.find((l) => l.includes("Loyer 3/2026") && l.includes("706100"));
    expect(ligneLoyerBanque).toBeDefined();
    expect(ligneLoyerProduit).toBeDefined();
    const colsBanque = ligneLoyerBanque!.split("\t");
    const colsProduit = ligneLoyerProduit!.split("\t");
    // Débit Banque = Crédit Loyers = 500,00 : l'écriture est équilibrée.
    expect(colsBanque[11]).toBe("500.00");
    expect(colsBanque[12]).toBe("0.00");
    expect(colsProduit[11]).toBe("0.00");
    expect(colsProduit[12]).toBe("500.00");
    // Même EcritureNum pour les deux lignes d'un même mouvement.
    expect(colsBanque[2]).toBe(colsProduit[2]);
    // Date au format FEC (AAAAMMDD), sans séparateur.
    expect(colsBanque[3]).toBe("20260305");

    const ligneDepense = lines.find((l) => l.includes("Plomberie") && l.includes("615500"));
    const ligneDepenseBanque = lines.find((l) => l.includes("Plomberie") && l.includes("512000"));
    expect(ligneDepense!.split("\t")[11]).toBe("200.00");
    expect(ligneDepenseBanque!.split("\t")[12]).toBe("200.00");
  });

  it("neutralise un intitulé qui ressemble à une formule (CWE-1236), sans les guillemets d'un CSV", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "=2+2" });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "=cmd|'/C calc'!A1",
      amount: 100,
      expenseDate: new Date(2026, 5, 10),
    });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("\t=cmd");
    expect(res.text).toContain("'=cmd|'/C calc'!A1 (=2+2)");
  });

  it("ne fait pas fuiter les écritures d'un autre gestionnaire", async () => {
    const managerA = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id, { title: "Bien Confidentiel B" });
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 777, status: "PAID", paidAt: new Date(2026, 2, 5) });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Bien Confidentiel B");
    expect(res.text).not.toContain("777.00");
  });

  it("ne produit que l'en-tête pour un exercice sans activité", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app).get("/api/fiscal/fec?year=2020").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text.trim().split("\n")).toHaveLength(1);
  });

  it("dérive le nom de fichier du SIREN (9 premiers chiffres du SIRET) et de l'année demandée", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    await testDb.insert(agencySettings).values({ userId: manager.id, siretOrId: "84920319400012" });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain('filename="849203194FEC20261231.txt"');
  });

  it("retombe sur un SIREN à zéros quand aucun SIRET n'est renseigné", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain('filename="000000000FEC20261231.txt"');
  });

  // Régression : le FEC n'accepte que l'ISO-8859-1 (arrêté du 29 juillet
  // 2013) — express.res.send() envoie pourtant toujours une chaîne en UTF-8
  // sur le fil, quel que soit le Content-Type déclaré. Un intitulé de
  // dépense/bien accentué (très courant en français) partait donc sur
  // plusieurs octets UTF-8 au lieu d'un seul octet Latin-1, ce qu'un
  // validateur FEC strict rejette. `.buffer(true)` + `.parse` lit les octets
  // BRUTS de la réponse : un test sur `res.text` (déjà décodé par le client
  // HTTP selon le charset déclaré) ne peut pas détecter ce genre d'écart.
  it("encode le fichier en ISO-8859-1, pas en UTF-8 (arrêté du 29 juillet 2013)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "Réparations et Impôts",
      amount: 100,
      expenseDate: new Date(2026, 5, 10),
    });

    const res = await request(app)
      .get("/api/fiscal/fec?year=2026")
      .set(authHeader(tokenFor(manager)))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("iso-8859-1");
    const octets: Buffer = res.body;
    // "é" en Latin-1 est l'octet unique 0xE9 ; en UTF-8, il serait encodé sur
    // deux octets (0xC3 0xA9), absents du fichier envoyé.
    expect(octets.includes(0xe9)).toBe(true);
    expect(octets.includes(0xc3)).toBe(false);
    expect(octets.toString("latin1")).toContain("Réparations et Impôts");
  });

  // Même réserve que le Grand Livre CSV (CGU §3, "export comptable avancé
  // FEC/Excel") : un gestionnaire Pro n'y a pas accès.
  it("refuse l'export à un gestionnaire Pro (réservé à Entreprise)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Entreprise");
  });
});

describe("GET /api/fiscal/syscohada", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exporte un Journal, un Grand Livre et une Balance équilibrés", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 200, expenseDate: new Date(2026, 1, 1) });

    const res = await request(app).get("/api/fiscal/syscohada?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    // L'avertissement de plan comptable provisoire doit toujours être présent.
    expect(res.text).toContain("non validé par un expert-comptable agréé OHADA");
    expect(res.text).toContain("JOURNAL");
    expect(res.text).toContain("GRAND LIVRE");
    expect(res.text).toContain("BALANCE GÉNÉRALE");
    // Compte banque OHADA (521000) et compte loyers OHADA (706000) apparaissent
    // tous les deux pour le même mouvement, en partie double.
    const ligneLoyerBanque = res.text.split("\n").find((l) => l.includes("Loyer 3/2026") && l.includes("521000"));
    const ligneLoyerProduit = res.text.split("\n").find((l) => l.includes("Loyer 3/2026") && l.includes("706000"));
    expect(ligneLoyerBanque).toBeDefined();
    expect(ligneLoyerProduit).toBeDefined();
    // Compte de dépense OHADA (624000, Entretien/réparations/maintenance).
    expect(res.text).toContain("624000");
    // Équilibre global : Total Débit == Total Crédit sur la ligne "Total général".
    const ligneTotal = res.text.split("\n").find((l) => l.includes("Total général EUR"));
    expect(ligneTotal).toBeDefined();
    const colonnes = ligneTotal!.split(";");
    expect(colonnes[3]).toBe(colonnes[4]);
  });

  it("ventile les comptes par devise sans les mélanger", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const propertyEur = await createProperty(manager.id, { currency: "EUR" });
    const tenantEur = await createTenant(manager.id);
    const contractEur = await createContract(propertyEur.id, tenantEur.id, { currency: "EUR" });
    await createInvoice(contractEur.id, { amount: 500, currency: "EUR", status: "PAID", paidAt: new Date(2026, 2, 5) });

    const propertyXof = await createProperty(manager.id, { currency: "XOF" });
    const tenantXof = await createTenant(manager.id);
    const contractXof = await createContract(propertyXof.id, tenantXof.id, { currency: "XOF" });
    await createInvoice(contractXof.id, { amount: 300000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 2, 6) });

    const res = await request(app).get("/api/fiscal/syscohada?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("Total général EUR");
    expect(res.text).toContain("Total général XOF");
    // Dans la seule section BALANCE GÉNÉRALE, une ligne "706000;...;EUR;..."
    // et une autre "706000;...;XOF;..." distinctes (pas mélangées en une seule).
    const sectionBalance = res.text.split("BALANCE GÉNÉRALE")[1];
    const lignesBalance = sectionBalance.split("\n").filter((l) => l.startsWith("706000;"));
    expect(lignesBalance).toHaveLength(2);
  });

  it("neutralise un intitulé qui ressemble à une formule (CWE-1236)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id, { title: "=2+2" });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "=cmd|'/C calc'!A1",
      amount: 100,
      expenseDate: new Date(2026, 5, 10),
    });

    const res = await request(app).get("/api/fiscal/syscohada?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(";=cmd");
    expect(res.text).toContain("'=cmd|'/C calc'!A1 (=2+2)");
  });

  it("ne fait pas fuiter les écritures d'un autre gestionnaire", async () => {
    const managerA = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id, { title: "Bien Confidentiel B" });
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 777, status: "PAID", paidAt: new Date(2026, 2, 5) });

    const res = await request(app).get("/api/fiscal/syscohada?year=2026").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Bien Confidentiel B");
    expect(res.text).not.toContain("777");
  });

  it("indique l'absence d'écritures pour un exercice sans activité", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });

    const res = await request(app).get("/api/fiscal/syscohada?year=2020").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text.match(/Aucune écriture pour cet exercice/g)).toHaveLength(3);
  });

  // Même réserve que le Grand Livre CSV et le FEC (CGU §3) : un gestionnaire
  // Pro n'y a pas accès.
  it("refuse l'export à un gestionnaire Pro (réservé à Entreprise)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app).get("/api/fiscal/syscohada?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Entreprise");
  });
});
