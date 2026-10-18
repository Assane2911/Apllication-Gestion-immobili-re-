import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Régression : la création d'un locataire (ou d'un propriétaire) écrit dans le journal d'activité une ligne qui
 * embarque son NOM ET SON ADRESSE EMAIL (« Locataire ajouté : Awa Sow (awa@exemple.com) »). L'anonymisation
 * remplaçait le nom dans le journal, mais pas l'email : l'adresse — qui identifie la personne autant que son nom —
 * restait lisible jusqu'à la purge du journal, un an plus tard, alors que la personne avait exercé son droit à
 * l'effacement. Les entrées qui contiennent une ADRESSE, quelle qu'elle soit (un locataire change d'email au fil
 * des ans : les anciennes ne sont plus dans sa fiche), sont donc nettoyées aussi.
 */
describe("anonymisation — adresse email dans le journal d'activité", () => {
  const tousLesTextes = async (managerId: string) => {
    const lignes = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));
    return lignes.map((l: { entityLabel: string; details: string | null }) => `${l.entityLabel} ${l.details ?? ""}`).join("\n");
  };

  it("efface l'email d'un locataire du journal, comme son nom", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));
    const cree = await request(app)
      .post("/api/tenants")
      .set(h)
      .field("firstName", "Awa")
      .field("lastName", "Diagne")
      .field("phone", "+221778422993")
      .field("email", "awa.diagne@exemple.com");
    expect(cree.status).toBe(201);
    expect(await tousLesTextes(manager.id)).toContain("awa.diagne@exemple.com");

    // Un changement d'adresse : l'ancienne n'est plus dans la fiche, mais l'entrée de création la garde.
    await request(app).put(`/api/tenants/${cree.body.id}`).set(h).send({ email: "awa.nouvelle@exemple.com" }).expect(200);

    const res = await request(app).post(`/api/tenants/${cree.body.id}/anonymiser`).set(h);
    expect(res.status).toBe(200);

    const textes = await tousLesTextes(manager.id);
    expect(textes).not.toContain("awa.diagne@exemple.com");
    expect(textes).not.toContain("awa.nouvelle@exemple.com");
    expect(textes).not.toContain("Diagne");
    expect(textes).toContain("Locataire anonymisé");
  });

  it("efface l'email d'un propriétaire du journal, y compris celui de l'invitation au portail", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));
    const cree = await request(app)
      .post("/api/owners")
      .set(h)
      .send({ firstName: "Moussa", lastName: "Kane", phone: "+221778422993", email: "moussa.kane@exemple.com" });
    expect(cree.status).toBe(201);
    expect(await tousLesTextes(manager.id)).toContain("moussa.kane@exemple.com");

    const res = await request(app).post(`/api/owners/${cree.body.id}/anonymiser`).set(h);
    expect(res.status).toBe(200);

    const textes = await tousLesTextes(manager.id);
    expect(textes).not.toContain("moussa.kane@exemple.com");
    expect(textes).not.toContain("Kane");
    expect(textes).toContain("Propriétaire anonymisé");
  });

  it("n'efface pas les adresses des autres : seules les entrées de la personne anonymisée sont touchées", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));
    const a = await request(app).post("/api/tenants").set(h).field("firstName", "Awa").field("lastName", "Diagne").field("phone", "+221778422993").field("email", "awa@exemple.com");
    await request(app).post("/api/tenants").set(h).field("firstName", "Binta").field("lastName", "Sow").field("phone", "+221778422994").field("email", "binta@exemple.com");

    await request(app).post(`/api/tenants/${a.body.id}/anonymiser`).set(h).expect(200);

    const textes = await tousLesTextes(manager.id);
    expect(textes).toContain("binta@exemple.com");
    expect(textes).toContain("Binta Sow");
    expect(textes).not.toContain("awa@exemple.com");
  });
});
