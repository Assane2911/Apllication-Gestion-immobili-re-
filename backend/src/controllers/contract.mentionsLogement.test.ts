import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { lireMentions, serialiserMentions } from "../utils/mentionsLogement";

/**
 * Mentions du logement du contrat type de bail français (décret n° 2015-587) : DPE, identifiant fiscal, période de
 * construction, chauffage, loyers de référence. Toutes facultatives, imprimées sur le bail quand elles sont renseignées,
 * verrouillées après la signature du locataire comme le reste du contenu du bail.
 */
async function contexte() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const corps = (extra: Record<string, unknown> = {}) => ({
    propertyId: property.id,
    tenantId: tenant.id,
    rent: 800,
    deposit: 800,
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2029-01-01",
    ...extra,
  });
  return { manager, h: authHeader(tokenFor(manager)), corps };
}

const MENTIONS = {
  dpe: "D",
  identifiantFiscal: "  123456789012  ",
  periodeConstruction: "Avant 1946",
  chauffage: "Individuel, gaz",
  loyerReference: 24.5,
  loyerReferenceMajore: 29.4,
  dernierLoyer: 760,
};

describe("mentions du logement — enregistrement et relecture", () => {
  it("sans mention : aucune ligne sur le bail et null en réponse (comportement des contrats d'avant)", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps());
    expect(res.status).toBe(201);
    expect(res.body.housingMentions).toBeNull();
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).not.toContain("diagnostic de performance énergétique");
    expect(bail.text).not.toContain("Identifiant fiscal");
  });

  it("enregistre les mentions, les rend en objet et les imprime sur le bail", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: MENTIONS }));
    expect(res.status).toBe(201);
    expect(res.body.housingMentions).toEqual({ ...MENTIONS, identifiantFiscal: "123456789012" });

    const lu = await request(app).get(`/api/contracts/${res.body.id}`).set(h);
    expect(lu.body.housingMentions).toMatchObject({ dpe: "D", periodeConstruction: "Avant 1946" });
    const liste = await request(app).get("/api/contracts").set(h);
    expect(liste.body.items[0].housingMentions).toMatchObject({ dpe: "D", chauffage: "Individuel, gaz" });

    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).toContain("Classe du diagnostic de performance énergétique (DPE) :</strong> D");
    expect(bail.text).toContain("Identifiant fiscal du logement :</strong> 123456789012");
    expect(bail.text).toContain("Période de construction :</strong> Avant 1946");
    expect(bail.text).toContain("Chauffage et eau chaude :</strong> Individuel, gaz");
    expect(bail.text).toContain("Loyer de référence (par m²)");
    expect(bail.text).toContain("Montant du dernier loyer acquitté par le précédent locataire");
  });

  it("n'imprime que les mentions renseignées", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: { dpe: "B" } }));
    expect(res.body.housingMentions).toEqual({ dpe: "B" });
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).toContain("(DPE) :</strong> B");
    expect(bail.text).not.toContain("Identifiant fiscal");
    expect(bail.text).not.toContain("Loyer de référence");
  });

  it("des mentions vides sont enregistrées comme absentes", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: { identifiantFiscal: "   ", chauffage: "" } }));
    expect(res.status).toBe(201);
    expect(res.body.housingMentions).toBeNull();
    const [ligne] = await testDb.select().from(contracts).where(eq(contracts.id, res.body.id));
    expect(ligne.housingMentions).toBeNull();
  });

  it("échappe le texte saisi sur le bail HTML", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: { chauffage: "<script>alert(1)</script>" } }));
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).not.toContain("<script>alert(1)</script>");
    expect(bail.text).toContain("&lt;script&gt;");
  });

  it("refuse une classe DPE inconnue, un texte trop long et un montant négatif ou trop élevé", async () => {
    const { h, corps } = await contexte();
    for (const mauvais of [
      { dpe: "H" },
      { identifiantFiscal: "x".repeat(41) },
      { periodeConstruction: "x".repeat(61) },
      { chauffage: "x".repeat(101) },
      { dernierLoyer: -1 },
      { loyerReference: 1e15 },
    ]) {
      const res = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: mauvais }));
      expect(res.status, JSON.stringify(mauvais)).toBe(400);
    }
  });
});

describe("mentions du logement — modification, verrou et renouvellement", () => {
  it("se modifie tant que le locataire n'a pas signé, puis est verrouillé", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps());
    const maj = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ housingMentions: { dpe: "C", identifiantFiscal: "ABC" } });
    expect(maj.status).toBe(200);
    expect(maj.body.housingMentions).toEqual({ dpe: "C", identifiantFiscal: "ABC" });

    const efface = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ housingMentions: null });
    expect(efface.body.housingMentions).toBeNull();
    await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ housingMentions: { dpe: "C" } });

    await testDb.update(contracts).set({ signedByTenantAt: new Date() }).where(eq(contracts.id, cree.body.id));
    const verrou = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ housingMentions: { dpe: "A" } });
    expect(verrou.status).toBe(409);
    expect(verrou.body.code).toBe("LEASE_SIGNED_LOCKED");
    const [relu] = await testDb.select().from(contracts).where(eq(contracts.id, cree.body.id));
    expect(lireMentions(relu.housingMentions)).toEqual({ dpe: "C" });
  });

  it("une modification sans rapport ne touche pas aux mentions", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: { dpe: "E" } }));
    const maj = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ terms: "Animaux interdits" });
    expect(maj.status).toBe(200);
    expect(maj.body.housingMentions).toEqual({ dpe: "E" });
  });

  it("le renouvellement garde les mentions", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps({ housingMentions: { dpe: "D", identifiantFiscal: "999" } }));
    const res = await request(app).post(`/api/contracts/${cree.body.id}/renew`).set(h).send({ months: 36 });
    expect(res.status).toBe(201);
    expect(res.body.housingMentions).toEqual({ dpe: "D", identifiantFiscal: "999" });
  });
});

describe("mentions du logement — valeur stockée", () => {
  it("serialiserMentions n'écrit que les mentions renseignées et renvoie null quand il n'y en a aucune", () => {
    expect(serialiserMentions(undefined)).toBeNull();
    expect(serialiserMentions(null)).toBeNull();
    expect(serialiserMentions({})).toBeNull();
    expect(serialiserMentions({ dpe: "A", chauffage: undefined })).toBe('{"dpe":"A"}');
  });

  it("lireMentions rend null pour un JSON absent, illisible ou hors schéma, sans lever", () => {
    expect(lireMentions(null)).toBeNull();
    expect(lireMentions("")).toBeNull();
    expect(lireMentions("pas du json")).toBeNull();
    expect(lireMentions('{"dpe":"Z"}')).toBeNull();
    expect(lireMentions("{}")).toBeNull();
    expect(lireMentions('{"dpe":"F"}')).toEqual({ dpe: "F" });
  });
});
