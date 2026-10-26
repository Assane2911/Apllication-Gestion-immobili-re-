import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listingLeads, listings, messages, issueReports } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createPortalUser, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * La cloche est écrite par le serveur : ses textes suivent la langue de l'interface de la personne qui consulte
 * (en-tête `Accept-Language`), pour le gestionnaire comme pour le locataire. Les clés (`key`, `id`) et l'état « vu »
 * ne dépendent pas de la langue. Horloge figée au 12 octobre 2026.
 */
const LANGUES = ["fr", "en", "es", "pt"] as const;
type Notif = { id: string; key: string; type: string; title: string; description: string; seen: boolean; createdAt: string };
const MOTS_FRANCAIS = /\b(nouveaux?|messages? de|Loyer|retard|Échéance|Signalement|Demande|se terminant|se termine|bail|gestionnaire|Consultez|Contactez|jours?)\b/;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 10));
});
afterEach(() => vi.useRealTimers());

const parType = (liste: Notif[], type: string) => liste.find((n) => n.type === type)!;

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: new Date(2025, 9, 1), endDate: new Date(2026, 9, 17, 10) });
  const portail = await createPortalUser("TENANT");
  return { manager, property, tenant, contract, portail };
}

async function messagesNonLus(contractId: string, senderId: string, senderRole: "TENANT" | "MANAGER", nombre: number) {
  for (let i = 0; i < nombre; i++) await testDb.insert(messages).values({ contractId, senderId, senderRole, content: `Message ${i}`, isRead: false });
}

describe("cloche du gestionnaire — langue de l'interface", () => {
  async function jeuComplet() {
    const a = await agence();
    await messagesNonLus(a.contract.id, a.portail.id, "TENANT", 2);
    await createInvoice(a.contract.id, { status: "LATE", periodMonth: 9, periodYear: 2026, dueDate: new Date(2026, 9, 5) });
    await testDb.insert(issueReports).values({ contractId: a.contract.id, tenantId: a.tenant.id, title: "Fuite", description: "d", photoUrl: "issues/a.jpg", status: "OPEN" });
    const [annonce] = await testDb.insert(listings).values({ managerId: a.manager.id, title: "Annonce", description: "d", price: 1, location: "Dakar" }).returning();
    await testDb.insert(listingLeads).values({ listingId: annonce.id, managerId: a.manager.id, prospectName: "Marta", prospectEmail: "m@example.com", prospectPhone: "+221771234567", requestType: "VISIT" });
    return a;
  }
  const lire = async (manager: Awaited<ReturnType<typeof agence>>["manager"], langue?: string) => {
    const r = request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));
    const res = await (langue ? r.set("Accept-Language", langue) : r);
    expect(res.status).toBe(200);
    return res.body.notifications as Notif[];
  };

  it("en français : les textes d'avant", async () => {
    const { manager } = await jeuComplet();
    const liste = await lire(manager, "fr");
    expect(parType(liste, "message").title).toBe("2 nouveaux messages de Awa Sow");
    expect(parType(liste, "invoice").title).toBe("Loyer en retard — Awa Sow");
    expect(parType(liste, "invoice").description).toBe("Villa Ngor · échéance du 05/10/2026");
    expect(parType(liste, "issue").title).toBe("Signalement : Fuite");
    expect(parType(liste, "lead").title).toBe("Demande de visite — Marta");
    expect(parType(liste, "contract_ending").title).toBe("Contrat se terminant dans 5 jours");
  });

  it("en anglais", async () => {
    const { manager } = await jeuComplet();
    const liste = await lire(manager, "en");
    expect(parType(liste, "message").title).toBe("2 new messages from Awa Sow");
    expect(parType(liste, "invoice").title).toBe("Late rent — Awa Sow");
    expect(parType(liste, "invoice").description).toBe("Villa Ngor · due October 5, 2026");
    expect(parType(liste, "issue").title).toBe("Issue: Fuite");
    expect(parType(liste, "lead").title).toBe("Viewing request — Marta");
    expect(parType(liste, "contract_ending").title).toBe("Lease ending in 5 days");
  });

  it("en espagnol", async () => {
    const { manager } = await jeuComplet();
    const liste = await lire(manager, "es");
    expect(parType(liste, "message").title).toBe("2 mensajes nuevos de Awa Sow");
    expect(parType(liste, "invoice").title).toBe("Alquiler atrasado — Awa Sow");
    expect(parType(liste, "invoice").description).toBe("Villa Ngor · vence el 5 de octubre de 2026");
    expect(parType(liste, "issue").title).toBe("Incidencia: Fuite");
    expect(parType(liste, "lead").title).toBe("Solicitud de visita — Marta");
    expect(parType(liste, "contract_ending").title).toBe("Contrato que termina en 5 días");
  });

  it("en portugais", async () => {
    const { manager } = await jeuComplet();
    const liste = await lire(manager, "pt-BR");
    expect(parType(liste, "message").title).toBe("2 novas mensagens de Awa Sow");
    expect(parType(liste, "invoice").title).toBe("Renda em atraso — Awa Sow");
    expect(parType(liste, "invoice").description).toBe("Villa Ngor · vencimento em 5 de outubro de 2026");
    expect(parType(liste, "issue").title).toBe("Incidente: Fuite");
    expect(parType(liste, "lead").title).toBe("Pedido de visita — Marta");
    expect(parType(liste, "contract_ending").title).toBe("Contrato a terminar em 5 dias");
  });

  it("sans langue, ou dans une langue inconnue : le français", async () => {
    const { manager } = await jeuComplet();
    expect(parType(await lire(manager), "invoice").title).toBe("Loyer en retard — Awa Sow");
    expect(parType(await lire(manager, "de"), "invoice").title).toBe("Loyer en retard — Awa Sow");
    expect(parType(await lire(manager, "fr-FR,fr;q=0.9,en;q=0.8"), "invoice").title).toBe("Loyer en retard — Awa Sow");
  });

  it.each(["en", "es", "pt"])("en %s : aucun reste de français dans les textes écrits par le serveur", async (langue) => {
    const { manager } = await jeuComplet();
    for (const n of await lire(manager, langue)) {
      expect(n.title).not.toMatch(MOTS_FRANCAIS);
      expect(n.description).not.toMatch(MOTS_FRANCAIS);
    }
  });

  it("une demande d'information se distingue d'une demande de visite, dans chaque langue", async () => {
    const { manager } = await agence();
    const [annonce] = await testDb.insert(listings).values({ managerId: manager.id, title: "Annonce", description: "d", price: 1, location: "Dakar" }).returning();
    await testDb.insert(listingLeads).values({ listingId: annonce.id, managerId: manager.id, prospectName: "Marta", prospectEmail: "m@example.com", prospectPhone: "+221771234567", requestType: "INFO" });
    const attendu = { fr: "Demande d'information — Marta", en: "Information request — Marta", es: "Solicitud de información — Marta", pt: "Pedido de informações — Marta" };
    for (const l of LANGUES) expect(parType(await lire(manager, l), "lead").title).toBe(attendu[l]);
  });

  it("le singulier : un message, un jour", async () => {
    const { manager, contract, portail } = await agence();
    await messagesNonLus(contract.id, portail.id, "TENANT", 1);
    vi.setSystemTime(new Date(2026, 9, 16, 22)); // il reste 12 h : un jour
    const attendu = {
      fr: ["1 nouveau message de Awa Sow", "Contrat se terminant dans 1 jour"],
      en: ["1 new message from Awa Sow", "Lease ending in 1 day"],
      es: ["1 mensaje nuevo de Awa Sow", "Contrato que termina en 1 día"],
      pt: ["1 nova mensagem de Awa Sow", "Contrato a terminar em 1 dia"],
    };
    for (const l of LANGUES) {
      const liste = await lire(manager, l);
      expect([parType(liste, "message").title, parType(liste, "contract_ending").title]).toEqual(attendu[l]);
    }
  });

  it("les clés, l'ordre et l'état « vu » ne dépendent pas de la langue", async () => {
    const { manager } = await jeuComplet();
    const reference = (await lire(manager, "fr")).map((n) => [n.id, n.key, n.createdAt]);
    for (const l of ["en", "es", "pt"]) expect((await lire(manager, l)).map((n) => [n.id, n.key, n.createdAt])).toEqual(reference);

    // Vue en anglais, vue en portugais aussi.
    await request(app).post("/api/notifications/seen").set(authHeader(tokenFor(manager))).set("Accept-Language", "en").send({});
    const apres = await lire(manager, "pt");
    expect(apres.length).toBeGreaterThan(0);
    expect(apres.every((n) => n.seen)).toBe(true);
  });
});

describe("cloche du gestionnaire — fenêtre des contrats qui se terminent", () => {
  async function bailQuiSeTermine(fin: Date, status: "ACTIVE" | "ENDED" | "TERMINATED" = "ACTIVE") {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status, startDate: new Date(2025, 9, 1), endDate: fin });
    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));
    return { contract, ids: (res.body.notifications as Notif[]).map((n) => n.id) };
  }

  it("un bail qui se termine dans la fenêtre de 14 jours est signalé, jusqu'au dernier instant", async () => {
    const limite = new Date(2026, 9, 26, 10);
    const { contract, ids } = await bailQuiSeTermine(limite);
    expect(ids).toContain(`contract-${contract.id}`);
  });

  it("une minute après la fenêtre, ou déjà terminé hier : pas de notification", async () => {
    const apres = await bailQuiSeTermine(new Date(2026, 9, 26, 10, 1));
    expect(apres.ids).not.toContain(`contract-${apres.contract.id}`);
    const hier = await bailQuiSeTermine(new Date(2026, 9, 11, 10));
    expect(hier.ids).not.toContain(`contract-${hier.contract.id}`);
  });

  it("un bail qui n'est plus actif n'est pas signalé, même s'il se termine bientôt", async () => {
    for (const status of ["ENDED", "TERMINATED"] as const) {
      const { contract, ids } = await bailQuiSeTermine(new Date(2026, 9, 17, 10), status);
      expect(ids).not.toContain(`contract-${contract.id}`);
    }
  });
});

describe("cloche du locataire — langue de l'interface", () => {
  async function jeuLocataire() {
    const a = await agence();
    await messagesNonLus(a.contract.id, a.manager.id, "MANAGER", 2);
    await createInvoice(a.contract.id, { status: "LATE", periodMonth: 9, periodYear: 2026, dueDate: new Date(2026, 9, 5) });
    await createInvoice(a.contract.id, { status: "PENDING", periodMonth: 10, periodYear: 2026, dueDate: new Date(2026, 9, 14) });
    return a;
  }
  const lire = async (tenantId: string, langue?: string) => {
    const r = request(app).get("/api/notifications/mine").set(authHeader(await tokenLocataire(tenantId)));
    const res = await (langue ? r.set("Accept-Language", langue) : r);
    expect(res.status).toBe(200);
    return res.body.notifications as Notif[];
  };
  const factures = (liste: Notif[]) => liste.filter((n) => n.type === "invoice").sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  it("en français : les textes d'avant", async () => {
    const { tenant } = await jeuLocataire();
    const liste = await lire(tenant.id, "fr");
    expect(parType(liste, "message").title).toBe("2 nouveaux messages de votre gestionnaire");
    expect(parType(liste, "message").description).toBe("Consultez votre messagerie");
    const [enRetard, bientot] = factures(liste);
    expect([enRetard.title, enRetard.description]).toEqual(["Loyer en retard", "Échéance du 05/10/2026"]);
    expect([bientot.title, bientot.description]).toEqual(["Loyer à régler bientôt", "Échéance du 14/10/2026"]);
    expect(parType(liste, "contract_ending").title).toBe("Votre bail se termine dans 5 jours");
    expect(parType(liste, "contract_ending").description).toBe("Contactez votre gestionnaire pour un renouvellement");
  });

  it("en anglais, espagnol et portugais", async () => {
    const { tenant } = await jeuLocataire();
    const en = await lire(tenant.id, "en");
    expect(parType(en, "message").title).toBe("2 new messages from your property manager");
    expect(parType(en, "message").description).toBe("Check your inbox");
    expect(factures(en).map((n) => [n.title, n.description])).toEqual([
      ["Rent overdue", "Due October 5, 2026"],
      ["Rent due soon", "Due October 14, 2026"],
    ]);
    expect(parType(en, "contract_ending").title).toBe("Your lease ends in 5 days");
    expect(parType(en, "contract_ending").description).toBe("Contact your property manager to renew");

    const es = await lire(tenant.id, "es");
    expect(parType(es, "message").title).toBe("2 mensajes nuevos de tu gestor");
    expect(factures(es).map((n) => [n.title, n.description])).toEqual([
      ["Alquiler atrasado", "Vence el 5 de octubre de 2026"],
      ["Alquiler por pagar pronto", "Vence el 14 de octubre de 2026"],
    ]);
    expect(parType(es, "contract_ending").title).toBe("Tu contrato termina en 5 días");

    const pt = await lire(tenant.id, "pt");
    expect(parType(pt, "message").title).toBe("2 novas mensagens do teu gestor");
    expect(factures(pt).map((n) => [n.title, n.description])).toEqual([
      ["Renda em atraso", "Vencimento em 5 de outubro de 2026"],
      ["Renda a pagar em breve", "Vencimento em 14 de outubro de 2026"],
    ]);
    expect(parType(pt, "contract_ending").title).toBe("O teu contrato termina em 5 dias");
  });

  it.each(["en", "es", "pt"])("en %s : aucun reste de français", async (langue) => {
    const { tenant } = await jeuLocataire();
    for (const n of await lire(tenant.id, langue)) {
      expect(n.title).not.toMatch(MOTS_FRANCAIS);
      expect(n.description).not.toMatch(MOTS_FRANCAIS);
    }
  });

  it("sans langue : le français ; les clés ne dépendent pas de la langue", async () => {
    const { tenant } = await jeuLocataire();
    const reference = await lire(tenant.id);
    expect(parType(reference, "message").title).toBe("2 nouveaux messages de votre gestionnaire");
    for (const l of ["en", "es", "pt"]) expect((await lire(tenant.id, l)).map((n) => [n.id, n.key])).toEqual(reference.map((n) => [n.id, n.key]));
  });

  it("un loyer à venir qui n'est ni en retard ni sous 3 jours, ou déjà échu sans être en retard, n'est pas signalé", async () => {
    const { tenant, contract } = await agence();
    await createInvoice(contract.id, { status: "PENDING", periodMonth: 11, periodYear: 2026, dueDate: new Date(2026, 9, 15, 10, 1) }); // une minute après la fenêtre de 3 jours
    await createInvoice(contract.id, { status: "PENDING", periodMonth: 12, periodYear: 2026, dueDate: new Date(2026, 9, 11) }); // échue hier, pas encore marquée en retard
    expect(factures(await lire(tenant.id))).toEqual([]);
  });

  it("un loyer en retard est signalé quelle que soit son ancienneté", async () => {
    const { tenant, contract } = await agence();
    const vieille = await createInvoice(contract.id, { status: "LATE", periodMonth: 1, periodYear: 2025, dueDate: new Date(2025, 0, 5) });
    expect(factures(await lire(tenant.id)).map((n) => n.id)).toEqual([`invoice-${vieille.id}`]);
  });
});
