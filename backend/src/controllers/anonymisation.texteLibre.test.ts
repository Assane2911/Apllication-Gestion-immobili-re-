import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { inspections, issueReports, messages } from "../db/schema";
import { authHeader, createContract, createInspection, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit de la protection des données (octobre 2026) : l'anonymisation d'un locataire vidait sa fiche, son compte de
 * portail, ses garants et le journal d'activité, mais laissait son nom, son email et son téléphone là où il est
 * écrit en texte libre : titre, description et note du gestionnaire de ses signalements, commentaires et notes de
 * pièces de ses états des lieux.
 *
 * Les messages (preuve d'un échange entre deux parties) et les photos des signalements (preuve de l'état du
 * logement, utile à la restitution de la caution) restent volontairement en place : voir anonymiserTenant.
 */
const PRENOM = "Zorglub";
const NOM = "Quenotte";
const EMAIL = "zorglub.quenotte@example.com";
const TELEPHONE = "+33699887766";

async function locataireAvecTextesLibres() {
  const manager = await createManager({});
  const property = await createProperty(manager.id, { title: "Résidence des Tilleuls", address: "12 rue des Lilas" });
  const tenant = await createTenant(manager.id, { firstName: PRENOM, lastName: NOM, email: EMAIL, phone: TELEPHONE });
  const contract = await createContract(property.id, tenant.id, {});

  const [signalement] = await testDb
    .insert(issueReports)
    .values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: `Fuite signalée par ${PRENOM} ${NOM}`,
      description: `Bonjour, c'est ${PRENOM} ${NOM}, joignable au ${TELEPHONE} ou à ${EMAIL}. La fuite est sous l'évier.`,
      photoUrl: "issues/fuite-evier.jpg",
      managerNote: `Rappeler ${PRENOM} ${NOM} demain`,
    } as typeof issueReports.$inferInsert)
    .returning();

  const inspection = await createInspection(contract, manager.id, {
    roomsData: JSON.stringify([{ name: "Salon", condition: "GOOD", notes: `${PRENOM} ${NOM} présent à la visite` }]),
    keysData: JSON.stringify([{ label: `Clé remise à ${PRENOM} ${NOM}`, quantity: 2 }]),
    metersData: JSON.stringify({ water: `relevé fait avec ${PRENOM} ${NOM}` }),
    generalComments: `État constaté en présence de ${PRENOM} ${NOM} (${TELEPHONE}).`,
  } as Partial<typeof inspections.$inferInsert>);

  const [message] = await testDb
    .insert(messages)
    .values({ contractId: contract.id, tenantId: tenant.id, senderId: manager.id, senderRole: "MANAGER", content: `Bonjour ${PRENOM} ${NOM}` } as typeof messages.$inferInsert)
    .returning();

  return { manager, tenant, contract, signalement, inspection, message, header: authHeader(tokenFor(manager)) };
}

const anonymiser = (id: string, header: Record<string, string>) => request(app).post(`/api/tenants/${id}/anonymiser`).set(header).send({});

describe("anonymisation d'un locataire — texte libre", () => {
  it("efface le nom, l'email et le téléphone des signalements du locataire", async () => {
    const { tenant, signalement, header } = await locataireAvecTextesLibres();
    expect((await anonymiser(tenant.id, header)).status).toBe(200);

    const [apres] = await testDb.select().from(issueReports).where(eq(issueReports.id, signalement.id));
    const texte = [apres.title, apres.description, apres.managerNote].join("\n");
    for (const secret of [PRENOM, NOM, EMAIL, TELEPHONE]) expect(texte).not.toContain(secret);
    // Le reste du texte, lui, est conservé : c'est le contenu du signalement.
    expect(apres.title).toBe("Fuite signalée par Locataire anonymisé");
    expect(apres.description).toContain("La fuite est sous l'évier.");
    expect(apres.managerNote).toBe("Rappeler Locataire anonymisé demain");
  });

  it("efface le nom et le téléphone dans les commentaires et notes de l'état des lieux, en gardant un JSON valide", async () => {
    const { tenant, inspection, header } = await locataireAvecTextesLibres();
    await anonymiser(tenant.id, header);

    const [apres] = await testDb.select().from(inspections).where(eq(inspections.id, inspection.id));
    const texte = [apres.roomsData, apres.keysData, apres.metersData, apres.generalComments].join("\n");
    for (const secret of [PRENOM, NOM, TELEPHONE]) expect(texte).not.toContain(secret);
    expect(JSON.parse(apres.roomsData!)[0].notes).toBe("Locataire anonymisé présent à la visite");
    expect(JSON.parse(apres.keysData!)[0]).toEqual({ label: "Clé remise à Locataire anonymisé", quantity: 2 });
    expect(JSON.parse(apres.metersData!).water).toBe("relevé fait avec Locataire anonymisé");
    expect(apres.generalComments).toContain("État constaté en présence de Locataire anonymisé");
  });

  it("ne touche pas aux signalements ni aux états des lieux d'un autre locataire de la même agence", async () => {
    const { manager, property, tenant, header } = await (async () => {
      const base = await locataireAvecTextesLibres();
      const property = await createProperty(base.manager.id, { title: "Autre bien", address: "3 avenue Verte" });
      return { manager: base.manager, property, tenant: base.tenant, header: base.header };
    })();
    const voisin = await createTenant(manager.id, { firstName: "Camille", lastName: "Durand" });
    const contratVoisin = await createContract(property.id, voisin.id, {});
    const [signalementVoisin] = await testDb
      .insert(issueReports)
      .values({
        contractId: contratVoisin.id,
        tenantId: voisin.id,
        title: `Camille Durand signale une panne, après un échange avec ${PRENOM} ${NOM}`,
        description: "Panne de chauffage",
        photoUrl: "issues/chauffage.jpg",
      } as typeof issueReports.$inferInsert)
      .returning();

    await anonymiser(tenant.id, header);

    // Seules les lignes du locataire anonymisé sont réécrites : la ligne du voisin garde son texte tel quel.
    const [apres] = await testDb.select().from(issueReports).where(eq(issueReports.id, signalementVoisin.id));
    expect(apres.title).toBe(signalementVoisin.title);
    expect(apres.description).toBe("Panne de chauffage");
  });

  it("laisse en place les messages et les photos, qui servent de preuve", async () => {
    const { tenant, signalement, message, header } = await locataireAvecTextesLibres();
    await anonymiser(tenant.id, header);

    const [msg] = await testDb.select().from(messages).where(eq(messages.id, message.id));
    expect(msg.content).toBe(`Bonjour ${PRENOM} ${NOM}`);
    const [apres] = await testDb.select().from(issueReports).where(eq(issueReports.id, signalement.id));
    expect(apres.photoUrl).toBe("issues/fuite-evier.jpg");
  });

  it("une fiche sans texte libre s'anonymise comme avant", async () => {
    const manager = await createManager({});
    const tenant = await createTenant(manager.id, {});
    const res = await anonymiser(tenant.id, authHeader(tokenFor(manager)));
    expect(res.status).toBe(200);
  });
});
