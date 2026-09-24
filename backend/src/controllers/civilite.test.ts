import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { tenants } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { rentDueReminderEmail } from "../services/email.service";
import { rentDueReminderWhatsappVariables } from "../services/whatsapp.service";
import { nomAvecCivilite } from "../utils/nom";

/**
 * La civilité existe pour une seule raison : que les documents s'adressent à
 * la personne — « Monsieur ALIOU THIAM » sur une quittance, dans un bail, en
 * tête d'un rappel. Une colonne que rien ne lirait serait précisément la
 * collecte inutile que la minimisation des données proscrit.
 *
 * Ces tests vérifient donc les deux bouts : qu'elle s'enregistre, et qu'elle
 * ressort là où elle sert. Et qu'elle reste facultative : un propriétaire peut
 * être une société, une personne peut ne pas vouloir en donner.
 */
describe("Civilité d'un locataire", () => {
  it("s'enregistre à la création et se relit sur la fiche", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({
        civility: "M",
        firstName: "ALIOU",
        lastName: "THIAM",
        phone: "+221778422993",
        email: "aliou@test.local",
      });

    expect(res.status).toBe(201);
    expect(res.body.civility).toBe("M");
  });

  it("reste facultative : une fiche sans civilité se crée normalement", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Awa", lastName: "Diallo", phone: "+221771234567", email: "awa@test.local" });

    expect(res.status).toBe(201);
    expect(res.body.civility).toBeNull();
  });

  it("refuse une civilité que le serveur ne saurait pas écrire", async () => {
    // Le serveur n'écrit que « Monsieur » et « Madame ». Accepter « Dr » ou
    // « Me » remplirait la base de valeurs qu'aucun document ne sait rendre,
    // et le gestionnaire ne l'apprendrait qu'en relisant un bail.
    const manager = await createManager();

    const res = await request(app)
      .post("/api/tenants")
      .set(authHeader(tokenFor(manager)))
      .send({ civility: "DR", firstName: "X", lastName: "Y", phone: "+221771234567", email: "x@test.local" });

    expect(res.status).toBe(400);
  });

  it("apparaît dans l'export RGPD, comme toute donnée détenue sur la personne", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { civility: "MME", firstName: "Awa", lastName: "Diallo" });

    const res = await request(app)
      .get(`/api/tenants/${tenant.id}/export`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.locataire.civility).toBe("MME");
  });

  it("disparaît à l'anonymisation, avec le reste de ce qui identifie", async () => {
    // Sans cette ligne, l'effacement laisserait derrière lui une information
    // sur une personne dont on vient d'effacer le nom.
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { civility: "M" });

    const res = await request(app)
      .post(`/api/tenants/${tenant.id}/anonymiser`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(apres.civility).toBeNull();
  });
});

describe("La civilité dans ce que le locataire reçoit", () => {
  it("ouvre l'email et le message WhatsApp par « Monsieur » suivi du nom", async () => {
    // Les deux messages partent du même rappel : ils doivent s'adresser à la
    // personne de la même façon.
    const personne = { civility: "M", firstName: "ALIOU", lastName: "THIAM" };
    const nom = nomAvecCivilite(personne);
    expect(nom).toBe("Monsieur ALIOU THIAM");

    const commun = {
      tenantName: nom,
      propertyTitle: "APPT MEUBLÉ",
      amount: 35000,
      currency: "XOF",
      periodMonth: 9,
      periodYear: 2026,
      frontendUrl: "https://app.test",
    };

    const { html } = rentDueReminderEmail({ ...commun, dueDate: new Date(2026, 8, 24) });
    expect(html).toContain("Monsieur ALIOU THIAM");
    expect(rentDueReminderWhatsappVariables(commun)["1"]).toBe("Monsieur ALIOU THIAM");
  });

  it("nomme le locataire sans civilité dans la quittance quand elle n'est pas renseignée", async () => {
    // La quittance reste un document valable : c'est ce qui autorise le champ
    // à rester facultatif plutôt que de le devenir en pratique.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diallo" });
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PAID" });

    const res = await request(app)
      .get(`/api/documents/receipt/${invoice.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const contenu = res.text ?? res.body?.toString?.() ?? "";
    expect(contenu).toContain("Awa Diallo");
    expect(contenu).not.toContain("Monsieur");
    expect(contenu).not.toContain("undefined");
  });
});
