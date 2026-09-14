import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as storageService from "../services/storage.service";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createProperty,
  createTenant,
  fakeJpegBuffer,
  tokenFor,
} from "../test/authHelpers";

function tenantToken(tenantId: string, userId = "tenant-user") {
  return authHeader(tokenFor({ id: userId, role: "TENANT" }, tenantId));
}

describe("POST /api/issues", () => {
  it("refuse la création sans photo", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine");

    expect(res.status).toBe(400);
  });

  it("crée un signalement avec photo pour le locataire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "fuite.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Fuite d'eau");
    expect(res.body.status).toBe("OPEN");
    expect(res.body.photoUrl).toContain("http://test.local/signed/");
  });

  it("refuse un type de fichier non autorisé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", Buffer.from("not-an-image"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("refuse la création pour un contrat qui n'appartient pas au locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(otherTenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "fuite.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/issues/mine", () => {
  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/issues/mine").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("renvoie uniquement les signalements du locataire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);
    const otherContract = await createContract(property.id, otherTenant.id);

    await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Mon incident")
      .field("description", "Description de mon incident")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });
    await request(app)
      .post("/api/issues")
      .set(tenantToken(otherTenant.id))
      .field("contractId", otherContract.id)
      .field("title", "Incident d'un autre")
      .field("description", "Description d'un autre incident")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "b.jpg", contentType: "image/jpeg" });

    const res = await request(app).get("/api/issues/mine").set(tenantToken(tenant.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Mon incident");
  });
});

describe("GET /api/issues", () => {
  it("refuse l'accès à un locataire", async () => {
    const res = await request(app).get("/api/issues").set(tenantToken("some-tenant-id"));
    expect(res.status).toBe(403);
  });

  it("renvoie uniquement les signalements des biens du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Incident chez moi")
      .field("description", "Description de l'incident")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherManager = await createManager();
    const otherProperty = await createProperty(otherManager.id);
    const otherTenant = await createTenant(otherManager.id);
    const otherContract = await createContract(otherProperty.id, otherTenant.id);
    await request(app)
      .post("/api/issues")
      .set(tenantToken(otherTenant.id))
      .field("contractId", otherContract.id)
      .field("title", "Incident chez un autre")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "b.jpg", contentType: "image/jpeg" });

    const res = await request(app).get("/api/issues").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Incident chez moi");
  });

  it("filtre par statut", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Incident à traiter")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "RESOLVED" });

    const res = await request(app)
      .get("/api/issues")
      .query({ status: "OPEN" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});

describe("PUT /api/issues/:id/status", () => {
  it("met à jour le statut et la note du gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "IN_PROGRESS", managerNote: "Plombier envoyé demain" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.managerNote).toBe("Plombier envoyé demain");
  });

  it("refuse la mise à jour d'un signalement d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherManager = await createManager();
    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ status: "RESOLVED" });

    expect(res.status).toBe(404);
  });

  it("rejette un statut invalide", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "NIMPORTEQUOI" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/issues/:id/photo", () => {
  it("le locataire propriétaire peut ajouter une photo supplémentaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(tenantToken(tenant.id))
      .attach("photo", fakeJpegBuffer("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(200);
    const additional = JSON.parse(res.body.additionalPhotos);
    expect(additional).toHaveLength(1);
  });

  it("le gestionnaire propriétaire du bien peut aussi ajouter une photo", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(authHeader(tokenFor(manager)))
      .attach("photo", fakeJpegBuffer("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(200);
  });

  it("refuse l'ajout de photo par un locataire non concerné", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherTenant = await createTenant(manager.id);
    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(tenantToken(otherTenant.id))
      .attach("photo", fakeJpegBuffer("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });

  it("refuse l'ajout de photo par un gestionnaire n'ayant pas ce bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherManager = await createManager();
    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(authHeader(tokenFor(otherManager)))
      .attach("photo", fakeJpegBuffer("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });

  /**
   * Régression : le contrôle d'accès (deux `if` indépendants, un pour TENANT,
   * un pour MANAGER) laissait passer silencieusement tout autre rôle — un
   * compte ADMIN pouvait ainsi ajouter une photo à n'importe quel signalement
   * d'incident de n'importe quel gestionnaire/locataire de la plateforme.
   * Cette route n'a d'ailleurs aucun `requireRole` (voir issue.routes.ts) :
   * seul ce contrôle applicatif protégeait la ressource.
   */
  it("refuse l'ajout de photo par un administrateur", async () => {
    const manager = await createManager();
    const admin = await createAdmin();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(authHeader(tokenFor(admin)))
      .attach("photo", fakeJpegBuffer("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });

  /**
   * Régression : `additionalPhotos` était lu, combiné en mémoire avec la
   * nouvelle photo, puis réécrit en entier. Deux ajouts de photo à quelques
   * millisecondes d'intervalle (deux onglets, une appli mobile qui retente)
   * partaient tous deux du même tableau de départ ; la seconde écriture
   * remplaçait la première au lieu de s'y ajouter.
   *
   * On force ici l'entrelacement qui produisait le bug — la première requête
   * se bloque juste après avoir démarré son upload, le temps que la seconde
   * termine intégralement le sien — plutôt que de compter sur un vrai
   * parallélisme, non garanti et instable en intégration continue.
   */
  describe("POST /api/issues/:id/photo — concurrence", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("n'écrase pas une photo ajoutée par une requête concurrente", async () => {
      const manager = await createManager();
      const property = await createProperty(manager.id);
      const tenant = await createTenant(manager.id);
      const contract = await createContract(property.id, tenant.id);
      const createRes = await request(app)
        .post("/api/issues")
        .set(tenantToken(tenant.id))
        .field("contractId", contract.id)
        .field("title", "Fuite d'eau")
        .field("description", "Description")
        .attach("photo", fakeJpegBuffer("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });
      const issueId = createRes.body.id;

      let debloquerPremiere: (url: string) => void;
      const premierUploadBloque = new Promise<string>((resolve) => {
        debloquerPremiere = resolve;
      });
      let signalerPremierAppelEnCours: () => void;
      const premierAppelEnCours = new Promise<void>((resolve) => {
        signalerPremierAppelEnCours = resolve;
      });

      let appel = 0;
      vi.spyOn(storageService, "uploadPrivateFile").mockImplementation(async () => {
        appel += 1;
        if (appel === 1) {
          signalerPremierAppelEnCours();
          return premierUploadBloque;
        }
        return "http://test.local/deuxieme-photo.jpg";
      });

      // supertest/superagent ne déclenche l'appel HTTP qu'au premier `.then`
      // (ou `await`) sur la requête : on l'enchaîne donc immédiatement dans
      // une Promise ordinaire pour la lancer maintenant, sans pour autant
      // bloquer ici en l'attendant tout de suite.
      const requetePremiere = request(app)
        .post(`/api/issues/${issueId}/photo`)
        .set(tenantToken(tenant.id))
        .attach("photo", fakeJpegBuffer("photo-a"), { filename: "a2.jpg", contentType: "image/jpeg" })
        .then((res) => res);

      // Attend que la première requête ait bien atteint (et soit bloquée
      // dans) son upload avant de lancer la seconde — pas un délai arbitraire.
      await premierAppelEnCours;

      const requeteSeconde = await request(app)
        .post(`/api/issues/${issueId}/photo`)
        .set(authHeader(tokenFor(manager)))
        .attach("photo", fakeJpegBuffer("photo-b"), { filename: "b2.jpg", contentType: "image/jpeg" });

      expect(requeteSeconde.status).toBe(200);
      expect(JSON.parse(requeteSeconde.body.additionalPhotos)).toEqual(["http://test.local/deuxieme-photo.jpg"]);

      // La première requête ne reprend (et n'écrit) qu'après que la seconde
      // a déjà écrit sa propre photo en base.
      debloquerPremiere!("http://test.local/premiere-photo.jpg");
      const premiere = await requetePremiere;

      expect(premiere.status).toBe(200);
      const photosFinales: string[] = JSON.parse(premiere.body.additionalPhotos);
      expect(photosFinales).toHaveLength(2);
      expect(photosFinales.sort()).toEqual(
        ["http://test.local/deuxieme-photo.jpg", "http://test.local/premiere-photo.jpg"].sort()
      );
    });
  });
});
