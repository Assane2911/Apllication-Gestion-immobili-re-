import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agencySettings, contractCotenants, contracts, leaseNotices, leaseSettlements } from "../db/schema";
import { createContract, createInspection, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import {
  calculerSolde,
  dateDeSortiePourSolde,
  donneesDuSolde,
  lireDetails,
  listerSoldes,
  referenceSolde,
} from "./soldeDeToutCompte.service";

/**
 * Le solde de tout compte, calculé directement (sans passer par les routes) : chaque règle d'arrondi, de prorata et de dépôt qui
 * décide de la somme qu'on réclame ou qu'on rend à un locataire. Le fichier des routes vérifie les parcours ; ici, les chiffres.
 */

async function bail(overrides: Parameters<typeof createContract>[2] = {}, managerOverrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager(managerOverrides);
  const property = await createProperty(manager.id, { title: "Villa Ngor", address: "12 Corniche Ouest" });
  const tenant = await createTenant(manager.id, { firstName: "Aminata", lastName: "Ba" });
  const contract = await createContract(property.id, tenant.id, {
    rent: 1000,
    deposit: 2000,
    startDate: new Date(Date.UTC(2025, 0, 1)),
    endDate: new Date(Date.UTC(2027, 0, 1)),
    ...overrides,
  });
  return { manager, property, tenant, contract };
}

type Facture = Partial<Parameters<typeof createInvoice>[1]>;
const facture = (contractId: string, mois: number, annee: number, extra: Facture = {}) =>
  createInvoice(contractId, { periodMonth: mois, periodYear: annee, amount: 1000, status: "PENDING", ...extra });

const SORTIE = new Date(Date.UTC(2025, 2, 31)); // 31 mars 2025

describe("calculerSolde : restes dus et trop-perçus", () => {
  it("un loyer payé en partie ne doit que le reste ; un loyer payé en totalité ne doit rien, même si amountPaid est à 0", async () => {
    const { contract } = await bail();
    await facture(contract.id, 1, 2025, { amountPaid: 400, status: "PENDING" });
    await facture(contract.id, 2, 2025, { status: "PAID", amountPaid: 0 });
    await facture(contract.id, 3, 2025);

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.lignes.map((l) => [l.periodMonth, l.paid, l.due])).toEqual([
      [1, 400, 600],
      [2, 1000, 0],
      [3, 0, 1000],
    ]);
    expect(s.unpaidTotal).toBe(1600);
    expect(s.balance).toBe(2000 - 1600);
  });

  it("les lignes sont classées par mois, d'une année sur l'autre, quel que soit l'ordre de création", async () => {
    const { contract } = await bail();
    await facture(contract.id, 2, 2025);
    await facture(contract.id, 12, 2024);
    await facture(contract.id, 1, 2025);

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 1, 28)) });

    expect(s.lignes.map((l) => `${l.periodYear}-${l.periodMonth}`)).toEqual(["2024-12", "2025-1", "2025-2"]);
  });

  it("une facture annulée ne compte ni comme dette ni comme facture après la sortie", async () => {
    const { contract } = await bail();
    await facture(contract.id, 1, 2025, { status: "CANCELLED" });
    await facture(contract.id, 8, 2025, { status: "CANCELLED" });

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.lignes).toEqual([]);
    expect(s.facturesApresSortie).toBe(0);
    expect(s.balance).toBe(2000);
  });

  it("les factures du mois de la sortie comptent, celles d'après sont ignorées mais comptées pour être signalées", async () => {
    const { contract } = await bail();
    await facture(contract.id, 3, 2025);
    await facture(contract.id, 4, 2025);
    await facture(contract.id, 5, 2025);

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.lignes.map((l) => l.periodMonth)).toEqual([3]);
    expect(s.facturesApresSortie).toBe(2);
  });

  it("le trop-perçu (payé plus que le loyer retenu) est rendu au locataire et s'ajoute au dépôt, sans compenser une autre dette", async () => {
    const { contract } = await bail();
    await facture(contract.id, 1, 2025, { amountPaid: 1300, status: "PENDING" });
    await facture(contract.id, 2, 2025);

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 1, 28)) });

    expect(s.lignes[0]).toMatchObject({ due: 0, credit: 300 });
    expect(s.lignes[1]).toMatchObject({ due: 1000, credit: 0 });
    expect(s.creditTotal).toBe(300);
    expect(s.unpaidTotal).toBe(1000);
    expect(s.balance).toBe(2000 - 1000 + 300);
  });

  it("les paiements en deux fois sont arrondis au centime : 0,1 + 0,2 ne laisse pas un reste fantôme", async () => {
    const { contract } = await bail({ rent: 0.3, deposit: 0 });
    await facture(contract.id, 1, 2025, { amount: 0.3, amountPaid: 0.1 + 0.2, status: "PENDING" });

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 0, 31)) });

    expect(s.lignes[0].due).toBe(0);
    expect(s.lignes[0].credit).toBe(0);
    expect(s.balance).toBe(0);
  });

  it("un reste dû est arrondi au centime : 0,3 moins 0,1 vaut exactement 0,2 sur la ligne", async () => {
    const { contract } = await bail({ rent: 0.3, deposit: 0 });
    await facture(contract.id, 1, 2025, { amount: 0.3, amountPaid: 0.1 });

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 0, 31)) });

    expect(s.lignes[0].due).toBe(0.2);
    expect(s.balance).toBe(-0.2);
  });

  it("un bail sans aucune facture rend simplement le dépôt", async () => {
    const { contract } = await bail({ deposit: 750.5 });

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s).toMatchObject({ depositAmount: 750.5, balance: 750.5, unpaidTotal: 0, creditTotal: 0 });
  });

  it("le solde porte la devise du bail (EUR par défaut), la date de sortie et le mode retenus", async () => {
    const { contract } = await bail({ currency: "XOF" });

    const s = await calculerSolde(contract, { exitDate: SORTIE, lastMonthMode: "PRORATA" });

    expect(s.currency).toBe("XOF");
    expect(s.exitDate).toEqual(SORTIE);
    expect(s.lastMonthMode).toBe("PRORATA");
    expect((await calculerSolde(contract, { exitDate: SORTIE })).lastMonthMode).toBe("FULL");
  });
});

describe("calculerSolde : dernier mois au prorata", () => {
  it("au prorata, seul le mois de la sortie est ramené aux jours occupés ; les mois précédents restent entiers", async () => {
    const { contract } = await bail();
    await facture(contract.id, 2, 2025);
    await facture(contract.id, 3, 2025);

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 16)), lastMonthMode: "PRORATA" });

    expect(s.lignes[0]).toMatchObject({ periodMonth: 2, amount: 1000, retenu: 1000, due: 1000 });
    // 16 jours sur 31
    expect(s.lignes[1]).toMatchObject({ periodMonth: 3, amount: 1000, retenu: 516.13, due: 516.13 });
  });

  it("en mode FULL, le mois de la sortie est dû en entier", async () => {
    const { contract } = await bail();
    await facture(contract.id, 3, 2025);

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 16)), lastMonthMode: "FULL" });

    expect(s.lignes[0].retenu).toBe(1000);
  });

  it("une sortie le dernier jour du mois ne réduit rien, même au prorata", async () => {
    const { contract } = await bail();
    await facture(contract.id, 3, 2025);

    const s = await calculerSolde(contract, { exitDate: SORTIE, lastMonthMode: "PRORATA" });

    expect(s.lignes[0].retenu).toBe(1000);
  });

  it("un bail qui se termine avant la date de sortie demandée : les jours comptés s'arrêtent à la fin du bail", async () => {
    const { contract } = await bail({ endDate: new Date(Date.UTC(2025, 2, 10)) });
    await facture(contract.id, 3, 2025, { amount: 300 }); // facture déjà au prorata : 10 jours sur 31 couverts

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 28)), lastMonthMode: "PRORATA" });

    expect(s.lignes[0].retenu).toBe(300);
  });

  it("entrée ET sortie dans le même mois : le loyer facturé (déjà au prorata de l'entrée) est ramené aux jours réellement occupés", async () => {
    const { contract } = await bail({ startDate: new Date(Date.UTC(2025, 2, 11)) });
    await facture(contract.id, 3, 2025, { amount: 2100 }); // 21 jours facturés (du 11 au 31)

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 20)), lastMonthMode: "PRORATA" });

    // 10 jours occupés (du 11 au 20) sur les 21 facturés : 2100 × 10 / 21
    expect(s.lignes[0].retenu).toBe(1000);
  });

  it("sortie à la fin du mois au prorata : le montant facturé est repris tel quel, sans être arrondi à l'unité de la devise", async () => {
    const { contract } = await bail({ currency: "XOF", deposit: 0 });
    await facture(contract.id, 3, 2025, { amount: 100.5, currency: "XOF" });

    const s = await calculerSolde(contract, { exitDate: SORTIE, lastMonthMode: "PRORATA" });

    expect(s.lignes[0].retenu).toBe(100.5);
  });

  it("sortie le premier jour : un seul jour occupé sur le mois", async () => {
    const { contract } = await bail();
    await facture(contract.id, 3, 2025, { amount: 3100 });

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 1)), lastMonthMode: "PRORATA" });

    expect(s.lignes[0].retenu).toBe(100);
  });

  it("en francs CFA, le prorata est arrondi au franc entier (jamais de centimes)", async () => {
    const { contract } = await bail({ currency: "XOF", rent: 100000, deposit: 0 });
    await facture(contract.id, 3, 2025, { amount: 100000, currency: "XOF" });

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 16)), lastMonthMode: "PRORATA" });

    expect(s.lignes[0].retenu).toBe(51613); // 100000 × 16 / 31 = 51 612,9…
    expect(Number.isInteger(s.lignes[0].due)).toBe(true);
  });

  it("un loyer déjà réglé en entier avant un prorata devient un trop-perçu, pas une dette", async () => {
    const { contract } = await bail({ deposit: 0 });
    await facture(contract.id, 3, 2025, { status: "PAID" });

    const s = await calculerSolde(contract, { exitDate: new Date(Date.UTC(2025, 2, 16)), lastMonthMode: "PRORATA" });

    expect(s.lignes[0]).toMatchObject({ due: 0, credit: 483.87 });
    expect(s.balance).toBe(483.87);
  });
});

describe("calculerSolde : dépôt de garantie", () => {
  it("sans restitution enregistrée, les retenues ne comptent pas et rien n'est considéré comme rendu", async () => {
    const { contract } = await bail({ depositDeductions: JSON.stringify([{ label: "Peinture", amount: 300 }]) });

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s).toMatchObject({ restitutionEnregistree: false, deductions: [], deductionsTotal: 0, depositRefunded: 0, balance: 2000 });
  });

  it("restitution enregistrée : les retenues sont déduites et le reste du dépôt est considéré comme déjà rendu", async () => {
    const { contract } = await bail({
      depositDeductions: JSON.stringify([
        { label: "Peinture", amount: 300 },
        { label: "Serrure", amount: 50.5 },
      ]),
      depositRefundedAt: new Date(),
    });

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.deductionsTotal).toBe(350.5);
    expect(s.depositRefunded).toBe(1649.5);
    expect(s.balance).toBe(0); // tout est réglé : retenues + part rendue = dépôt
  });

  it("restitution faite : un loyer impayé reste dû en plus, sans toucher au dépôt déjà rendu", async () => {
    const { contract } = await bail({ depositRefundedAt: new Date(), depositDeductions: null });
    await facture(contract.id, 3, 2025);

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.depositRefunded).toBe(2000);
    expect(s.balance).toBe(-1000);
  });

  it("des retenues supérieures au dépôt : rien n'a été rendu, et le solde est négatif", async () => {
    const { contract } = await bail({ deposit: 500, depositDeductions: JSON.stringify([{ label: "Dégâts", amount: 800 }]), depositRefundedAt: new Date() });

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.depositRefunded).toBe(0);
    expect(s.balance).toBe(500 - 800);
  });

  it("des retenues illisibles (JSON cassé, ou pas une liste) sont ignorées plutôt que de bloquer le calcul", async () => {
    for (const brut of ["pas du json", JSON.stringify({ label: "x", amount: 1 }), "", null]) {
      const { contract } = await bail({ depositDeductions: brut, depositRefundedAt: new Date() });

      const s = await calculerSolde(contract, { exitDate: SORTIE });

      expect(s.deductions).toEqual([]);
      expect(s.deductionsTotal).toBe(0);
      expect(s.depositRefunded).toBe(2000);
    }
  });

  it("dans une liste de retenues, les lignes sans libellé ou au montant invalide sont écartées, les autres gardées", async () => {
    const { contract } = await bail({
      depositDeductions: JSON.stringify([
        { label: "Peinture", amount: 100 },
        { label: 12, amount: 50 },
        { label: "Sans montant" },
        { label: "Texte", amount: "30" },
        null,
        { label: "Serrure", amount: 25 },
      ]),
      depositRefundedAt: new Date(),
    });

    const s = await calculerSolde(contract, { exitDate: SORTIE });

    expect(s.deductions).toEqual([
      { label: "Peinture", amount: 100 },
      { label: "Serrure", amount: 25 },
    ]);
    expect(s.deductionsTotal).toBe(125);
  });
});

describe("calculerSolde : état des lieux de sortie", () => {
  it("aucun état des lieux, un brouillon, ou un état finalisé : seul le finalisé est signalé", async () => {
    const { manager, contract } = await bail();
    expect((await calculerSolde(contract, { exitDate: SORTIE })).etatDesLieuxDeSortie).toBe(false);

    await createInspection(contract, manager.id, { type: "EXIT", status: "DRAFT" } as never);
    expect((await calculerSolde(contract, { exitDate: SORTIE })).etatDesLieuxDeSortie).toBe(false);

    await createInspection(contract, manager.id, { type: "EXIT", status: "COMPLETED" } as never);
    expect((await calculerSolde(contract, { exitDate: SORTIE })).etatDesLieuxDeSortie).toBe(true);
  });

  it("un état des lieux d'ENTRÉE finalisé ne compte pas", async () => {
    const { manager, contract } = await bail();
    await createInspection(contract, manager.id, { type: "ENTRY", status: "COMPLETED" } as never);

    expect((await calculerSolde(contract, { exitDate: SORTIE })).etatDesLieuxDeSortie).toBe(false);
  });
});

describe("dateDeSortiePourSolde", () => {
  const conge = (contractId: string, managerId: string, exitDate: Date, status = "ACTIVE") =>
    testDb.insert(leaseNotices).values({
      contractId,
      managerId,
      givenBy: "TENANT",
      deliveryMode: "HAND_DELIVERY",
      servedAt: new Date(Date.UTC(2025, 0, 1)),
      periodValue: 1,
      periodUnit: "MONTHS",
      exitDate,
      status,
    });

  it("la date demandée l'emporte sur tout le reste", async () => {
    const { manager, contract } = await bail();
    await conge(contract.id, manager.id, new Date(Date.UTC(2025, 5, 30)));
    const demandee = new Date(Date.UTC(2025, 3, 15));

    expect(await dateDeSortiePourSolde(contract, demandee)).toEqual(demandee);
  });

  it("sans date demandée, c'est la sortie du congé en cours ; un congé retiré est ignoré", async () => {
    const { manager, contract } = await bail();
    await conge(contract.id, manager.id, new Date(Date.UTC(2025, 8, 30)), "WITHDRAWN");
    const actif = new Date(Date.UTC(2025, 5, 30));
    await conge(contract.id, manager.id, actif);

    expect(await dateDeSortiePourSolde(contract)).toEqual(actif);
  });

  it("le congé d'un AUTRE bail n'est jamais retenu", async () => {
    const { contract } = await bail({ endDate: new Date(Date.UTC(2025, 2, 31)) });
    const autre = await bail();
    await conge(autre.contract.id, autre.manager.id, new Date(Date.UTC(2025, 9, 31)));

    expect(await dateDeSortiePourSolde(contract)).toEqual(new Date(Date.UTC(2025, 2, 31)));
  });

  it("sans congé : la fin du bail si elle est passée, sinon aujourd'hui (jamais une sortie dans le futur)", async () => {
    const { contract: termine } = await bail({ endDate: new Date(Date.UTC(2025, 2, 31)) });
    expect(await dateDeSortiePourSolde(termine)).toEqual(new Date(Date.UTC(2025, 2, 31)));

    const { contract: enCours } = await bail({ endDate: new Date(Date.now() + 400 * 86_400_000) });
    const avant = Date.now();
    const sortie = await dateDeSortiePourSolde(enCours);
    expect(sortie.getTime()).toBeGreaterThanOrEqual(avant - 1000);
    expect(sortie.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("solde émis : détails, référence, historique, document", () => {
  async function emettre(contractId: string, managerId: string, extra: Partial<typeof leaseSettlements.$inferInsert> = {}) {
    const [s] = await testDb
      .insert(leaseSettlements)
      .values({ contractId, managerId, exitDate: SORTIE, depositAmount: 2000, balance: 2000, details: "{}", ...extra })
      .returning();
    return s;
  }

  it("lireDetails : un détail absent, partiel ou illisible donne des listes vides, jamais une erreur", () => {
    const vide = { lignes: [], deductions: [], facturesApresSortie: 0 };
    expect(lireDetails({ details: "pas du json" })).toEqual(vide);
    expect(lireDetails({ details: "{}" })).toEqual(vide);
    expect(lireDetails({ details: JSON.stringify({ facturesApresSortie: 3 }) })).toEqual({ ...vide, facturesApresSortie: 3 });
    expect(lireDetails({ details: JSON.stringify({ deductions: [{ label: "A", amount: 1 }] }) }).deductions).toHaveLength(1);
  });

  it("referenceSolde : SOLDE-année-8 premiers caractères de l'identifiant en majuscules", () => {
    expect(referenceSolde({ id: "abcdef0123456789", createdAt: new Date(Date.UTC(2026, 0, 1)) })).toBe("SOLDE-2026-ABCDEF01");
  });

  it("listerSoldes : du plus récent au plus ancien, et seulement ceux de ce bail", async () => {
    const { manager, contract } = await bail();
    const autre = await bail();
    const ancien = await emettre(contract.id, manager.id, { createdAt: new Date(Date.UTC(2025, 0, 1)) });
    const recent = await emettre(contract.id, manager.id, { createdAt: new Date(Date.UTC(2025, 5, 1)) });
    await emettre(autre.contract.id, autre.manager.id);

    expect((await listerSoldes(contract.id)).map((s) => s.id)).toEqual([recent.id, ancien.id]);
  });

  it("donneesDuSolde : un bail introuvable est une erreur 404 claire", async () => {
    const { manager, contract } = await bail();
    const solde = await emettre(contract.id, manager.id);

    await expect(donneesDuSolde({ ...solde, contractId: "bail-inexistant" })).rejects.toMatchObject({ statusCode: 404, code: "CONTRACT_NOT_FOUND" });
  });

  it("donneesDuSolde : le document reprend le solde FIGÉ, nomme les locataires et porte les coordonnées de l'agence qui l'a émis", async () => {
    const { manager, contract } = await bail();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Rivage", address: "5 rue du Port", phone: "+221338000000", email: "contact@rivage.sn", siretOrId: "NINEA 1" });
    const coloc = await createTenant(manager.id, { firstName: "Moussa", lastName: "Diop" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    const solde = await emettre(contract.id, manager.id, {
      currency: "XOF",
      lastMonthMode: "PRORATA",
      deductionsTotal: 100,
      depositRefunded: 1900,
      unpaidTotal: 40,
      creditTotal: 10,
      balance: -30,
      details: JSON.stringify({ lignes: [{ periodMonth: 3, periodYear: 2025, amount: 1, retenu: 1, paid: 0, due: 1, credit: 0 }], deductions: [{ label: "Peinture", amount: 100 }], facturesApresSortie: 2 }),
    });
    // Le bail change ensuite : le document reste celui qui a été émis.
    await testDb.update(contracts).set({ deposit: 99999 }).where(eq(contracts.id, contract.id));

    const d = await donneesDuSolde(solde);

    expect(d).toMatchObject({
      reference: referenceSolde(solde),
      currency: "XOF",
      lastMonthMode: "PRORATA",
      depositAmount: 2000,
      deductionsTotal: 100,
      depositRefunded: 1900,
      unpaidTotal: 40,
      creditTotal: 10,
      balance: -30,
      adresse: "12 Corniche Ouest",
      propertyTitle: "Villa Ngor",
      agency: { name: "Agence Rivage", address: "5 rue du Port", phone: "+221338000000", email: "contact@rivage.sn", siretOrId: "NINEA 1" },
    });
    expect(d.deductions).toEqual([{ label: "Peinture", amount: 100 }]);
    expect(d.lignes).toHaveLength(1);
    expect(d.destinataires).toContain("Aminata Ba");
    expect(d.destinataires).toContain("Moussa Diop");
    expect(d.destinataires).toContain(" et ");
  });

  it("donneesDuSolde : les coordonnées sont celles de l'agence qui a ÉMIS le solde, pas celles d'un autre compte", async () => {
    const { contract } = await bail();
    const emetteur = await createManager();
    await testDb.insert(agencySettings).values({ userId: emetteur.id, agencyName: "Agence Émettrice" });
    const solde = await emettre(contract.id, emetteur.id);

    expect((await donneesDuSolde(solde)).agency.name).toBe("Agence Émettrice");
  });

  it("donneesDuSolde : sans réglages d'agence, nom de repli et coordonnées vides (null)", async () => {
    const { manager, contract } = await bail();
    const solde = await emettre(contract.id, manager.id);

    const d = await donneesDuSolde(solde);

    expect(d.agency).toEqual({ name: "Agence Immobilière", address: null, phone: null, email: null, siretOrId: null });
  });
});
