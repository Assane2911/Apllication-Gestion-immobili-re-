import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { MAX_UPLOAD_SIZE_MB } from "./upload";

// upload.ts est le filtre d'entrée de tous les fichiers acceptés par l'API
// (images de biens, pièces d'identité de locataires, photos d'incidents) :
// liste blanche de types MIME et limite de taille. C'est un contrôle de
// sécurité, mais aussi une source d'erreurs *client* — et jusqu'ici tout
// refus repartait en 500 "Erreur interne du serveur", ce qui empêchait le
// client de savoir quoi corriger et faisait remonter chaque tentative à
// Sentry comme un défaut applicatif.

async function tenantWithContract() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { contract, token: authHeader(tokenFor({ id: "portail", role: "TENANT" }, tenant.id)) };
}

function postIssueWith(contractId: string, token: Record<string, string>) {
  return request(app)
    .post("/api/issues")
    .set(token)
    .field("contractId", contractId)
    .field("title", "Fuite d'eau")
    .field("description", "Fuite sous l'évier");
}

describe("filtre d'upload", () => {
  beforeEach(() => {
    // Sert à vérifier qu'un refus d'upload n'est jamais journalisé comme une
    // panne serveur : type interdit (ApiError 400) comme dépassement de taille
    // (MulterError) sont des erreurs du client.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("accepte une image dont le type est sur la liste blanche", async () => {
    const { contract, token } = await tenantWithContract();

    const res = await postIssueWith(contract.id, token).attach("photo", Buffer.from("image"), {
      filename: "fuite.jpg",
      contentType: "image/jpeg",
    });

    expect(res.status).toBe(201);
  });

  it("accepte aussi un PDF (pièce d'identité, justificatif)", async () => {
    const { contract, token } = await tenantWithContract();

    const res = await postIssueWith(contract.id, token).attach("photo", Buffer.from("%PDF-1.4"), {
      filename: "constat.pdf",
      contentType: "application/pdf",
    });

    expect(res.status).toBe(201);
  });

  it("refuse un exécutable avec un 400 explicite, et non un 500 opaque", async () => {
    const { contract, token } = await tenantWithContract();

    const res = await postIssueWith(contract.id, token).attach("photo", Buffer.from("MZ"), {
      filename: "virus.exe",
      contentType: "application/x-msdownload",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Type de fichier non autorisé");
    // Un refus attendu n'est pas une panne : ni trace d'erreur, ni remontée.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("refuse un fichier texte déguisé en pièce jointe", async () => {
    const { contract, token } = await tenantWithContract();

    const res = await postIssueWith(contract.id, token).attach("photo", Buffer.from("notes"), {
      filename: "notes.txt",
      contentType: "text/plain",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Type de fichier non autorisé");
  });

  it("refuse un fichier dépassant la taille maximale, en indiquant la limite", async () => {
    const { contract, token } = await tenantWithContract();
    const tropGros = Buffer.alloc((MAX_UPLOAD_SIZE_MB + 1) * 1024 * 1024, 1);

    const res = await postIssueWith(contract.id, token).attach("photo", tropGros, {
      filename: "panorama.jpg",
      contentType: "image/jpeg",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(`${MAX_UPLOAD_SIZE_MB} Mo`);
    expect(res.body.code).toBe("LIMIT_FILE_SIZE");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("accepte un fichier juste sous la limite de taille", async () => {
    const { contract, token } = await tenantWithContract();
    const presqueTropGros = Buffer.alloc(MAX_UPLOAD_SIZE_MB * 1024 * 1024 - 1024, 1);

    const res = await postIssueWith(contract.id, token).attach("photo", presqueTropGros, {
      filename: "panorama.jpg",
      contentType: "image/jpeg",
    });

    expect(res.status).toBe(201);
  });
});
