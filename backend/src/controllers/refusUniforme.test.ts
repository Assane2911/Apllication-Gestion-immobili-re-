import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contractCotenants, issueReports } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createContract,
  createInspection,
  createInsurancePolicy,
  createInvoice,
  createManager,
  createOwner,
  createPortalUser,
  createProperty,
  createTenant,
  fakeJpegBuffer,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { ApiError } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire } from "../utils/authorization";

/**
 * Isolement entre agences : un refus ne doit pas révéler qu'une ressource existe (audit d'isolement, octobre 2026).
 *
 *  1. Une ressource qui existe mais n'est pas à vous répond EXACTEMENT comme un identifiant inventé : 404 et même code.
 *     Les routes de documents, de messagerie, de paiement, de signature et d'incident répondaient 403 pour la première
 *     et 404 pour le second : on pouvait donc savoir quels identifiants existent.
 *  2. L'appartenance est vérifiée AVANT le corps de la requête : un corps mal formé visant la ressource d'une autre
 *     agence répond comme un identifiant inventé (404), pas 400.
 *
 * Exception conservée : le colocataire d'un bail (partie légitime, mais non titulaire) garde son 403 pour la signature.
 */
const INVENTE = "identifiant-inventé-0000000000";
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** L'agence A (qui possède tout) et l'agence B (l'intruse), avec leurs jetons. */
async function monde() {
  const a = await createManager();
  const b = await createManager();
  const bien = await createProperty(a.id);
  const locataire = await createTenant(a.id);
  const bail = await createContract(bien.id, locataire.id);
  const facture = await createInvoice(bail.id, { status: "PAID", paidAt: new Date() });
  const edl = await createInspection(bail, a.id);
  const proprio = await createOwner(a.id);
  const police = await createInsurancePolicy(bien.id);

  const bienB = await createProperty(b.id);
  const locataireB = await createTenant(b.id);
  await createContract(bienB.id, locataireB.id);

  return {
    a, b, bien, locataire, bail, facture, edl, proprio, police,
    jetonA: authHeader(tokenFor(a)),
    jetonB: authHeader(tokenFor(b)),
    jetonLocataireIntrus: authHeader(await tokenLocataire(locataireB.id)),
    jetonAdmin: authHeader(tokenFor(await createAdmin())),
  };
}
type Monde = Awaited<ReturnType<typeof monde>>;

/** Statut et code d'une réponse : c'est ce que l'appelant peut observer. */
const visible = (res: request.Response) => ({ statut: res.status, code: res.body?.code });

describe("même refus pour une ressource qui existe et pour un identifiant inventé", () => {
  type Intrus = "jetonB" | "jetonLocataireIntrus" | "jetonAdmin";
  type Cas = [
    string,
    (m: Monde) => {
      methode: "get" | "post";
      chemin: (id: string) => string;
      vrai: (m: Monde) => string;
      corps?: object;
      code: string;
      /** Rôles qui passent le contrôle de rôle de la route : pour les autres, le refus (403) est celui du rôle, identique pour tout identifiant. */
      roles?: Intrus[];
    },
  ];
  const cas: Cas[] = [
    ["quittance", () => ({ methode: "get", chemin: (id) => `/api/documents/receipt/${id}`, vrai: (m) => m.facture.id, code: "INVOICE_NOT_FOUND" })],
    ["bail (document)", () => ({ methode: "get", chemin: (id) => `/api/documents/lease/${id}`, vrai: (m) => m.bail.id, code: "CONTRACT_NOT_FOUND" })],
    ["bail scanné (document)", () => ({ methode: "get", chemin: (id) => `/api/documents/lease-scan/${id}`, vrai: (m) => m.bail.id, code: "CONTRACT_NOT_FOUND" })],
    ["état des lieux (document)", () => ({ methode: "get", chemin: (id) => `/api/documents/inspection/${id}`, vrai: (m) => m.edl.id, code: "INSPECTION_NOT_FOUND" })],
    ["messagerie du bail", () => ({ methode: "get", chemin: (id) => `/api/messages/${id}`, vrai: (m) => m.bail.id, code: "CONTRACT_NOT_FOUND" })],
    ["signature du bail", () => ({ methode: "post", chemin: (id) => `/api/contracts/${id}/sign`, vrai: (m) => m.bail.id, corps: { signatureDataUrl: SIGNATURE }, code: "CONTRACT_NOT_FOUND" })],
    ["signature de l'état des lieux", () => ({ methode: "post", chemin: (id) => `/api/inspections/${id}/sign`, vrai: (m) => m.edl.id, corps: { signatureDataUrl: SIGNATURE }, code: "INSPECTION_NOT_FOUND" })],
    ["paiement d'une facture", () => ({ methode: "post", chemin: (id) => `/api/invoices/${id}/pay`, vrai: (m) => m.facture.id, corps: { method: "BANK_TRANSFER" }, code: "INVOICE_NOT_FOUND", roles: ["jetonLocataireIntrus"] })],
  ];

  for (const [nom, def] of cas) {
    for (const intrus of ["jetonB", "jetonLocataireIntrus", "jetonAdmin"] as const satisfies readonly Intrus[]) {
      // Un gestionnaire ne signe/paie pas comme un locataire, mais le refus doit rester celui d'un identifiant inventé.
      it(`${nom} — ${intrus} : l'identifiant réel de l'autre agence répond comme un identifiant inventé`, async () => {
        const m = await monde();
        const d = def(m);
        const appeler = (id: string) => {
          const req = request(app)[d.methode](d.chemin(id)).set(m[intrus]);
          return d.corps ? req.send(d.corps) : req;
        };
        const reel = visible(await appeler(d.vrai(m)));
        const invente = visible(await appeler(INVENTE));
        // Invariant : l'appelant ne peut pas distinguer une ressource réelle d'une ressource inventée.
        expect(reel).toEqual(invente);
        // Quand son rôle passe le contrôle de la route, ce refus est le 404 de l'identifiant inconnu.
        if (!d.roles || d.roles.includes(intrus)) {
          expect(reel.statut).toBe(404);
          expect(reel.code).toBe(d.code);
        } else {
          expect(reel.statut).toBe(403);
        }
      });
    }
  }

  it("téléversement du scan d'un bail : l'agence B reçoit 404, comme pour un identifiant inventé", async () => {
    const m = await monde();
    const envoyer = (id: string) =>
      request(app).post(`/api/contracts/${id}/scan`).set(m.jetonB).attach("scan", fakeJpegBuffer("scan"), { filename: "bail.jpg", contentType: "image/jpeg" });
    const reel = visible(await envoyer(m.bail.id));
    expect(reel).toEqual(visible(await envoyer(INVENTE)));
    expect(reel.statut).toBe(404);
  });

  it("création d'un incident sur le bail d'un autre : 404, comme pour un bail inventé", async () => {
    const m = await monde();
    const intrus = m.jetonLocataireIntrus;
    const signaler = (contractId: string) =>
      request(app).post("/api/issues").set(intrus).field("contractId", contractId).field("title", "Fuite d'eau").field("description", "Fuite sous l'évier")
        .attach("photo", fakeJpegBuffer("photo"), { filename: "fuite.jpg", contentType: "image/jpeg" });
    const reel = visible(await signaler(m.bail.id));
    expect(reel).toEqual(visible(await signaler(INVENTE)));
    expect(reel.statut).toBe(404);
  });

  it("ajout d'une photo à l'incident d'un autre : 404, comme pour un incident inventé", async () => {
    const m = await monde();
    const [incident] = await testDb.insert(issueReports).values({ contractId: m.bail.id, tenantId: m.locataire.id, title: "Fuite", description: "Fuite sous l'évier", photoUrl: "issues/x.jpg" }).returning();
    const ajouter = (id: string) =>
      request(app).post(`/api/issues/${id}/photo`).set(m.jetonB).attach("photo", fakeJpegBuffer("photo"), { filename: "p.jpg", contentType: "image/jpeg" });
    const reel = visible(await ajouter(incident.id));
    expect(reel).toEqual(visible(await ajouter(INVENTE)));
    expect(reel.statut).toBe(404);
  });

  it("signature d'un état des lieux encore en brouillon : l'étranger ne l'apprend pas, le gestionnaire reçoit son 409", async () => {
    const m = await monde(); // état des lieux créé en brouillon
    const etranger = await request(app).post(`/api/inspections/${m.edl.id}/sign`).set(m.jetonB).send({ signatureDataUrl: SIGNATURE });
    expect(etranger.status).toBe(404);
    const inventé = await request(app).post(`/api/inspections/${INVENTE}/sign`).set(m.jetonB).send({ signatureDataUrl: SIGNATURE });
    expect(visible(etranger)).toEqual(visible(inventé));
    const proprietaire = await request(app).post(`/api/inspections/${m.edl.id}/sign`).set(m.jetonA).send({ signatureDataUrl: SIGNATURE });
    expect(proprietaire.status).toBe(409);
    expect(proprietaire.body.code).toBe("INSPECTION_NOT_FINALIZED");
  });

  it("le colocataire d'un bail garde son 403 pour la signature : il est partie au bail, mais non titulaire", async () => {
    const m = await monde();
    const coloc = await createTenant(m.a.id);
    await testDb.insert(contractCotenants).values({ contractId: m.bail.id, tenantId: coloc.id });
    const res = await request(app).post(`/api/contracts/${m.bail.id}/sign`).set(authHeader(await tokenLocataire(coloc.id))).send({ signatureDataUrl: SIGNATURE });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCESS_DENIED");
  });

  it("les ayants droit accèdent toujours à leurs ressources (le titulaire et le gestionnaire)", async () => {
    const m = await monde();
    const titulaire = authHeader(await tokenLocataire(m.locataire.id));
    expect((await request(app).get(`/api/documents/lease/${m.bail.id}`).set(titulaire)).status).toBe(200);
    expect((await request(app).get(`/api/documents/lease/${m.bail.id}`).set(m.jetonA)).status).toBe(200);
    expect((await request(app).get(`/api/documents/receipt/${m.facture.id}`).set(m.jetonA)).status).toBe(200);
    expect((await request(app).get(`/api/messages/${m.bail.id}`).set(titulaire)).status).toBe(200);
  });

  describe("assertAccesLocataireOuGestionnaire", () => {
    const lever = (...args: Parameters<typeof assertAccesLocataireOuGestionnaire>) => {
      try {
        assertAccesLocataireOuGestionnaire(...args);
      } catch (e) {
        return e as ApiError;
      }
      return null;
    };

    it("sans consigne, refuse en 403 comme avant", () => {
      const e = lever("MANAGER", false, false);
      expect(e?.statusCode).toBe(403);
    });

    it("avec le libellé d'introuvable, refuse en 404 pour tout rôle qui n'est pas partie à la ressource", () => {
      const introuvable = { message: "Contrat introuvable", code: "CONTRACT_NOT_FOUND" };
      for (const role of ["MANAGER", "TENANT", "ADMIN", "OWNER"] as const) {
        const e = lever(role, false, false, introuvable);
        expect(e?.statusCode, role).toBe(404);
        expect(e?.code, role).toBe("CONTRACT_NOT_FOUND");
      }
    });

    it("laisse passer le locataire et le gestionnaire concernés", () => {
      const introuvable = { message: "Contrat introuvable", code: "CONTRACT_NOT_FOUND" };
      expect(lever("TENANT", true, false, introuvable)).toBeNull();
      expect(lever("MANAGER", false, true, introuvable)).toBeNull();
    });
  });
});

describe("l'appartenance est vérifiée avant le corps de la requête", () => {
  type Ecriture = [string, (m: Monde) => { methode: "put" | "post"; chemin: string; jeton: (m: Monde) => object }];
  const jetonB = (m: Monde) => m.jetonB;
  const ecritures: Ecriture[] = [
    ["modifier une police d'assurance", (m) => ({ methode: "put", chemin: `/api/insurance-policies/${m.police.id}`, jeton: jetonB })],
    ["créer l'accès portail d'un locataire", (m) => ({ methode: "post", chemin: `/api/tenants/${m.locataire.id}/portal-account`, jeton: jetonB })],
    ["signer un bail (gestionnaire)", (m) => ({ methode: "post", chemin: `/api/contracts/${m.bail.id}/sign`, jeton: jetonB })],
    ["enregistrer la restitution du dépôt", (m) => ({ methode: "put", chemin: `/api/contracts/${m.bail.id}/deposit-refund`, jeton: jetonB })],
    ["réviser le loyer", (m) => ({ methode: "post", chemin: `/api/contracts/${m.bail.id}/rent-revisions`, jeton: jetonB })],
    ["ajouter un colocataire", (m) => ({ methode: "post", chemin: `/api/contracts/${m.bail.id}/cotenants`, jeton: jetonB })],
    ["ajouter un garant", (m) => ({ methode: "post", chemin: `/api/contracts/${m.bail.id}/guarantors`, jeton: jetonB })],
    ["modifier un garant", (m) => ({ methode: "put", chemin: `/api/contracts/${m.bail.id}/guarantors/inexistant`, jeton: jetonB })],
    ["émettre une mise en demeure", (m) => ({ methode: "post", chemin: `/api/contracts/${m.bail.id}/formal-notices`, jeton: jetonB })],
    ["enregistrer un reversement", (m) => ({ methode: "post", chemin: `/api/crg/${m.proprio.id}/payouts`, jeton: jetonB })],
    ["payer une facture (locataire d'une autre agence)", (m) => ({ methode: "post", chemin: `/api/invoices/${m.facture.id}/pay`, jeton: (x) => x.jetonLocataireIntrus })],
  ];

  for (const [nom, def] of ecritures) {
    it(`${nom} : un corps vide visant la ressource d'une autre agence répond 404 (pas 400)`, async () => {
      const m = await monde();
      const d = def(m);
      const res = await request(app)[d.methode](d.chemin).set(d.jeton(m) as Record<string, string>).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  }

  it("le propriétaire des données reçoit toujours le 400 de validation pour un corps mal formé", async () => {
    const m = await monde();
    for (const [methode, chemin] of [
      ["put", `/api/insurance-policies/${m.police.id}`],
      ["post", `/api/tenants/${m.locataire.id}/portal-account`],
      ["put", `/api/contracts/${m.bail.id}/deposit-refund`],
      ["post", `/api/contracts/${m.bail.id}/rent-revisions`],
      ["post", `/api/contracts/${m.bail.id}/cotenants`],
      ["post", `/api/contracts/${m.bail.id}/guarantors`],
      ["post", `/api/crg/${m.proprio.id}/payouts`],
    ] as const) {
      const res = await request(app)[methode](chemin).set(m.jetonA).send({});
      expect(res.status, `${methode} ${chemin}`).toBe(400);
    }
  });

  it("un compte qui n'est ni locataire ni gestionnaire reçoit 404 sur la signature, pas 403", async () => {
    const m = await monde();
    const proprietaire = authHeader(tokenFor(await createPortalUser("OWNER")));
    const res = await request(app).post(`/api/contracts/${m.bail.id}/sign`).set(proprietaire).send({ signatureDataUrl: SIGNATURE });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });
});
