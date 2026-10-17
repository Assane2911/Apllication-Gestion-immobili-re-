import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor,
  createPortalUser,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { deleteStorageObjectBestEffort, uploadPublicFile } from "../services/storage.service";

// Le stockage réel n'est jamais joint : on simule l'envoi, en renvoyant une URL publique de NOTRE bucket (même
// hôte, même chemin) — la seule forme qu'accepte l'application pour un logo.
const URL_LOGO = "https://placeholder.supabase.co/storage/v1/object/public/public-uploads/agency/logo-test.png";
vi.mock("../services/storage.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/storage.service")>()),
  uploadPublicFile: vi.fn().mockResolvedValue("https://placeholder.supabase.co/storage/v1/object/public/public-uploads/agency/logo-test.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/** PNG minimal valide (1×1), la signature « magique » étant vérifiée sur le contenu réel. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

describe("GET /api/agency", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/agency");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/agency")
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("crée des paramètres par défaut au premier accès", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(manager.id);
    expect(res.body.agencyName).toBe("Agence Immobilière Privée");

    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(1);
  });

  it("n'invente aucune coordonnée ni mention légale : elles s'impriment sur les quittances et les baux", async () => {
    // Les paramètres créés au premier accès contenaient un faux téléphone, un faux email et une fausse
    // « carte professionnelle n°CPI 7501 » : un gestionnaire qui ouvrait la page sans rien enregistrer
    // les voyait ensuite sur chaque document envoyé à ses locataires.
    const manager = await createManager();

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    for (const champ of ["address", "phone", "email", "legalNotice", "siretOrId"]) {
      expect(res.body[champ] ?? null).toBeNull();
    }
    expect(JSON.stringify(res.body)).not.toMatch(/CPI 7501|monagence-immo|agence\.com|40 00 00 00/);
  });

  it("ne recrée pas de paramètres à un second appel", async () => {
    const manager = await createManager();
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(1);
  });

  it("renvoie des paramètres distincts pour chaque gestionnaire", async () => {
    const manager = await createManager();
    const otherManager = await createManager();
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Manager 1" });
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(otherManager)))
      .send({ agencyName: "Agence Manager 2" });

    const res = await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Agence Manager 1");
  });
});

describe("PUT /api/agency", () => {
  it("crée les paramètres si aucun n'existe encore", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", phone: "+33 1 23 45 67 89" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Horizon Immobilier");
    expect(res.body.phone).toBe("+33 1 23 45 67 89");
  });

  it("met à jour les paramètres existants", async () => {
    const manager = await createManager();
    await request(app).get("/api/agency").set(authHeader(tokenFor(manager)));

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Nouveau Nom Agence", legalNotice: "SIRET 123 456 789" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Nouveau Nom Agence");
    expect(res.body.legalNotice).toBe("SIRET 123 456 789");
  });

  it("rejette une requête sans agencyName (champ requis)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ phone: "+33 1 00 00 00 00" });

    expect(res.status).toBe(400);
  });

  // Marque blanche (logo) : fonctionnalité Pro (CGU §3) — le reste des
  // réglages (coordonnées, IBAN...) reste ouvert à toutes les formules.
  it("laisse un gestionnaire Starter modifier ses coordonnées sans logo", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Indépendante", iban: "FR7630006000011234567890189" });

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Agence Indépendante");
  });

  it("refuse à un gestionnaire Starter d'envoyer un logo", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });

    const res = await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", PNG_1X1, { filename: "logo.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Professionnel");
  });

  it("autorise un gestionnaire Pro à envoyer son logo, qui s'enregistre sur son agence", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", PNG_1X1, { filename: "logo.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.logoUrl).toBe(URL_LOGO);
    const [ligne] = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(ligne.logoUrl).toBe(URL_LOGO);
  });

  it("refuse un fichier qui n'est pas une image PNG ou JPEG, même sous un type déclaré valide", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const faux = await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", Buffer.from("<html><script>alert(1)</script></html>"), { filename: "logo.png", contentType: "image/png" });
    expect(faux.status).toBe(400);

    const gif = await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", Buffer.from("GIF89a"), { filename: "logo.gif", contentType: "image/gif" });
    expect(gif.status).toBe(400);
  });

  it("refuse un logo dépassant 2 Mo avec la limite propre au logo", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024 + 1)]), { filename: "gros.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("2 Mo");
  });

  it("n'enregistre jamais une adresse de logo saisie à la main : seul l'envoi du fichier le permet", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Pro", logoUrl: "https://exemple.test/pixel-espion.png" });

    expect(res.status).toBe(400);
  });

  it("garde le logo à chaque enregistrement du formulaire, et permet de le retirer", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", PNG_1X1, { filename: "logo.png", contentType: "image/png" });

    // Le formulaire renvoie le logo actuel tel quel : l'enregistrement ne doit ni le refuser ni le perdre.
    const garde = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Pro", logoUrl: URL_LOGO });
    expect(garde.status).toBe(200);
    expect(garde.body.logoUrl).toBe(URL_LOGO);

    const retire = await request(app).delete("/api/agency/logo").set(authHeader(tokenFor(manager)));
    expect(retire.status).toBe(204);
    const [ligne] = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(ligne.logoUrl).toBeNull();
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(await createPortalUser("TENANT"), "tenant-1")))
      .send({ agencyName: "Tentative" });
    expect(res.status).toBe(403);
  });
});

/**
 * Tampon de l'agence, imprimé sur les quittances. Même règle que le logo : envoi d'un fichier PNG/JPEG
 * (jamais une adresse libre), formule Pro, retrait toujours permis.
 */
describe("Tampon de l'agence", () => {
  const URL_TAMPON = "https://placeholder.supabase.co/storage/v1/object/public/public-uploads/agency/tampon-test.png";
  // Le stockage simulé répond selon le champ envoyé : une réponse « une fois » restée en file (envoi refusé
  // avant le stockage) fausserait le test suivant.
  beforeEach(() => {
    vi.mocked(uploadPublicFile).mockImplementation(async (file) => (file.fieldname === "stamp" ? URL_TAMPON : URL_LOGO));
  });
  const envoyerTampon = (manager: Awaited<ReturnType<typeof createManager>>, fichier = PNG_1X1) => {
    return request(app)
      .post("/api/agency/stamp")
      .set(authHeader(tokenFor(manager)))
      .attach("stamp", fichier, { filename: "tampon.png", contentType: "image/png" });
  };

  it("refuse à un gestionnaire Starter d'envoyer un tampon", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });

    const res = await envoyerTampon(manager);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Professionnel");
  });

  it("autorise un gestionnaire Pro à envoyer son tampon, sans toucher à son logo", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    await request(app)
      .post("/api/agency/logo")
      .set(authHeader(tokenFor(manager)))
      .attach("logo", PNG_1X1, { filename: "logo.png", contentType: "image/png" });

    const res = await envoyerTampon(manager);

    expect(res.status).toBe(201);
    expect(res.body.stampOrSignatureUrl).toBe(URL_TAMPON);
    const [ligne] = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(ligne.stampOrSignatureUrl).toBe(URL_TAMPON);
    expect(ligne.logoUrl).toBe(URL_LOGO);
  });

  it("refuse un fichier qui n'est pas une image PNG ou JPEG, même sous un type déclaré valide", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const faux = await envoyerTampon(manager, Buffer.from("<html><script>alert(1)</script></html>"));
    expect(faux.status).toBe(400);

    const gif = await request(app)
      .post("/api/agency/stamp")
      .set(authHeader(tokenFor(manager)))
      .attach("stamp", Buffer.from("GIF89a"), { filename: "tampon.gif", contentType: "image/gif" });
    expect(gif.status).toBe(400);
    expect(gif.body.error).toContain("Tampon");
  });

  it("refuse un tampon dépassant 2 Mo avec la limite propre aux images d'agence", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await envoyerTampon(manager, Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024 + 1)]));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("2 Mo");
  });

  it("n'enregistre jamais une adresse de tampon saisie à la main, même Pro", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Pro", stampOrSignatureUrl: "https://exemple.test/pixel-espion.png" });

    expect(res.status).toBe(400);
  });

  it("garde le tampon à chaque enregistrement du formulaire, et permet de le retirer", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    await envoyerTampon(manager);

    const garde = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Agence Pro", stampOrSignatureUrl: URL_TAMPON });
    expect(garde.status).toBe(200);
    expect(garde.body.stampOrSignatureUrl).toBe(URL_TAMPON);

    const retire = await request(app).delete("/api/agency/stamp").set(authHeader(tokenFor(manager)));
    expect(retire.status).toBe(204);
    const [ligne] = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(ligne.stampOrSignatureUrl).toBeNull();
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith(URL_TAMPON);
  });

  it("laisse un gestionnaire repassé en Starter retirer son tampon", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "A", stampOrSignatureUrl: URL_TAMPON });

    const retire = await request(app).delete("/api/agency/stamp").set(authHeader(tokenFor(manager)));

    expect(retire.status).toBe(204);
    const [ligne] = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(ligne.stampOrSignatureUrl).toBeNull();
  });
});

/**
 * L'IBAN/BIC est montré tel quel au locataire pour lui dire où envoyer son
 * virement (voir tenant.controller / TenantInvoicesPage.tsx) : une faute de
 * frappe qui passerait la validation enverrait un locataire vers un compte
 * qui n'existe pas, sans qu'aucun message ne prévienne le gestionnaire avant
 * qu'un premier virement échoue à l'autre bout.
 */
describe("PUT /api/agency — IBAN / BIC", () => {
  it("enregistre un IBAN/BIC valides, normalisés (espaces retirés, majuscules)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", iban: "fr76 3000 6000 0112 3456 7890 189", bic: "bnpafrpp xxx" });

    expect(res.status).toBe(200);
    expect(res.body.iban).toBe("FR7630006000011234567890189");
    expect(res.body.bic).toBe("BNPAFRPPXXX");
  });

  it("rejette (400) un IBAN dont la clé de contrôle est fausse", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      // Deux chiffres inversés au milieu par rapport à un IBAN réel.
      .send({ agencyName: "Horizon Immobilier", iban: "FR76 3000 6000 0112 3456 7809 189" });

    expect(res.status).toBe(400);
    const rows = await testDb.select().from(agencySettings).where(eq(agencySettings.userId, manager.id));
    expect(rows).toHaveLength(0);
  });

  it("rejette (400) un BIC de mauvaise longueur", async () => {
    const manager = await createManager();

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", bic: "BNPAFRP" });

    expect(res.status).toBe(400);
  });

  it("accepte une chaîne vide comme effacement du champ, sans le traiter comme invalide", async () => {
    const manager = await createManager();
    await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", iban: "FR7630006000011234567890189" });

    const res = await request(app)
      .put("/api/agency")
      .set(authHeader(tokenFor(manager)))
      .send({ agencyName: "Horizon Immobilier", iban: "" });

    expect(res.status).toBe(200);
    expect(res.body.iban).toBeNull();
  });
});

describe("GET /api/agency/mine (portail locataire)", () => {
  async function setupLocataire(agencyOverrides: { iban?: string; bic?: string } = {}) {
    const manager = await createManager();
    if (agencyOverrides.iban || agencyOverrides.bic) {
      await request(app)
        .put("/api/agency")
        .set(authHeader(tokenFor(manager)))
        .send({ agencyName: "Horizon Immobilier", ...agencyOverrides });
    }
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);
    const tenantToken = await tokenLocataire(tenant.id);
    return { manager, tenant, tenantToken };
  }

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/agency/mine").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("renvoie l'IBAN/BIC de l'agence de son propre gestionnaire, pas d'un autre", async () => {
    const { tenantToken } = await setupLocataire({ iban: "FR7630006000011234567890189", bic: "BNPAFRPPXXX" });
    // Une autre agence, avec son propre IBAN : ne doit jamais fuiter ici.
    await setupLocataire({ iban: "DE89370400440532013000" });

    const res = await request(app).get("/api/agency/mine").set(authHeader(tenantToken));

    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe("Horizon Immobilier");
    expect(res.body.iban).toBe("FR7630006000011234567890189");
    expect(res.body.bic).toBe("BNPAFRPPXXX");
  });

  it("renvoie null plutôt qu'une erreur quand l'agence n'a pas encore renseigné son IBAN", async () => {
    const { tenantToken } = await setupLocataire();

    const res = await request(app).get("/api/agency/mine").set(authHeader(tenantToken));

    expect(res.status).toBe(200);
    expect(res.body.iban).toBeNull();
    expect(res.body.bic).toBeNull();
  });
});
