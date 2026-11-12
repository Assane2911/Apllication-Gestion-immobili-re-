import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, contractGuarantors, listingLeads, listings } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenCollaborateur, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Un garant ou un prospect n'a pas de compte : il adresse sa demande d'accès ou d'effacement au gestionnaire (responsable de
 * traitement). Un garant d'un bail signé ne pouvait pas même être retiré.
 */
async function bailAvecGarant(managerId: string, garant: Partial<typeof contractGuarantors.$inferInsert> = {}, bail: Record<string, unknown> = {}) {
  const bien = await createProperty(managerId, { title: "Villa Almadies", address: "12 rue des Almadies, Dakar" });
  const locataire = await createTenant(managerId, { firstName: "Moussa", lastName: "Ba" });
  const contrat = await createContract(bien.id, locataire.id, bail);
  const [g] = await testDb
    .insert(contractGuarantors)
    .values({ contractId: contrat.id, firstName: "Awa", lastName: "Diop", phone: "+221770001122", email: "awa.diop@example.com", address: "Thiès", maxAmount: 600000, notes: "Mère du locataire", ...garant })
    .returning();
  return { bien, contrat, garant: g };
}

async function prospect(managerId: string, overrides: Partial<typeof listingLeads.$inferInsert> = {}) {
  const [annonce] = await testDb.insert(listings).values({ managerId, title: "Villa à louer", description: "Belle villa", price: 1, location: "Dakar" }).returning();
  const [lead] = await testDb
    .insert(listingLeads)
    .values({ listingId: annonce.id, managerId, prospectName: "Ibrahima Sow", prospectEmail: "ibra@example.com", prospectPhone: "+221771112233", message: "Visite samedi ?", notes: "À rappeler", ...overrides })
    .returning();
  return { annonce, lead };
}

const exporter = (token: string, query: string) => request(app).get(`/api/personnes/export?${query}`).set(authHeader(token));
const anonymiser = (token: string, corps: Record<string, unknown>) => request(app).post("/api/personnes/anonymiser").set(authHeader(token)).send(corps);

describe("export des données d'un garant ou d'un prospect", () => {
  it("livre en pièce jointe tout ce que l'agence détient sur le garant, sans l'identité du locataire", async () => {
    const manager = await createManager();
    await bailAvecGarant(manager.id);

    const res = await exporter(tokenFor(manager), "email=Awa.Diop@Example.com");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="donnees-personne\.json"/);
    const corps = JSON.parse(res.text);
    expect(corps.garants).toHaveLength(1);
    expect(corps.garants[0]).toMatchObject({ firstName: "Awa", lastName: "Diop", phone: "+221770001122", email: "awa.diop@example.com", address: "Thiès", maxAmount: 600000, notes: "Mère du locataire" });
    expect(corps.garants[0].bien).toEqual({ title: "Villa Almadies", address: "12 rue des Almadies, Dakar" });
    expect(corps.prospects).toEqual([]);
    // Le locataire dont il se porte garant est un tiers : ni son nom ni sa fiche ne sortent dans ce fichier.
    expect(res.text).not.toContain("Moussa");
    expect(res.text).not.toContain("Ba\"");
  });

  it("retrouve le garant par son téléphone, quelle que soit la façon de l'écrire, et le prospect par email ou téléphone", async () => {
    const manager = await createManager();
    await bailAvecGarant(manager.id);
    await prospect(manager.id, { prospectPhone: "221771112233" });

    const parTelephone = await exporter(tokenFor(manager), `phone=${encodeURIComponent("+221 77 000 11 22")}`);
    expect(JSON.parse(parTelephone.text).garants).toHaveLength(1);

    const prospectParTel = await exporter(tokenFor(manager), `phone=${encodeURIComponent("+221 77 111 22 33")}`);
    expect(prospectParTel.status).toBe(200);
    const corps = JSON.parse(prospectParTel.text);
    expect(corps.prospects).toHaveLength(1);
    expect(corps.prospects[0]).toMatchObject({ prospectName: "Ibrahima Sow", message: "Visite samedi ?", notes: "À rappeler", annonce: { title: "Villa à louer" } });
  });

  it("n'expose JAMAIS les données d'une autre agence", async () => {
    const manager = await createManager();
    const autre = await createManager();
    await bailAvecGarant(autre.id);
    await prospect(autre.id);

    expect((await exporter(tokenFor(manager), "email=awa.diop@example.com")).status).toBe(404);
    expect((await exporter(tokenFor(manager), "email=ibra@example.com")).status).toBe(404);
  });

  it("répond 404 (code traduisible) quand rien n'est détenu, et 400 sans critère ou avec un téléphone invalide", async () => {
    const manager = await createManager();
    const inconnu = await exporter(tokenFor(manager), "email=personne@example.com");
    expect(inconnu.status).toBe(404);
    expect(inconnu.body.code).toBe("PERSON_DATA_NOT_FOUND");

    const sansCritere = await exporter(tokenFor(manager), "");
    expect(sansCritere.status).toBe(400);
    expect(sansCritere.body.code).toBe("PERSON_CRITERIA_REQUIRED");

    expect((await exporter(tokenFor(manager), "phone=abc")).status).toBe(400);
  });

  it("trace l'export dans le journal d'activité, sans y recopier l'identité de la personne", async () => {
    const manager = await createManager();
    await bailAvecGarant(manager.id);
    await exporter(tokenFor(manager), "email=awa.diop@example.com");

    const [ligne] = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "personne.export"));
    expect(ligne.managerId).toBe(manager.id);
    expect(ligne.details).toContain("1 garant(s)");
    expect(JSON.stringify(ligne)).not.toMatch(/awa|diop|example\.com|221770001122/i);
  });

  it("exige l'authentification, refuse un locataire, et réserve la lecture au propriétaire de l'agence et aux administrateurs d'équipe", async () => {
    const manager = await createManager();
    await bailAvecGarant(manager.id);

    expect((await request(app).get("/api/personnes/export?email=awa.diop@example.com")).status).toBe(401);

    const agent = await tokenCollaborateur(manager, { teamRole: "AGENT" });
    const refuse = await exporter(agent, "email=awa.diop@example.com");
    expect(refuse.status).toBe(403);

    const admin = await tokenCollaborateur(manager, { teamRole: "FULL" });
    expect((await exporter(admin, "email=awa.diop@example.com")).status).toBe(200);
  });
});

describe("effacement des données d'un garant ou d'un prospect", () => {
  it("anonymise un garant d'un bail SIGNÉ (que l'on ne peut pas retirer), en gardant le bail et le plafond garanti", async () => {
    const manager = await createManager();
    const { garant } = await bailAvecGarant(manager.id, {}, { signedByTenantAt: new Date() });

    // Le retrait pur reste refusé : le nom figure sur le contrat signé.
    const retrait = await request(app).delete(`/api/contracts/${garant.contractId}/guarantors/${garant.id}`).set(authHeader(tokenFor(manager)));
    expect(retrait.status).toBe(409);

    const res = await anonymiser(tokenFor(manager), { email: "awa.diop@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ garants: 1, prospects: 0 });
    const [apres] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, garant.id));
    expect(apres).toMatchObject({ civility: null, firstName: "Garant", lastName: "anonymisé", phone: "", email: null, address: null, notes: null, maxAmount: 600000, contractId: garant.contractId });
  });

  it("anonymise un prospect sans supprimer sa demande : statut et annonce restent", async () => {
    const manager = await createManager();
    const { lead } = await prospect(manager.id, { status: "CONTACTED" });

    const res = await anonymiser(tokenFor(manager), { phone: "+221771112233" });

    expect(res.body).toEqual({ garants: 0, prospects: 1 });
    const [apres] = await testDb.select().from(listingLeads).where(eq(listingLeads.id, lead.id));
    expect(apres).toMatchObject({ prospectName: "Prospect anonymisé", prospectEmail: `anonyme-${lead.id}@supprime.invalid`, prospectPhone: "", message: null, notes: null, status: "CONTACTED", listingId: lead.listingId });
  });

  it("ne touche ni un autre garant de la même agence, ni une autre agence ; et un second appel répond 404", async () => {
    const manager = await createManager();
    const autre = await createManager();
    const { garant } = await bailAvecGarant(manager.id);
    const autreGarant = await bailAvecGarant(manager.id, { firstName: "Fama", lastName: "Seck", phone: "+221770003344", email: "fama@example.com" });
    const chezAutre = await bailAvecGarant(autre.id);

    await anonymiser(tokenFor(manager), { email: "awa.diop@example.com" });

    const [intact] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, autreGarant.garant.id));
    expect(intact.lastName).toBe("Seck");
    const [voisin] = await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, chezAutre.garant.id));
    expect(voisin.lastName).toBe("Diop");
    expect((await testDb.select().from(contractGuarantors).where(eq(contractGuarantors.id, garant.id)))[0].lastName).toBe("anonymisé");

    expect((await anonymiser(tokenFor(manager), { email: "awa.diop@example.com" })).status).toBe(404);
  });

  it("est réservé au propriétaire de l'agence et aux administrateurs d'équipe, et trace l'action", async () => {
    const manager = await createManager();
    await bailAvecGarant(manager.id);

    expect((await anonymiser(await tokenCollaborateur(manager, { teamRole: "AGENT" }), { email: "awa.diop@example.com" })).status).toBe(403);
    expect((await testDb.select().from(contractGuarantors))[0].lastName).toBe("Diop");

    expect((await anonymiser(tokenFor(manager), { email: "awa.diop@example.com" })).status).toBe(200);
    const [ligne] = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "personne.anonymize"));
    expect(ligne.details).toContain("1 garant(s)");
    expect(JSON.stringify(ligne)).not.toMatch(/awa|diop|example\.com/i);
  });
});
