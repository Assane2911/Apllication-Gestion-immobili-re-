import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contractCotenants, contractGuarantors, rentRevisions } from "../db/schema";
import { bauxAReviser } from "../services/rentRevision.service";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Suite de la révision de loyer : le rappel des baux dont l'anniversaire approche, et l'avenant
 * à faire signer. Aujourd'hui (horloge figée) : 12 octobre 2026.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  return { manager, h: authHeader(tokenFor(manager)) };
}

/** Un bail actif sur un bien qui lui est propre. */
async function bail(managerId: string, debut: string, fin = "2028-12-31", extra: Record<string, unknown> = {}) {
  const property = await createProperty(managerId, { title: `Bien ${debut}` });
  const tenant = await createTenant(managerId, { email: `loc-${debut}-${Math.random()}@example.com`, firstName: "Awa", lastName: "Ndiaye" });
  const contract = await createContract(property.id, tenant.id, { rent: 500, startDate: utc(debut), endDate: utc(fin), status: "ACTIVE", ...extra });
  return { property, tenant, contract };
}

const ids = (l: Array<{ contractId: string }>) => l.map((b) => b.contractId);

describe("baux à réviser", () => {
  it("retient l'anniversaire des 60 prochains jours ou des 30 derniers, et propose un premier de mois jamais antérieur à l'anniversaire", async () => {
    const { manager } = await agence();
    const bientot = await bail(manager.id, "2025-11-15"); // anniversaire le 15/11/2026
    const passe = await bail(manager.id, "2025-10-01"); // anniversaire le 01/10/2026, il y a 11 jours
    const tropVieux = await bail(manager.id, "2025-09-01"); // il y a 41 jours : hors fenêtre
    const tropLoin = await bail(manager.id, "2025-12-20"); // dans 69 jours : hors fenêtre
    const premiereAnnee = await bail(manager.id, "2026-02-01"); // pas encore d'anniversaire

    const liste = await bauxAReviser(manager.id);

    expect(ids(liste)).toEqual([passe.contract.id, bientot.contract.id]);
    const [a, b] = liste;
    expect(a.anniversaire.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(a.dateSuggeree.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(b.anniversaire.toISOString().slice(0, 10)).toBe("2026-11-15");
    // Anniversaire en milieu de mois : la révision proposée commence le mois suivant, jamais avant.
    expect(b.dateSuggeree.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(b).toMatchObject({ rent: 500, tenantName: "Awa Ndiaye", derniereRevision: null });
    expect(ids(liste)).not.toContain(tropVieux.contract.id);
    expect(ids(liste)).not.toContain(tropLoin.contract.id);
    expect(ids(liste)).not.toContain(premiereAnnee.contract.id);
  });

  it("un anniversaire passé depuis plus d'un mois propose le mois en cours, pas une date passée", async () => {
    const { manager } = await agence();
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
    const { contract } = await bail(manager.id, "2025-10-01"); // anniversaire il y a 27 jours
    const [b] = await bauxAReviser(manager.id);
    expect(b.contractId).toBe(contract.id);
    expect(b.dateSuggeree.toISOString().slice(0, 10)).toBe("2026-10-01");

    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
    const second = await bail(manager.id, "2025-09-30"); // anniversaire il y a 28 jours, en fin de mois
    const liste = await bauxAReviser(manager.id);
    const s = liste.find((x) => x.contractId === second.contract.id)!;
    expect(s.dateSuggeree.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("une révision programmée, ou appliquée dans l'année, retire le bail de la liste ; une révision ancienne non", async () => {
    const { manager } = await agence();
    const programme = await bail(manager.id, "2024-11-15");
    const recent = await bail(manager.id, "2024-11-16");
    const ancien = await bail(manager.id, "2024-11-17");
    const annule = await bail(manager.id, "2024-11-18");
    await testDb.insert(rentRevisions).values([
      { contractId: programme.contract.id, previousRent: 500, newRent: 520, effectiveDate: utc("2026-12-01"), method: "AMOUNT", status: "PENDING" },
      { contractId: recent.contract.id, previousRent: 480, newRent: 500, effectiveDate: utc("2026-01-01"), method: "AMOUNT", status: "APPLIED" },
      { contractId: ancien.contract.id, previousRent: 480, newRent: 500, effectiveDate: utc("2025-12-01"), method: "AMOUNT", status: "APPLIED" },
      { contractId: annule.contract.id, previousRent: 500, newRent: 520, effectiveDate: utc("2026-12-01"), method: "AMOUNT", status: "CANCELLED" },
    ]);

    const liste = await bauxAReviser(manager.id);

    expect(ids(liste).sort()).toEqual([ancien.contract.id, annule.contract.id].sort());
    expect(liste.find((b) => b.contractId === ancien.contract.id)!.derniereRevision?.toISOString().slice(0, 10)).toBe("2025-12-01");
  });

  it("ignore les baux inactifs, ceux qui finissent avant l'anniversaire, et ceux d'une autre agence", async () => {
    const { manager } = await agence();
    const autre = await agence();
    await bail(manager.id, "2025-11-10", "2028-12-31", { status: "ENDED" });
    await bail(manager.id, "2025-11-11", "2026-11-01");
    await bail(autre.manager.id, "2025-11-12");
    expect(await bauxAReviser(manager.id)).toEqual([]);
  });

  it("un bail du 29 février fête son anniversaire le 28 les années non bissextiles", async () => {
    const { manager } = await agence();
    vi.setSystemTime(new Date("2026-02-10T09:00:00Z"));
    await bail(manager.id, "2024-02-29");
    const [b] = await bauxAReviser(manager.id);
    expect(b.anniversaire.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(b.dateSuggeree.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("l'API renvoie la liste du gestionnaire connecté", async () => {
    const { manager, h } = await agence();
    const { contract } = await bail(manager.id, "2025-11-15");
    const res = await request(app).get("/api/contracts/revisions-due").set(h);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ contractId: contract.id, dateSuggeree: "2026-12-01T00:00:00.000Z", anniversaire: "2026-11-15T00:00:00.000Z" });
    expect((await request(app).get("/api/contracts/revisions-due")).status).toBe(401);
  });
});

describe("avenant de révision", () => {
  async function avecRevision() {
    const { manager, h } = await agence();
    const b = await bail(manager.id, "2025-11-15", "2027-11-14", { leaseType: "MEUBLE", applicableLaw: "Droit sénégalais" });
    const r1 = await request(app)
      .post(`/api/contracts/${b.contract.id}/rent-revisions`)
      .set(h)
      .send({ mode: "PERCENT", percent: 3, effectiveDate: "2026-10-01", note: "Indexation <annuelle>" });
    return { manager, h, ...b, revision: r1.body };
  }

  it("le gestionnaire obtient un avenant numéroté, avec ancien et nouveau loyer, date d'effet et base de calcul", async () => {
    const { h, revision } = await avecRevision();
    const res = await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("AVENANT N°1 AU BAIL D'HABITATION MEUBLÉE");
    expect(res.text).toContain("Révision du loyer");
    expect(res.text).toContain("01/10/2026");
    expect(res.text).toContain("+3 %");
    expect(res.text).toContain("Droit sénégalais");
    expect(res.text).toMatch(/500/);
    expect(res.text).toMatch(/515/);
    // Texte saisi : échappé.
    expect(res.text).toContain("Indexation &lt;annuelle&gt;");
    expect(res.text).not.toContain("<annuelle>");
    expect(res.text).toContain("Toutes les autres clauses du bail demeurent inchangées");
    expect(res.text).not.toMatch(/conforme/i);
  });

  it("cite les colocataires et les garants du bail, avec un cadre de signature chacun : la révision change ce qu'ils doivent ou garantissent", async () => {
    const { manager, h, contract, revision } = await avecRevision();
    const coloc = await createTenant(manager.id, { email: "binta@example.com", firstName: "Binta", lastName: "Sy" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    await testDb.insert(contractGuarantors).values([
      { contractId: contract.id, firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", maxAmount: 3000 },
      { contractId: contract.id, firstName: "Moussa", lastName: "Ba", phone: "+221771234568" },
    ]);

    const res = await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(h);

    expect(res.text).toContain("Colocataire :</strong> Binta Sy");
    expect(res.text).toMatch(/Garant :<\/strong> Ibrahima Fall[^<]*Montant maximal garanti : 3\s?000/);
    expect(res.text).toMatch(/Garant :<\/strong> Moussa Ba[^<]*Montant maximal garanti : non précisé/);
    expect(res.text).toContain("Le Colocataire :</strong> Binta Sy");
    expect(res.text).toContain("Le Garant :</strong> Ibrahima Fall");
    expect(res.text).toContain("Le Garant :</strong> Moussa Ba");
    // « En deux exemplaires » ne tient plus avec quatre signataires de plus.
    expect(res.text).toContain("en autant d'exemplaires que de signataires");
    expect(res.text).not.toContain("en deux exemplaires");
  });

  it("précise au garant que sa signature ne remplace pas un acte de cautionnement quand la révision aggrave son engagement", async () => {
    const { contract, h, revision } = await avecRevision();
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", maxAmount: 3000 });

    const res = await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(h);

    expect(res.text).toContain("Engagement des garants");
    expect(res.text).toMatch(/atteste (?:qu'il|que le garant) a pris connaissance de la révision/);
    expect(res.text).toContain("ne remplace pas un acte de cautionnement");
    expect(res.text).toMatch(/aggrave l'engagement[^<]*nouvel acte de cautionnement/);
    // La plateforme n'atteste la validité d'aucun engagement : le texte ne doit jamais l'affirmer.
    expect(res.text).not.toMatch(/valable|valide|conforme/i);
  });

  it("n'ajoute aucun paragraphe sur les garants à un avenant sans garant", async () => {
    const { h, revision } = await avecRevision();
    const res = await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(h);
    expect(res.text).not.toContain("Engagement des garants");
  });

  it("un bail sans colocataire ni garant garde un avenant à deux signatures", async () => {
    const { h, revision } = await avecRevision();
    const res = await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(h);
    expect(res.text).not.toContain("Garant :");
    expect(res.text).not.toContain("Colocataire :");
    expect(res.text.match(/class="sig-block"/g)).toHaveLength(2);
    expect(res.text).toContain("en deux exemplaires");
  });

  it("empêche qu'un cadre de signature soit coupé entre deux pages à l'impression", async () => {
    const { h, revision } = await avecRevision();
    const res = await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(h);
    expect(res.text).toMatch(/\.sig-block\s*\{[^}]*break-inside:\s*avoid/);
  });

  it("numérote les avenants successifs et signale une révision programmée", async () => {
    const { h, contract } = await avecRevision();
    const r2 = await request(app).post(`/api/contracts/${contract.id}/rent-revisions`).set(h).send({ mode: "AMOUNT", newRent: 540, effectiveDate: "2027-01-01" });
    const res = await request(app).get(`/api/documents/rent-revision/${r2.body.id}`).set(h);
    expect(res.text).toContain("AVENANT N°2");
    expect(res.text).toContain("(révision programmée)");
  });

  it("le locataire du bail y a accès ; un autre gestionnaire non ; une révision annulée n'a pas d'avenant", async () => {
    const { h, tenant, contract, revision } = await avecRevision();
    const hLocataire = authHeader(await tokenLocataire(tenant.id));
    expect((await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(hLocataire)).status).toBe(200);

    const autre = await agence();
    expect((await request(app).get(`/api/documents/rent-revision/${revision.id}`).set(autre.h)).status).toBe(404);
    expect((await request(app).get("/api/documents/rent-revision/inconnue").set(h)).status).toBe(404);

    const programmee = await request(app).post(`/api/contracts/${contract.id}/rent-revisions`).set(h).send({ mode: "AMOUNT", newRent: 540, effectiveDate: "2027-01-01" });
    await request(app).delete(`/api/contracts/${contract.id}/rent-revisions/${programmee.body.id}`).set(h);
    const annulee = await request(app).get(`/api/documents/rent-revision/${programmee.body.id}`).set(h);
    expect(annulee.status).toBe(409);
  });
});
