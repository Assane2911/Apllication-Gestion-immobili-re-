import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import {
  contracts,
  invoices,
  issueReports,
  listingLeads,
  listings,
  messages,
  notificationVues,
  ownerMessages,
  properties,
  tenants,
} from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createPortalUser,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { formaterMontant } from "../utils/montant";
import { NOTIFICATIONS_MAX } from "./notification.controller";

/**
 * Cas limites du centre de notifications : contenu exact de chaque notification (identifiant, texte, lien, date, gravité), frontières
 * de dates à la milliseconde, agences isolées les unes des autres, fils de messages par locataire, regroupement des loyers en retard,
 * état « vu / lu » par personne et plafond de la liste.
 */
const NOW = new Date(2026, 5, 15, 12, 0, 0, 0).getTime(); // 15 juin 2026, midi
const JOUR = 86_400_000;
const HEURE = 3_600_000;
const ilya = (ms: number) => new Date(NOW - ms);
const dans = (ms: number) => new Date(NOW + ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

const entete = (m: { id: string }) => authHeader(tokenFor(m as never));
const lire = (h: Record<string, string>, langue?: string) => {
  const r = request(app).get("/api/notifications").set(h);
  return langue ? r.set("Accept-Language", langue) : r;
};

let compteur = 0;
async function message(contractId: string, senderId: string, extra: Partial<typeof messages.$inferInsert>) {
  await testDb.insert(messages).values({ contractId, senderId, senderRole: "TENANT", content: "Bonjour", ...extra });
}
async function facture(contractId: string, extra: Partial<typeof invoices.$inferInsert>) {
  compteur += 1;
  return createInvoice(contractId, { periodMonth: 1, periodYear: 1500 + compteur, status: "LATE", ...extra });
}

/** Une agence qui a un exemplaire de chaque sorte de notification. `suffixe` rend les noms reconnaissables. */
async function agenceComplete(suffixe = "") {
  const manager = await createManager();
  const bien = await createProperty(manager.id, { title: `Villa Ngor${suffixe}` });
  const awa = await createTenant(manager.id, { firstName: "Awa", lastName: `Diop${suffixe}` });
  const fatou = await createTenant(manager.id, { firstName: "Fatou", lastName: `Ba${suffixe}` });
  const bail = await createContract(bien.id, awa.id, { status: "ACTIVE", endDate: dans(300 * JOUR) });

  // Fil d'Awa (titulaire) : un message rattaché, un message d'avant le rattrapage (sans locataire), plus les lignes à ignorer.
  await message(bail.id, manager.id, { tenantId: awa.id, createdAt: ilya(3 * HEURE) });
  await message(bail.id, manager.id, { tenantId: null, createdAt: ilya(1 * HEURE) });
  await message(bail.id, manager.id, { tenantId: awa.id, isRead: true, createdAt: dans(0) });
  await message(bail.id, manager.id, { tenantId: awa.id, senderRole: "MANAGER", createdAt: dans(0) });
  // Fil de Fatou (colocataire) : son propre fil, avec sa propre notification.
  await message(bail.id, manager.id, { tenantId: fatou.id, createdAt: ilya(2 * HEURE) });

  // Propriétaires : société avec des espaces autour, société blanche, pas de société.
  const sci = await createOwner(manager.id, { firstName: "Moussa", lastName: "Sow", companyName: "  SCI Soleil  " });
  const blanc = await createOwner(manager.id, { firstName: "Ibou", lastName: "Fall", companyName: "   " });
  const seul = await createOwner(manager.id, { firstName: "Mame", lastName: "Gueye", companyName: null });
  const messageProprietaire = (ownerId: string, extra: Partial<typeof ownerMessages.$inferInsert>) =>
    testDb.insert(ownerMessages).values({ ownerId, managerId: manager.id, senderId: manager.id, senderRole: "OWNER", content: "Bonjour", ...extra });
  await messageProprietaire(sci.id, { createdAt: ilya(5 * HEURE) });
  await messageProprietaire(sci.id, { createdAt: ilya(6 * HEURE) });
  await messageProprietaire(sci.id, { createdAt: ilya(7 * HEURE) });
  await messageProprietaire(sci.id, { createdAt: dans(0), isRead: true });
  await messageProprietaire(sci.id, { createdAt: dans(0), senderRole: "MANAGER" });
  await messageProprietaire(blanc.id, { createdAt: ilya(8 * HEURE) });
  await messageProprietaire(seul.id, { createdAt: ilya(9 * HEURE) });

  // Loyers en retard : deux échéances (insérées dans le désordre) pour un bail, une seule pour un autre, deux devises pour un troisième.
  await facture(bail.id, { amount: 500, amountPaid: 100, dueDate: new Date(2026, 2, 5) });
  await facture(bail.id, { amount: 500, amountPaid: 0, dueDate: new Date(2026, 0, 5) });
  const bien2 = await createProperty(manager.id, { title: `Studio Plateau${suffixe}` });
  const bail2 = await createContract(bien2.id, fatou.id, { status: "ACTIVE", endDate: dans(300 * JOUR) });
  const seule = await facture(bail2.id, { amount: 400, dueDate: new Date(2026, 1, 5) });
  const bien3 = await createProperty(manager.id, { title: `Maison Almadies${suffixe}` });
  const moussa = await createTenant(manager.id, { firstName: "Moussa", lastName: `Ndiaye${suffixe}` });
  const bail3 = await createContract(bien3.id, moussa.id, { status: "ACTIVE", endDate: dans(300 * JOUR) });
  await facture(bail3.id, { amount: 500, currency: "EUR", dueDate: new Date(2026, 3, 1) });
  await facture(bail3.id, { amount: 3000, currency: "XOF", dueDate: new Date(2026, 3, 10) });
  await facture(bail3.id, { amount: 999, status: "PENDING", dueDate: new Date(2026, 3, 20) });

  // Signalements : un ouvert, un résolu.
  const [incident] = await testDb
    .insert(issueReports)
    .values({ contractId: bail.id, tenantId: awa.id, title: "Fuite d'eau", description: "Cuisine", photoUrl: "issues/a.jpg", status: "OPEN", createdAt: ilya(3 * JOUR) })
    .returning();
  await testDb
    .insert(issueReports)
    .values({ contractId: bail.id, tenantId: awa.id, title: "Ampoule", description: "Salon", photoUrl: "issues/b.jpg", status: "RESOLVED", createdAt: dans(0) });

  // Demandes de la vitrine : une visite et une information nouvelles, une déjà contactée.
  const [annonce] = await testDb.insert(listings).values({ managerId: manager.id, title: `Annonce ${suffixe}`, description: "Belle villa", price: 250000, location: "Dakar" }).returning();
  const demande = async (extra: Partial<typeof listingLeads.$inferInsert>) =>
    (await testDb.insert(listingLeads).values({ listingId: annonce.id, managerId: manager.id, prospectName: "Prospect", prospectEmail: "p@x.test", prospectPhone: "+221770000000", requestType: "VISIT", ...extra }).returning())[0];
  const visite = await demande({ prospectName: "Awa Visiteuse", requestType: "VISIT", createdAt: ilya(4 * JOUR) });
  const information = await demande({ prospectName: "Ibou Curieux", requestType: "INFO", createdAt: ilya(6 * JOUR) });
  await demande({ prospectName: "Déjà vue", status: "CONTACTED", createdAt: dans(0) });

  // Baux qui se terminent : maintenant pile, dans 6,2 / 7,2 / 14 jours ; hors fenêtre ou terminés : ignorés.
  const finissant = async (fin: Date, extra: Partial<typeof contracts.$inferInsert> = {}) => {
    const b = await createProperty(manager.id, { title: `Bien fin${suffixe}` });
    const t = await createTenant(manager.id, { firstName: "Locataire", lastName: `Fin${compteur++}` });
    return { ...(await createContract(b.id, t.id, { status: "ACTIVE", endDate: fin, ...extra })), titre: b.title, nom: `Locataire Fin${compteur - 1}` };
  };
  const fins = {
    maintenant: await finissant(dans(0)),
    six: await finissant(dans(6.2 * JOUR)),
    sept: await finissant(dans(7.2 * JOUR)),
    quatorze: await finissant(dans(14 * JOUR)),
  };
  await finissant(dans(14 * JOUR + 1000));
  await finissant(dans(-1000));
  await finissant(dans(5 * JOUR), { status: "ENDED" });

  return { manager, bail, bail2, bail3, awa, fatou, sci, blanc, seul, incident, visite, information, seule, fins, h: entete(manager) };
}

describe("centre de notifications du gestionnaire : contenu exact", () => {
  it("chaque notification porte son identifiant, son type, sa gravité, son texte, son lien et sa date, triées de la plus récente à la plus ancienne", async () => {
    const a = await agenceComplete();
    const f = a.fins;

    const res = await lire(a.h);

    expect(res.status).toBe(200);
    const total = `${formaterMontant(500, "EUR")} + ${formaterMontant(3000, "XOF")}`;
    const attendu = [
      { id: `contract-${f.quatorze.id}`, type: "contract_ending", severity: "warning", title: "Contrat se terminant dans 14 jours", description: `${f.quatorze.titre} · ${f.quatorze.nom}`, link: "/contracts", createdAt: dans(14 * JOUR).toISOString() },
      { id: `contract-${f.sept.id}`, type: "contract_ending", severity: "warning", title: "Contrat se terminant dans 8 jours", description: `${f.sept.titre} · ${f.sept.nom}`, link: "/contracts", createdAt: dans(7.2 * JOUR).toISOString() },
      { id: `contract-${f.six.id}`, type: "contract_ending", severity: "danger", title: "Contrat se terminant dans 7 jours", description: `${f.six.titre} · ${f.six.nom}`, link: "/contracts", createdAt: dans(6.2 * JOUR).toISOString() },
      { id: `contract-${f.maintenant.id}`, type: "contract_ending", severity: "danger", title: "Contrat se terminant dans 0 jour", description: `${f.maintenant.titre} · ${f.maintenant.nom}`, link: "/contracts", createdAt: dans(0).toISOString() },
      { id: `message-${a.bail.id}`, type: "message", severity: "info", title: "2 nouveaux messages de Awa Diop", description: "Villa Ngor", link: "/messages", createdAt: ilya(1 * HEURE).toISOString() },
      { id: `message-${a.bail.id}-${a.fatou.id}`, type: "message", severity: "info", title: "1 nouveau message de Fatou Ba", description: "Villa Ngor", link: "/messages", createdAt: ilya(2 * HEURE).toISOString() },
      { id: `owner-message-${a.sci.id}`, type: "message", severity: "info", title: "3 nouveaux messages du propriétaire SCI Soleil", description: "Discussion avec le propriétaire", link: "/messages/proprietaires", createdAt: ilya(5 * HEURE).toISOString() },
      { id: `owner-message-${a.blanc.id}`, type: "message", severity: "info", title: "1 nouveau message du propriétaire Ibou Fall", description: "Discussion avec le propriétaire", link: "/messages/proprietaires", createdAt: ilya(8 * HEURE).toISOString() },
      { id: `owner-message-${a.seul.id}`, type: "message", severity: "info", title: "1 nouveau message du propriétaire Mame Gueye", description: "Discussion avec le propriétaire", link: "/messages/proprietaires", createdAt: ilya(9 * HEURE).toISOString() },
      { id: `issue-${a.incident.id}`, type: "issue", severity: "warning", title: "Signalement : Fuite d'eau", description: "Villa Ngor · Awa Diop", link: "/issues", createdAt: ilya(3 * JOUR).toISOString() },
      { id: `lead-${a.visite.id}`, type: "lead", severity: "info", title: "Demande de visite — Awa Visiteuse", description: "Annonce ", link: "/leads", createdAt: ilya(4 * JOUR).toISOString() },
      { id: `lead-${a.information.id}`, type: "lead", severity: "info", title: "Demande d'information — Ibou Curieux", description: "Annonce ", link: "/leads", createdAt: ilya(6 * JOUR).toISOString() },
      { id: `invoices-${a.bail3.id}`, type: "invoice", severity: "danger", title: "2 loyers en retard — Moussa Ndiaye", description: `Maison Almadies · échéances du 01/04/2026 au 10/04/2026 · ${total} restant dû`, link: "/invoices", createdAt: new Date(2026, 3, 10).toISOString() },
      { id: `invoices-${a.bail.id}`, type: "invoice", severity: "danger", title: "2 loyers en retard — Awa Diop", description: `Villa Ngor · échéances du 05/01/2026 au 05/03/2026 · ${formaterMontant(900, "EUR")} restant dû`, link: "/invoices", createdAt: new Date(2026, 2, 5).toISOString() },
      { id: `invoice-${a.seule.id}`, type: "invoice", severity: "danger", title: "Loyer en retard — Fatou Ba", description: "Studio Plateau · échéance du 05/02/2026", link: "/invoices", createdAt: new Date(2026, 1, 5).toISOString() },
    ];
    expect(res.body.notifications.map(({ key: _k, seen: _s, read: _r, ...n }: Record<string, unknown>) => n)).toEqual(attendu);
    expect(res.body.count).toBe(attendu.length);
  });

  it("le texte suit la langue de la personne : dates en toutes lettres, montants à l'anglaise", async () => {
    const a = await agenceComplete();

    const res = await lire(a.h, "en");

    const ligne = (id: string) => res.body.notifications.find((n: { id: string }) => n.id === id);
    expect(ligne(`invoices-${a.bail.id}`).description).toBe(`Villa Ngor · due from January 5, 2026 to March 5, 2026 · ${formaterMontant(900, "EUR", "en")} outstanding`);
    expect(ligne(`invoices-${a.bail3.id}`).description).toContain(`${formaterMontant(500, "EUR", "en")} + ${formaterMontant(3000, "XOF", "en")} outstanding`);
    expect(ligne(`invoice-${a.seule.id}`).description).toBe("Studio Plateau · due February 5, 2026");
    expect(ligne(`invoice-${a.seule.id}`).title).toBe("Late rent — Fatou Ba");
  });

  it("une autre agence n'a ni les notifications de celle-ci, ni l'inverse", async () => {
    const a = await agenceComplete();
    const b = await agenceComplete(" B");

    const chezA = (await lire(a.h)).body.notifications.map((n: { id: string }) => n.id);
    const chezB = (await lire(b.h)).body.notifications.map((n: { id: string }) => n.id);

    expect(chezA).toHaveLength(15);
    expect(chezB).toHaveLength(15);
    expect(chezA.filter((id: string) => chezB.includes(id))).toEqual([]);
  });

  it("à partir d'une agence qui n'a que des notifications lues ou traitées, la liste est vide", async () => {
    const manager = await createManager();
    const bien = await createProperty(manager.id);
    const t = await createTenant(manager.id);
    const bail = await createContract(bien.id, t.id, { status: "ACTIVE", endDate: dans(300 * JOUR) });
    await message(bail.id, manager.id, { isRead: true });
    await facture(bail.id, { status: "PAID" });

    const res = await lire(entete(manager));

    expect(res.body).toEqual({ notifications: [], count: 0, unseenCount: 0, unreadCount: 0 });
  });
});

describe("centre de notifications du locataire : contenu exact", () => {
  async function bailLocataire() {
    const manager = await createManager();
    const bien = await createProperty(manager.id, { title: "Villa Ngor" });
    const awa = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop" });
    const coloc = await createTenant(manager.id, { firstName: "Fatou", lastName: "Ba" });
    const bail = await createContract(bien.id, awa.id, { status: "ACTIVE", endDate: dans(6.2 * JOUR) });
    const bien2 = await createProperty(manager.id, { title: "Autre bien" });
    const bail2 = await createContract(bien2.id, awa.id, { status: "ACTIVE", endDate: dans(13.5 * JOUR) });
    // Ignorés : bail terminé, bail déjà échu, bail trop lointain.
    for (const extra of [{ status: "ENDED" as const, endDate: dans(3 * JOUR) }, { endDate: dans(-1000) }, { endDate: dans(14 * JOUR + 1000) }]) {
      const b = await createProperty(manager.id);
      await createContract(b.id, awa.id, { status: "ACTIVE", ...extra });
    }
    // Un autre locataire de la même agence, avec son bail, ses messages et ses loyers.
    const autre = await createTenant(manager.id);
    const bienAutre = await createProperty(manager.id);
    const bailAutre = await createContract(bienAutre.id, autre.id, { status: "ACTIVE", endDate: dans(3 * JOUR) });
    await message(bailAutre.id, manager.id, { senderRole: "MANAGER", tenantId: null });
    await facture(bailAutre.id, { dueDate: ilya(JOUR) });
    return { manager, awa, coloc, bail, bail2, bailAutre, h: authHeader(await tokenLocataire(awa.id)), autre };
  }

  it("messages du fil, loyers en retard ou bientôt dus (bornes exactes), baux qui se terminent : texte, lien, date, gravité, ordre", async () => {
    const x = await bailLocataire();
    // Son fil : un message rattaché + un message d'avant le rattrapage ; à ignorer : le fil du colocataire, le sien lu, ses propres envois.
    await message(x.bail.id, x.manager.id, { senderRole: "MANAGER", tenantId: x.awa.id, createdAt: ilya(3 * HEURE) });
    await message(x.bail.id, x.manager.id, { senderRole: "MANAGER", tenantId: null, createdAt: ilya(1 * HEURE) });
    await message(x.bail.id, x.manager.id, { senderRole: "MANAGER", tenantId: x.coloc.id, createdAt: dans(0) });
    await message(x.bail.id, x.manager.id, { senderRole: "MANAGER", tenantId: x.awa.id, isRead: true, createdAt: dans(0) });
    await message(x.bail.id, x.manager.id, { senderRole: "TENANT", tenantId: x.awa.id, createdAt: dans(0) });
    const retard = await facture(x.bail.id, { dueDate: ilya(2 * JOUR) });
    const maintenant = await facture(x.bail.id, { status: "PENDING", dueDate: dans(0) });
    const dansTrois = await facture(x.bail.id, { status: "PENDING", dueDate: dans(3 * JOUR) });
    await facture(x.bail.id, { status: "PENDING", dueDate: dans(3 * JOUR + 1000) });
    await facture(x.bail.id, { status: "PENDING", dueDate: dans(-1000) });
    await facture(x.bail.id, { status: "CANCELLED", dueDate: dans(JOUR) });
    await facture(x.bail.id, { status: "PAID", dueDate: dans(JOUR) });

    const res = await request(app).get("/api/notifications/mine").set(x.h);

    expect(res.status).toBe(200);
    expect(res.body.notifications.map(({ key: _k, seen: _s, read: _r, ...n }: Record<string, unknown>) => n)).toEqual([
      { id: `contract-${x.bail2.id}`, type: "contract_ending", severity: "warning", title: "Votre bail se termine dans 14 jours", description: "Contactez votre gestionnaire pour un renouvellement", link: "/portail", createdAt: dans(13.5 * JOUR).toISOString() },
      { id: `contract-${x.bail.id}`, type: "contract_ending", severity: "danger", title: "Votre bail se termine dans 7 jours", description: "Contactez votre gestionnaire pour un renouvellement", link: "/portail", createdAt: dans(6.2 * JOUR).toISOString() },
      { id: `invoice-${dansTrois.id}`, type: "invoice", severity: "warning", title: "Loyer à régler bientôt", description: "Échéance du 18/06/2026", link: "/portail/paiements", createdAt: dans(3 * JOUR).toISOString() },
      { id: `invoice-${maintenant.id}`, type: "invoice", severity: "warning", title: "Loyer à régler bientôt", description: "Échéance du 15/06/2026", link: "/portail/paiements", createdAt: dans(0).toISOString() },
      { id: "message-mine", type: "message", severity: "info", title: "2 nouveaux messages de votre gestionnaire", description: "Consultez votre messagerie", link: "/portail/messages", createdAt: ilya(1 * HEURE).toISOString() },
      { id: `invoice-${retard.id}`, type: "invoice", severity: "danger", title: "Loyer en retard", description: "Échéance du 13/06/2026", link: "/portail/paiements", createdAt: ilya(2 * JOUR).toISOString() },
    ]);
  });

  it("un message d'avant le rattrapage (sans locataire) sur le bail d'un AUTRE locataire n'est pas le sien", async () => {
    const x = await bailLocataire();

    const res = await request(app).get("/api/notifications/mine").set(x.h);

    expect(res.body.notifications.some((n: { id: string }) => n.id === "message-mine")).toBe(false);
  });
});

describe("état « vu » et « lu »", () => {
  const cle = (n: { id: string; createdAt: string }) => `${n.id}|${n.createdAt}`;

  it("le plafond de la liste est de 100 notifications", () => {
    expect(NOTIFICATIONS_MAX).toBe(100);
  });

  it("« vu » n'est pas « lu » (gestionnaire comme locataire) : seul « lu » écarte la notification du panneau", async () => {
    const a = await agenceComplete();
    const avant = (await lire(a.h)).body;
    expect(avant.notifications.every((n: { seen: boolean; read: boolean }) => !n.seen && !n.read)).toBe(true);

    const vu = await request(app).post("/api/notifications/seen").set(a.h).send({});
    expect(vu.body).toEqual({ success: true });
    const apresVu = (await lire(a.h)).body;
    expect(apresVu.notifications.every((n: { seen: boolean; read: boolean }) => n.seen && !n.read)).toBe(true);
    expect(apresVu.unseenCount).toBe(0);
    expect(apresVu.unreadCount).toBe(avant.count);
    expect((await testDb.select().from(notificationVues)).every((l: { readAt: Date | null }) => l.readAt === null)).toBe(true);

    await request(app).post("/api/notifications/read").set(a.h).send({}).expect(200);
    const apresLu = (await lire(a.h)).body;
    expect(apresLu.unreadCount).toBe(0);
    expect(apresLu.notifications.every((n: { seen: boolean; read: boolean }) => n.seen && n.read)).toBe(true);
  });

  it("côté locataire aussi : « vu » seulement, puis « lu »", async () => {
    const manager = await createManager();
    const bien = await createProperty(manager.id);
    const t = await createTenant(manager.id);
    await createContract(bien.id, t.id, { status: "ACTIVE", endDate: dans(3 * JOUR) });
    const h = authHeader(await tokenLocataire(t.id));

    await request(app).post("/api/notifications/mine/seen").set(h).send({}).expect(200);
    const vu = (await request(app).get("/api/notifications/mine").set(h)).body;
    expect(vu.notifications.map((n: { seen: boolean; read: boolean }) => [n.seen, n.read])).toEqual([[true, false]]);

    await request(app).post("/api/notifications/mine/read").set(h).send({}).expect(200);
    const lu = (await request(app).get("/api/notifications/mine").set(h)).body;
    expect(lu.notifications.map((n: { seen: boolean; read: boolean }) => [n.seen, n.read])).toEqual([[true, true]]);
  });

  it("un compte locataire sans fiche est refusé avec son code, sur les trois routes", async () => {
    const orphelin = await createPortalUser("TENANT");
    const h = authHeader(tokenFor(orphelin, null, null));

    for (const [methode, chemin] of [
      ["get", "/api/notifications/mine"],
      ["post", "/api/notifications/mine/seen"],
      ["post", "/api/notifications/mine/read"],
    ] as const) {
      const res = await request(app)[methode](chemin).set(h);
      expect(res.status, chemin).toBe(403);
      expect(res.body.code, chemin).toBe("TENANT_NOT_LINKED");
    }
  });

  it("ne marque que les clés fournies qui existent vraiment : une clé inventée n'est jamais enregistrée", async () => {
    const a = await agenceComplete();
    const liste = (await lire(a.h)).body.notifications;

    await request(app).post("/api/notifications/seen").set(a.h).send({ keys: [cle(liste[0]), "faux|2020-01-01T00:00:00.000Z"] }).expect(200);
    await request(app).post("/api/notifications/read").set(a.h).send({ keys: [cle(liste[1]), "faux|2020-01-01T00:00:00.000Z"] }).expect(200);

    const lignes = await testDb.select().from(notificationVues);
    expect(lignes.map((l: { cle: string }) => l.cle).sort()).toEqual([cle(liste[0]), cle(liste[1])].sort());
  });

  it("accepte 5 000 clés et une clé de 300 caractères, refuse 5 001 clés et une clé de 301 caractères", async () => {
    const a = await agenceComplete();
    const clés = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);

    expect((await request(app).post("/api/notifications/seen").set(a.h).send({ keys: clés(5000) })).status).toBe(200);
    expect((await request(app).post("/api/notifications/seen").set(a.h).send({ keys: clés(5001) })).status).toBe(400);
    expect((await request(app).post("/api/notifications/seen").set(a.h).send({ keys: ["x".repeat(300)] })).status).toBe(200);
    expect((await request(app).post("/api/notifications/seen").set(a.h).send({ keys: ["x".repeat(301)] })).status).toBe(400);
  });

  it("la purge ne touche que les lignes de la personne qui marque, même quand elle n'a plus aucune notification", async () => {
    const a = await agenceComplete();
    const autre = await agenceComplete(" B");
    await request(app).post("/api/notifications/seen").set(autre.h).send({}).expect(200);
    const chezAutre = (await testDb.select().from(notificationVues)).length;
    expect(chezAutre).toBeGreaterThan(0);

    // A marque deux fois : ses lignes sont purgées/recréées, celles de B restent.
    await request(app).post("/api/notifications/seen").set(a.h).send({}).expect(200);
    await request(app).post("/api/notifications/seen").set(a.h).send({}).expect(200);
    const restantes = await testDb.select().from(notificationVues);
    expect(restantes.length).toBe(chezAutre * 2);

    // Un gestionnaire qui n'a rien à signaler ne vide pas la table des autres.
    const vide = await createManager();
    await request(app).post("/api/notifications/seen").set(entete(vide)).send({}).expect(200);
    expect((await testDb.select().from(notificationVues)).length).toBe(chezAutre * 2);
  });

  it("une notification devenue sans objet est purgée pour la personne qui marque, pas pour les autres", async () => {
    const a = await agenceComplete();
    await request(app).post("/api/notifications/seen").set(a.h).send({}).expect(200);
    const avant = (await testDb.select().from(notificationVues)).length;
    await testDb.delete(messages).where(eq(messages.contractId, a.bail.id));

    await request(app).post("/api/notifications/seen").set(a.h).send({}).expect(200);

    expect((await testDb.select().from(notificationVues)).length).toBe(avant - 2);
  });
});

describe("plafond de la liste : les éléments à traiter ne sont jamais écartés par les éléments lus", () => {
  it("avec plus d'éléments à traiter que le plafond, aucun élément lu ne passe devant", async () => {
    const manager = await createManager();
    const total = NOTIFICATIONS_MAX + 5;
    const ids = Array.from({ length: total }, (_, i) => i);
    await testDb.insert(properties).values(ids.map((i) => ({ id: `${manager.id}-p${i}`, managerId: manager.id, title: `Bien ${i}`, address: "1 rue du Test", surface: 40, rent: 500 })));
    await testDb.insert(tenants).values(ids.map((i) => ({ id: `${manager.id}-t${i}`, managerId: manager.id, firstName: "Jean", lastName: `Nom${i}`, phone: "060000", email: `${manager.id}-t${i}@x.test` })));
    await testDb.insert(contracts).values(
      ids.map((i) => ({ id: `${manager.id}-c${i}`, propertyId: `${manager.id}-p${i}`, tenantId: `${manager.id}-t${i}`, rent: 500, deposit: 0, startDate: new Date(Date.UTC(2020, 0, 1)), endDate: new Date(Date.UTC(2090, 0, 1)), status: "ACTIVE" as const }))
    );
    await testDb.insert(invoices).values(
      ids.map((i) => ({ contractId: `${manager.id}-c${i}`, periodMonth: 1, periodYear: 2024, amount: 500, dueDate: new Date(Date.UTC(2024, 0, 1) + i * 86400000), status: "LATE" as const }))
    );
    const h = entete(manager);
    const toutes = (await lire(h)).body.notifications as Array<{ id: string; createdAt: string }>;
    // Les trois plus anciennes sont lues : 102 restent à traiter, soit plus que le plafond.
    const lues = toutes.slice(-3);
    await request(app).post("/api/notifications/read").set(h).send({ keys: lues.map(cle) }).expect(200);

    const res = await lire(h);

    expect(res.body.count).toBe(total);
    expect(res.body.unreadCount).toBe(total - 3);
    expect(res.body.notifications).toHaveLength(NOTIFICATIONS_MAX);
    expect(res.body.notifications.every((n: { read: boolean }) => !n.read)).toBe(true);

    function cle(n: { id: string; createdAt: string }) {
      return `${n.id}|${n.createdAt}`;
    }
  });
});
