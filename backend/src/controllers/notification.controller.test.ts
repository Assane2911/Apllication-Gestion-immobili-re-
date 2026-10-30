import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contractCotenants, contracts, invoices, issueReports, listingLeads, listings, properties, tenants } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  createPortalUser,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Le compte est créé en base : depuis le contrôle de révocation, un jeton
// forgé sur un identifiant inventé est refusé en 401 (voir authenticate).
// `userId` permet aux tests qui ont déjà un compte de portail (créé par
// createTenantPortalUser) de signer le jeton avec CE compte-là, quand
// l'identité de l'auteur du message compte pour ce qu'ils vérifient.
async function tenantToken(tenantId: string, userId?: string) {
  const user = userId ? { id: userId, role: "TENANT" as const } : await createPortalUser("TENANT");
  return authHeader(tokenFor(user, tenantId));
}

describe("GET /api/notifications", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app).get("/api/notifications").set(await tenantToken("t1"));
    expect(res.status).toBe(403);
  });

  it("renvoie une liste vide pour un gestionnaire sans rien à signaler", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.notifications).toHaveLength(0);
  });

  it("signale un message non lu du locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(await tenantToken(tenant.id, portalUser.id))
      .send({ content: "Bonjour, une question" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const messageNotif = res.body.notifications.find((n: { type: string }) => n.type === "message");
    expect(messageNotif).toBeTruthy();
    expect(messageNotif.severity).toBe("info");
    expect(messageNotif.title).toContain(tenant.firstName);
  });

  it("ne signale pas un message envoyé par le gestionnaire lui-même", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Message du gestionnaire" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  /**
   * Le filtre isRead=false est désormais porté par le SQL de la requête
   * (voir notification.controller.ts), pas par une boucle après coup : ce
   * test verrouille le même résultat qu'avant, message par message, plutôt
   * que la performance de la requête elle-même.
   */
  it("ne signale plus un message du locataire une fois que le gestionnaire l'a lu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(await tenantToken(tenant.id, portalUser.id))
      .send({ content: "Bonjour, une question" });

    // Ouvrir la conversation marque les messages reçus comme lus (voir
    // getMessagesByContract, message.controller.ts).
    await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenFor(manager)));

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("signale une facture en retard", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const invoiceNotif = res.body.notifications.find((n: { type: string }) => n.type === "invoice");
    expect(invoiceNotif).toBeTruthy();
    expect(invoiceNotif.severity).toBe("danger");
  });

  it("signale un incident ouvert mais pas un incident déjà résolu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Fuite d'eau",
      description: "Description",
      photoUrl: "issues/a.jpg",
      status: "OPEN",
    });
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Ampoule grillée",
      description: "Description",
      photoUrl: "issues/b.jpg",
      status: "RESOLVED",
    });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const issueNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "issue");
    expect(issueNotifs).toHaveLength(1);
    expect(issueNotifs[0].title).toContain("Fuite d'eau");
    expect(issueNotifs[0].severity).toBe("warning");
  });

  it("signale un contrat arrivant à échéance sous 14 jours mais pas un contrat lointain", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    const far = new Date();
    far.setDate(far.getDate() + 200);
    await createContract(property.id, tenant.id, { status: "ACTIVE", endDate: soon });
    const otherTenant = await createTenant(manager.id);
    await createContract(property.id, otherTenant.id, { status: "ACTIVE", endDate: far });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const contractNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "contract_ending");
    expect(contractNotifs).toHaveLength(1);
    expect(contractNotifs[0].severity).toBe("danger"); // <= 7 jours restants
  });

  it("isole les notifications par gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });

    const otherManager = await createManager();
    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

/**
 * Une demande de visite ou d'information déposée sur la vitrine publique est la SEULE écriture sans compte du service :
 * sans signalement, elle dormait dans le CRM tant que le gestionnaire n'ouvrait pas cette page.
 */
describe("GET /api/notifications — demandes reçues via la vitrine", () => {
  async function annonceAvecDemande(managerId: string, demande: Partial<typeof listingLeads.$inferInsert> = {}) {
    const [annonce] = await testDb
      .insert(listings)
      .values({ managerId, title: "Villa Ngor", description: "Belle villa", price: 250000, location: "Ngor, Dakar" })
      .returning();
    const [lead] = await testDb
      .insert(listingLeads)
      .values({
        listingId: annonce.id,
        managerId,
        prospectName: "Awa Diop",
        prospectEmail: "awa@example.com",
        prospectPhone: "+221771234567",
        requestType: "VISIT",
        ...demande,
      })
      .returning();
    return { annonce, lead };
  }

  it("signale une nouvelle demande, avec son auteur et l'annonce visée, et renvoie vers le CRM des demandes", async () => {
    const manager = await createManager();
    await annonceAvecDemande(manager.id);

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    const lead = res.body.notifications.find((n: { type: string }) => n.type === "lead");
    expect(lead).toMatchObject({ severity: "info", link: "/leads" });
    expect(lead.title).toContain("Awa Diop");
    expect(lead.title.toLowerCase()).toContain("visite");
    expect(lead.description).toContain("Villa Ngor");
  });

  it("ne signale que les demandes encore nouvelles, et seulement celles de SON agence", async () => {
    const manager = await createManager();
    const autre = await createManager();
    await annonceAvecDemande(manager.id, { status: "CONTACTED", prospectName: "Déjà contacté" });
    await annonceAvecDemande(manager.id, { status: "ARCHIVED", prospectName: "Archivé" });
    await annonceAvecDemande(autre.id, { prospectName: "Autre agence" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.body.notifications.filter((n: { type: string }) => n.type === "lead")).toHaveLength(0);
    const chezAutre = await request(app).get("/api/notifications").set(authHeader(tokenFor(autre)));
    expect(chezAutre.body.notifications.filter((n: { type: string }) => n.type === "lead")).toHaveLength(1);
  });
});

describe("GET /api/notifications/mine (locataire)", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/notifications/mine");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/notifications/mine").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("refuse l'accès à un compte TENANT qui n'est rattaché à aucune fiche locataire", async () => {
    const orphan = await createPortalUser("TENANT");
    const res = await request(app).get("/api/notifications/mine").set(authHeader(tokenFor(orphan)));
    expect(res.status).toBe(403);
  });

  it("renvoie une liste vide pour un locataire sans rien à signaler", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it("signale un message non lu envoyé par le gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Votre quittance est disponible" });

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const messageNotif = res.body.notifications.find((n: { type: string }) => n.type === "message");
    expect(messageNotif).toBeTruthy();
    expect(messageNotif.severity).toBe("info");
    expect(messageNotif.link).toBe("/portail/messages");
  });

  it("ne signale pas un message envoyé par le locataire lui-même", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(await tenantToken(tenant.id, portalUser.id))
      .send({ content: "Bonjour, une question" });

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("ne signale plus un message du gestionnaire une fois que le locataire l'a lu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Votre quittance est disponible" });

    // Ouvrir la conversation marque les messages reçus comme lus (voir
    // getMessagesByContract, message.controller.ts).
    await request(app).get(`/api/messages/${contract.id}`).set(await tenantToken(tenant.id, portalUser.id));

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("signale un loyer en retard", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const invoiceNotif = res.body.notifications.find((n: { type: string }) => n.type === "invoice");
    expect(invoiceNotif).toBeTruthy();
    expect(invoiceNotif.severity).toBe("danger");
    expect(invoiceNotif.title).toBe("Loyer en retard");
  });

  it("signale un loyer bientôt dû (sous 3 jours) mais pas un loyer encore lointain", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const far = new Date();
    far.setDate(far.getDate() + 20);
    await createInvoice(contract.id, { status: "PENDING", periodMonth: 1, dueDate: soon });
    await createInvoice(contract.id, { status: "PENDING", periodMonth: 2, dueDate: far });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const invoiceNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "invoice");
    expect(invoiceNotifs).toHaveLength(1);
    expect(invoiceNotifs[0].severity).toBe("warning");
    expect(invoiceNotifs[0].title).toBe("Loyer à régler bientôt");
  });

  it("ne signale pas une facture annulée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "CANCELLED" });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "invoice")).toBe(false);
  });

  it("signale un bail arrivant à échéance sous 14 jours mais pas un bail lointain", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    await createContract(property.id, tenant.id, { status: "ACTIVE", endDate: soon });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const contractNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "contract_ending");
    expect(contractNotifs).toHaveLength(1);
    expect(contractNotifs[0].severity).toBe("danger"); // <= 7 jours restants
    expect(contractNotifs[0].link).toBe("/portail");
  });

  it("isole les notifications par locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });

    const otherTenant = await createTenant(manager.id);
    await createContract(property.id, otherTenant.id);
    const otherPortalUser = await createTenantPortalUser(otherTenant);

    const res = await request(app)
      .get("/api/notifications/mine")
      .set(await tenantToken(otherTenant.id, otherPortalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe("GET /api/notifications/mine — colocataire", () => {
  it("signale au colocataire le loyer en retard et la fin de bail du bail qu'il occupe", async () => {
    // Les notifications ne cherchaient que les baux dont le locataire est TITULAIRE : un colocataire,
    // qui voit pourtant ce bail et ses factures dans son portail, n'était jamais prévenu.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const titulaire = await createTenant(manager.id);
    const coloc = await createTenant(manager.id);
    const bientot = new Date(Date.now() + 5 * 86_400_000);
    const contract = await createContract(property.id, titulaire.id, { status: "ACTIVE", endDate: bientot });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    const facture = await createInvoice(contract.id, { status: "LATE", dueDate: new Date(Date.now() - 86_400_000) });
    const etranger = await createTenant(manager.id);

    const res = await request(app).get("/api/notifications/mine").set(authHeader(await tokenLocataire(coloc.id)));

    expect(res.status).toBe(200);
    const ids = res.body.notifications.map((n: { id: string }) => n.id);
    expect(ids).toContain(`invoice-${facture.id}`);
    expect(ids).toContain(`contract-${contract.id}`);
    // Un locataire étranger au bail n'en voit rien.
    const autre = await request(app).get("/api/notifications/mine").set(authHeader(await tokenLocataire(etranger.id)));
    expect(autre.body.notifications).toEqual([]);
  });
});

/**
 * Régression : la cloche envoie TOUTES les clés de notifications qu'elle affiche (« vues » à l'ouverture,
 * « lues » au clic sur « Tout marquer comme lu »), mais le serveur refusait au-delà de 200 clés (400). Une
 * agence qui a plus de 200 notifications — un portefeuille de quelques centaines de baux avec des loyers en
 * retard — ne pouvait donc plus jamais éteindre son badge : chaque ouverture de la cloche échouait en silence et
 * le compteur revenait.
 */
describe("POST /api/notifications/seen et /read — beaucoup de notifications", () => {
  async function agenceAvecNotifications(nombre: number) {
    const manager = await createManager();
    // Un bail par facture : les loyers en retard d'un même bail sont regroupés en une seule notification.
    const biens = await testDb
      .insert(properties)
      .values(Array.from({ length: nombre }, (_, i) => ({ managerId: manager.id, title: `Bien ${i}`, address: "1 rue du Test", surface: 50, rent: 500 })))
      .returning();
    const locataires = await testDb
      .insert(tenants)
      .values(Array.from({ length: nombre }, (_, i) => ({ managerId: manager.id, firstName: "Jean", lastName: `Dupont${i}`, phone: "0600000000", email: `loc${i}-${manager.id}@test.local` })))
      .returning();
    const baux = await testDb
      .insert(contracts)
      .values(biens.map((b: { id: string }, i: number) => ({ propertyId: b.id, tenantId: locataires[i].id, rent: 500, deposit: 1000, startDate: new Date(2026, 0, 1), endDate: new Date(2027, 0, 1) })))
      .returning();
    await testDb.insert(invoices).values(
      baux.map((bail: { id: string }, i: number) => ({
        contractId: bail.id,
        periodMonth: 1,
        periodYear: 3000 + i,
        amount: 500,
        status: "LATE" as const,
        dueDate: new Date(2026, 0, 1 + (i % 28)),
      }))
    );
    return { h: authHeader(tokenFor(manager)) };
  }

  it("marque comme vues plus de 200 notifications d'un coup, et éteint le badge", async () => {
    const { h } = await agenceAvecNotifications(250);
    const avant = await request(app).get("/api/notifications").set(h);
    expect(avant.body.unseenCount).toBe(250);

    const res = await request(app)
      .post("/api/notifications/seen")
      .set(h)
      .send({ keys: avant.body.notifications.map((n: { key: string }) => n.key) });

    expect(res.status).toBe(200);
    const apres = await request(app).get("/api/notifications").set(h);
    expect(apres.body.unseenCount).toBe(0);
  });

  it("marque comme lues plus de 200 notifications d'un coup (« Tout marquer comme lu »)", async () => {
    const { h } = await agenceAvecNotifications(250);
    const avant = await request(app).get("/api/notifications").set(h);

    const res = await request(app)
      .post("/api/notifications/read")
      .set(h)
      .send({ keys: avant.body.notifications.map((n: { key: string }) => n.key) });

    expect(res.status).toBe(200);
    const apres = await request(app).get("/api/notifications").set(h);
    expect(apres.body.unreadCount).toBe(0);
  });
});

/**
 * Un bail dont neuf mois de loyer sont impayés remplissait la cloche de neuf lignes identiques. Les loyers en retard d'un
 * même bail sont maintenant regroupés en une seule notification, avec les échéances et le reste dû ; un seul loyer en
 * retard garde son texte d'avant.
 */
describe("GET /api/notifications — loyers en retard regroupés par bail", () => {
  async function bailAvecRetards(nombreDeMois: number, extra: Record<string, unknown> = {}) {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "CHAMBRE 1" });
    const tenant = await createTenant(manager.id, { firstName: "El Adji", lastName: "Niass" });
    const contract = await createContract(property.id, tenant.id);
    for (let mois = 1; mois <= nombreDeMois; mois++) {
      await createInvoice(contract.id, {
        periodMonth: mois,
        periodYear: 2026,
        amount: 35000,
        currency: "XOF",
        status: "LATE",
        dueDate: new Date(2026, mois - 1, 28),
        ...extra,
      });
    }
    return { manager, contract, h: authHeader(tokenFor(manager)) };
  }
  const lire = (h: Record<string, string>, langue?: string) => request(app).get("/api/notifications").set(h).set(langue ? { "Accept-Language": langue } : {});

  it("neuf loyers impayés du même bail donnent une seule ligne, avec le total restant dû", async () => {
    const { h } = await bailAvecRetards(9);

    const res = await lire(h);

    expect(res.body.count).toBe(1);
    expect(res.body.unseenCount).toBe(1);
    const [n] = res.body.notifications;
    expect(n.title).toBe("9 loyers en retard — El Adji Niass");
    expect(n.description).toContain("CHAMBRE 1");
    expect(n.description).toMatch(/315[\s  ]000/);
    expect(n.severity).toBe("danger");
    expect(n.link).toBe("/invoices");
  });

  it("un seul loyer en retard garde son texte et sa clé d'avant : une notification déjà vue ne réapparaît pas", async () => {
    const { h } = await bailAvecRetards(1);
    const { body } = await lire(h);
    expect(body.notifications[0].title).toBe("Loyer en retard — El Adji Niass");
    expect(body.notifications[0].id).toMatch(/^invoice-/);
  });

  it("un nouveau mois qui passe en retard rallume la ligne, même déjà vue", async () => {
    const { h, contract } = await bailAvecRetards(3);
    const avant = await lire(h);
    await request(app).post("/api/notifications/seen").set(h).send({ keys: avant.body.notifications.map((n: { key: string }) => n.key) });
    expect((await lire(h)).body.unseenCount).toBe(0);

    await createInvoice(contract.id, { periodMonth: 4, periodYear: 2026, amount: 35000, currency: "XOF", status: "LATE", dueDate: new Date(2026, 3, 28) });

    const apres = await lire(h);
    expect(apres.body.count).toBe(1);
    expect(apres.body.unseenCount).toBe(1);
    expect(apres.body.notifications[0].title).toBe("4 loyers en retard — El Adji Niass");
  });

  it("deux baux différents restent deux lignes", async () => {
    const { manager, h } = await bailAvecRetards(2);
    const property = await createProperty(manager.id, { title: "CHAMBRE 2" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop" });
    const autre = await createContract(property.id, tenant.id);
    await createInvoice(autre.id, { status: "LATE", amount: 20000, currency: "XOF" });

    const res = await lire(h);

    expect(res.body.count).toBe(2);
    expect(res.body.notifications.map((n: { title: string }) => n.title).sort()).toEqual(["2 loyers en retard — El Adji Niass", "Loyer en retard — Awa Diop"]);
  });

  it("le total est le reste dû : un paiement partiel est déduit, un loyer payé n'est pas compté", async () => {
    const { h, contract } = await bailAvecRetards(2, { amountPaid: 10000 });
    await createInvoice(contract.id, { periodMonth: 3, periodYear: 2026, amount: 35000, currency: "XOF", status: "PAID", amountPaid: 35000, dueDate: new Date(2026, 2, 28) });

    const res = await lire(h);

    expect(res.body.notifications[0].title).toBe("2 loyers en retard — El Adji Niass");
    expect(res.body.notifications[0].description).toMatch(/50[\s  ]000/); // 2 × (35 000 − 10 000)
  });

  it("les devises d'un même bail ne se mélangent pas dans le total", async () => {
    const { h, contract } = await bailAvecRetards(1);
    await createInvoice(contract.id, { periodMonth: 2, periodYear: 2026, amount: 100, currency: "EUR", status: "LATE", dueDate: new Date(2026, 1, 28) });

    const { body } = await lire(h);

    expect(body.notifications[0].description).toMatch(/35[\s  ]000/);
    expect(body.notifications[0].description).toContain("+");
    expect(body.notifications[0].description).toContain("€");
  });

  it("le texte suit la langue de la personne", async () => {
    const { h } = await bailAvecRetards(3);
    const en = (await lire(h, "en")).body.notifications[0];
    expect(en.title).toBe("3 late rent payments — El Adji Niass");
    const es = (await lire(h, "es")).body.notifications[0];
    expect(es.title).toBe("3 alquileres atrasados — El Adji Niass");
    const pt = (await lire(h, "pt")).body.notifications[0];
    expect(pt.title).toBe("3 rendas em atraso — El Adji Niass");
  });

  it("côté locataire, les loyers en retard restent détaillés : le locataire doit les voir un par un", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026, status: "LATE", dueDate: new Date(2026, 0, 28) });
    await createInvoice(contract.id, { periodMonth: 2, periodYear: 2026, status: "LATE", dueDate: new Date(2026, 1, 28) });
    const portail = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body.notifications.filter((n: { type: string }) => n.type === "invoice")).toHaveLength(2);
    expect(portail.id).toBeTruthy();
  });
});
