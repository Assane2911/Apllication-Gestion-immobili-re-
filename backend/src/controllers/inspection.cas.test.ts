import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, inspections } from "../db/schema";
import { authHeader, createContract, createInspection, createManager, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * États des lieux : ce que les tests existants ne verrouillaient pas. Bornes de la saisie (nom, notes, clés, quantité), valeurs par défaut
 * (état d'une pièce, type), ordre et pagination des listes, comparaison avec l'entrée finalisée LA PLUS RÉCENTE, brouillons exclus,
 * verrou du contenu finalisé pour chacune de ses quatre parties, suppression réellement effectuée (et refusée dès qu'une partie a signé),
 * formats de signature, et trace au journal d'activité de la création, de la finalisation et de la signature.
 */
const JOUR = 86_400_000;
const ilYa = (jours: number) => new Date(Date.now() - jours * JOUR);
const PNG = "data:image/png;base64,SIGNATURE";

async function agence() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa des Almadies" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const piece = (nom: string, condition = "BON") => JSON.stringify([{ name: nom, condition, notes: "" }]);
const journal = (managerId: string) => testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));
const modifier = (h: Record<string, string>, id: string, corps: object) => request(app).put(`/api/inspections/${id}`).set(h).send(corps);

describe("saisie : valeurs par défaut et bornes", () => {
  it("une pièce sans état est « BON » et sans notes", async () => {
    const { manager, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id);

    const res = await modifier(h, edl.id, { rooms: [{ name: "Salon" }] });

    expect(res.status).toBe(200);
    expect(res.body.rooms).toEqual([{ name: "Salon", condition: "BON", notes: "" }]);
  });

  it("une pièce sans nom, des notes de plus de 2 000 caractères, une clé sans libellé ou à quantité négative sont refusées", async () => {
    const { manager, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id);

    expect((await modifier(h, edl.id, { rooms: [{ name: "" }] })).status).toBe(400);
    expect((await modifier(h, edl.id, { rooms: [{ name: "Salon", notes: "x".repeat(2001) }] })).status).toBe(400);
    expect((await modifier(h, edl.id, { rooms: [{ name: "Salon", notes: "x".repeat(2000) }] })).status).toBe(200);
    expect((await modifier(h, edl.id, { keys: [{ label: "", quantity: 1 }] })).status).toBe(400);
    expect((await modifier(h, edl.id, { keys: [{ label: "Porte", quantity: -1 }] })).status).toBe(400);
    expect((await modifier(h, edl.id, { keys: [{ label: "Porte", quantity: 0 }] })).status).toBe(200);
  });

  it("au plus 50 clés par état des lieux", async () => {
    const { manager, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id);
    const cles = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Clé ${i}`, quantity: 1 }));

    expect((await modifier(h, edl.id, { keys: cles(51) })).status).toBe(400);
    expect((await modifier(h, edl.id, { keys: cles(50) })).status).toBe(200);
  });
});

describe("création : type et journal d'activité", () => {
  const creer = (h: Record<string, string>, corps: object) => request(app).post("/api/inspections").set(h).send(corps);

  it("sans type, c'est une entrée ; un état des lieux de sortie est bien enregistré comme tel", async () => {
    const { contract, h } = await agence();

    expect((await creer(h, { contractId: contract.id })).body.type).toBe("ENTRY");
    const sortie = await creer(h, { contractId: contract.id, type: "EXIT" });
    expect(sortie.status).toBe(201);
    expect(sortie.body.type).toBe("EXIT");
    const [enBase] = await testDb.select().from(inspections).where(eq(inspections.id, sortie.body.id));
    expect(enBase.type).toBe("EXIT");
  });

  it("rattache l'état des lieux au bien, au locataire et à l'agence du bail", async () => {
    const { manager, property, tenant, contract, h } = await agence();

    const res = await creer(h, { contractId: contract.id, type: "ENTRY" });

    expect(res.body).toMatchObject({ contractId: contract.id, propertyId: property.id, tenantId: tenant.id, managerId: manager.id });
  });

  it("trace la création au journal, avec le type en clair", async () => {
    const { manager, contract, h } = await agence();

    const entree = await creer(h, { contractId: contract.id, type: "ENTRY" });
    const sortie = await creer(h, { contractId: contract.id, type: "EXIT" });

    const lignes = (await journal(manager.id)).filter((l: { action: string }) => l.action === "inspection.create");
    const deEntree = lignes.find((l: { entityId: string | null }) => l.entityId === entree.body.id)!;
    const deSortie = lignes.find((l: { entityId: string | null }) => l.entityId === sortie.body.id)!;
    expect(deEntree).toMatchObject({ entityType: "inspection", entityLabel: "Villa des Almadies — Entrée", details: "État des lieux d'entrée créé pour Villa des Almadies" });
    expect(deSortie).toMatchObject({ entityType: "inspection", entityLabel: "Villa des Almadies — Sortie", details: "État des lieux de sortie créé pour Villa des Almadies" });
  });
});

describe("listes : ordre et pagination", () => {
  it("la liste du gestionnaire va du plus récent au plus ancien et se pagine", async () => {
    const { manager, contract, h } = await agence();
    const a = await createInspection(contract, manager.id, { createdAt: ilYa(30) });
    const b = await createInspection(contract, manager.id, { createdAt: ilYa(20) });
    const c = await createInspection(contract, manager.id, { createdAt: ilYa(10) });

    const page1 = await request(app).get("/api/inspections?pageSize=2&page=1").set(h);
    const page2 = await request(app).get("/api/inspections?pageSize=2&page=2").set(h);

    expect(page1.body.items.map((i: { id: string }) => i.id)).toEqual([c.id, b.id]);
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expect(page1.body).toMatchObject({ total: 3, totalPages: 2, page: 1, pageSize: 2 });
  });

  it("la liste du locataire va elle aussi du plus récent au plus ancien", async () => {
    const { manager, tenant, contract } = await agence();
    const a = await createInspection(contract, manager.id, { createdAt: ilYa(30), status: "COMPLETED" });
    const b = await createInspection(contract, manager.id, { createdAt: ilYa(5), status: "COMPLETED" });

    const res = await request(app).get("/api/inspections/mine").set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.body.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
  });
});

describe("comparaison : l'entrée et la sortie finalisées les plus récentes", () => {
  async function bail() {
    const a = await agence();
    // Deux entrées finalisées (la plus récente fait foi), puis une entrée plus récente encore mais en brouillon.
    const ancienne = await createInspection(a.contract, a.manager.id, { type: "ENTRY", status: "COMPLETED", createdAt: ilYa(300), roomsData: piece("Salon", "MAUVAIS"), generalComments: "ancienne entrée" });
    const recente = await createInspection(a.contract, a.manager.id, {
      type: "ENTRY", status: "COMPLETED", createdAt: ilYa(200), roomsData: piece("Salon", "BON"), generalComments: "entrée récente",
      signedByManagerAt: new Date("2025-01-10T10:00:00Z"), signedByTenantAt: new Date("2025-01-11T10:00:00Z"),
    });
    const brouillonEntree = await createInspection(a.contract, a.manager.id, { type: "ENTRY", status: "DRAFT", createdAt: ilYa(100), roomsData: piece("Salon", "MOYEN") });
    return { ...a, ancienne, recente, brouillonEntree };
  }

  it("compare avec l'entrée finalisée la plus récente (ni la plus ancienne, ni un brouillon), et rend dates de signature et commentaires des deux côtés", async () => {
    const a = await bail();
    const sortie = await createInspection(a.contract, a.manager.id, {
      type: "EXIT", status: "COMPLETED", createdAt: ilYa(10), roomsData: piece("Salon", "MOYEN"), generalComments: "sortie",
      signedByManagerAt: new Date("2026-06-10T10:00:00Z"), signedByTenantAt: new Date("2026-06-11T10:00:00Z"),
    });

    const res = await request(app).get(`/api/inspections/${sortie.id}/comparison`).set(a.h);

    expect(res.status).toBe(200);
    expect(res.body.entry.id).toBe(a.recente.id);
    expect(res.body.entry.generalComments).toBe("entrée récente");
    expect(res.body.entry.signedByManagerAt).toBe("2025-01-10T10:00:00.000Z");
    expect(res.body.entry.signedByTenantAt).toBe("2025-01-11T10:00:00.000Z");
    expect(res.body.exit.id).toBe(sortie.id);
    expect(res.body.exit.generalComments).toBe("sortie");
    expect(res.body.exit.signedByManagerAt).toBe("2026-06-10T10:00:00.000Z");
    expect(res.body.exit.signedByTenantAt).toBe("2026-06-11T10:00:00.000Z");
    expect(res.body.property).toEqual({ id: a.property.id, title: "Villa des Almadies" });
  });

  it("le rappel d'un bail retient la sortie finalisée la plus récente : ni la plus ancienne, ni un brouillon, ni une entrée", async () => {
    const a = await bail();
    await createInspection(a.contract, a.manager.id, { type: "EXIT", status: "COMPLETED", createdAt: ilYa(60), roomsData: piece("Salon", "MAUVAIS") });
    const recente = await createInspection(a.contract, a.manager.id, { type: "EXIT", status: "COMPLETED", createdAt: ilYa(30), roomsData: piece("Salon", "MOYEN") });
    await createInspection(a.contract, a.manager.id, { type: "EXIT", status: "DRAFT", createdAt: ilYa(5), roomsData: piece("Salon", "MAUVAIS") });

    const res = await request(app).get(`/api/contracts/${a.contract.id}/exit-comparison`).set(a.h);

    expect(res.status).toBe(200);
    expect(res.body.exit.id).toBe(recente.id);
    expect(res.body.entry.id).toBe(a.recente.id);
  });

  it("sans aucune sortie finalisée (seulement une entrée ou un brouillon), le rappel est vide", async () => {
    const a = await bail();
    await createInspection(a.contract, a.manager.id, { type: "EXIT", status: "DRAFT", createdAt: ilYa(5) });

    const res = await request(app).get(`/api/contracts/${a.contract.id}/exit-comparison`).set(a.h);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe("modification : le contenu finalisé est verrouillé, partie par partie, et la finalisation est tracée", () => {
  const PARTIES: Array<[string, object]> = [
    ["les pièces", { rooms: [{ name: "Cuisine", condition: "BON", notes: "" }] }],
    ["les compteurs", { meters: { electricity: "123", water: "", gas: "" } }],
    ["les clés", { keys: [{ label: "Porte", quantity: 2 }] }],
    ["les commentaires généraux", { generalComments: "modifié après coup" }],
  ];

  for (const [nom, corps] of PARTIES) {
    it(`refuse de modifier ${nom} d'un état des lieux finalisé, sans rien écrire`, async () => {
      const { manager, contract, h } = await agence();
      const edl = await createInspection(contract, manager.id, { status: "COMPLETED", roomsData: piece("Salon"), generalComments: "figé" });

      const res = await modifier(h, edl.id, corps);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("INSPECTION_FINALIZED_LOCKED");
      const [apres] = await testDb.select().from(inspections).where(eq(inspections.id, edl.id));
      expect(apres.roomsData).toBe(piece("Salon"));
      expect(apres.generalComments).toBe("figé");
      expect(apres.metersData).toBeNull();
      expect(apres.keysData).toBeNull();
    });
  }

  it("la finalisation est tracée une seule fois, avec le bien ; modifier un brouillon ou refinaliser n'ajoute rien", async () => {
    const { manager, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id);
    const finalisations = async () => (await journal(manager.id)).filter((l: { action: string }) => l.action === "inspection.finalize");

    await modifier(h, edl.id, { rooms: [{ name: "Salon" }] });
    await modifier(h, edl.id, { status: "DRAFT" });
    expect(await finalisations()).toHaveLength(0);

    await modifier(h, edl.id, { status: "COMPLETED" });
    const [ligne] = await finalisations();
    expect(ligne).toMatchObject({ entityType: "inspection", entityId: edl.id, entityLabel: "Villa des Almadies", details: "État des lieux finalisé pour Villa des Almadies" });

    await modifier(h, edl.id, { status: "COMPLETED" });
    expect(await finalisations()).toHaveLength(1);
  });
});

describe("suppression", () => {
  const supprimer = (h: Record<string, string>, id: string) => request(app).delete(`/api/inspections/${id}`).set(h);
  const existe = async (id: string) => (await testDb.select().from(inspections).where(eq(inspections.id, id))).length === 1;

  it("supprime vraiment l'état des lieux en brouillon, et lui seul", async () => {
    const { manager, contract, h } = await agence();
    const cible = await createInspection(contract, manager.id);
    const autre = await createInspection(contract, manager.id);

    expect((await supprimer(h, cible.id)).status).toBe(204);

    expect(await existe(cible.id)).toBe(false);
    expect(await existe(autre.id)).toBe(true);
  });

  it("refuse de supprimer un état des lieux signé, même resté en brouillon : par le gestionnaire ou par le locataire", async () => {
    const { manager, contract, h } = await agence();
    const parGestionnaire = await createInspection(contract, manager.id, { status: "DRAFT", signedByManagerAt: new Date() });
    const parLocataire = await createInspection(contract, manager.id, { status: "DRAFT", signedByTenantAt: new Date() });

    for (const edl of [parGestionnaire, parLocataire]) {
      const res = await supprimer(h, edl.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("INSPECTION_NO_DELETE");
      expect(await existe(edl.id)).toBe(true);
    }
  });
});

describe("signature : format et journal", () => {
  const signer = (h: Record<string, string>, id: string, signatureDataUrl: string) => request(app).post(`/api/inspections/${id}/sign`).set(h).send({ signatureDataUrl });

  it("n'accepte que des images PNG, JPEG ou WebP : un SVG (qui peut porter du script) est refusé", async () => {
    const { manager, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });

    expect((await signer(h, edl.id, "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).status).toBe(400);
    expect((await signer(h, edl.id, "data:image/gif;base64,R0lGODlh")).status).toBe(400);
    for (const format of ["png", "jpeg", "jpg", "webp"]) {
      const autre = await createInspection(contract, manager.id, { status: "COMPLETED" });
      expect((await signer(h, autre.id, `data:image/${format};base64,SIGNATURE`)).status).toBe(200);
    }
  });

  it("trace chaque signature au journal : qui a signé, et sur quel bien", async () => {
    const { manager, tenant, contract, h } = await agence();
    const edl = await createInspection(contract, manager.id, { status: "COMPLETED" });

    expect((await signer(h, edl.id, PNG)).status).toBe(200);
    expect((await signer(authHeader(await tokenLocataire(tenant.id)), edl.id, PNG)).status).toBe(200);

    const lignes = (await journal(manager.id)).filter((l: { action: string; entityId: string | null }) => l.action === "inspection.sign" && l.entityId === edl.id);
    expect(lignes.map((l: { details: string | null }) => l.details).sort()).toEqual([
      "État des lieux signé électroniquement par le gestionnaire (Villa des Almadies)",
      "État des lieux signé électroniquement par le locataire (Villa des Almadies)",
    ]);
    for (const l of lignes) expect(l).toMatchObject({ entityType: "inspection", entityLabel: "Villa des Almadies" });
  });
});
