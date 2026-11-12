import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { storedDocuments } from "../db/schema";
import { getSignedUrl } from "../services/storage.service";
import { authHeader, createManager, createProperty, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { CATEGORIES_DOCUMENT, CATEGORIES_DOCUMENT_SENSIBLES } from "../utils/categoriesDocument";
import type { RoleEquipe } from "../utils/rolesEquipe";

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn(),
  getSignedUrl: vi.fn(),
  deleteStorageObjectBestEffort: vi.fn(),
}));

/**
 * Audit de sécurité : la pièce d'identité d'un locataire n'est ouverte qu'à l'exploitation courante (`/tenants/:id/id-document-url`).
 * Les documents rangés de catégorie identité, revenus ou garanties sont les mêmes pièces : un collaborateur comptable ou en
 * lecture seule pouvait les ouvrir par `/stored-documents/:id/link`, que le contrôle central des rôles (qui ne voit que le
 * chemin) laisse passer en lecture.
 */
beforeEach(() => {
  vi.mocked(getSignedUrl).mockReset().mockResolvedValue("http://test.local/signed/piece.pdf");
});

async function agence(categorie: (typeof CATEGORIES_DOCUMENT)[number]) {
  const owner = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const bien = await createProperty(owner.id);
  const [doc] = await testDb
    .insert(storedDocuments)
    .values({ managerId: owner.id, propertyId: bien.id, category: categorie, title: "Pièce", filePath: "documents/x.pdf", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 })
    .returning();
  return { owner, doc };
}

async function jetonCollaborateur(ownerId: string, role: RoleEquipe) {
  const c = await createTeamMember(ownerId, { teamRole: role });
  return authHeader(tokenFor({ id: ownerId, role: "MANAGER" }, null, null, c.id));
}

describe("GET /api/stored-documents/:id/link : pièces personnelles", () => {
  it.each(CATEGORIES_DOCUMENT_SENSIBLES)("refuse une pièce %s à un comptable et à la lecture seule", async (categorie) => {
    const { owner, doc } = await agence(categorie);
    for (const role of ["ACCOUNTANT", "READ_ONLY"] as const) {
      const res = await request(app).get(`/api/stored-documents/${doc.id}/link`).set(await jetonCollaborateur(owner.id, role));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ROLE_EQUIPE_INSUFFISANT");
    }
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it.each(CATEGORIES_DOCUMENT_SENSIBLES)("laisse l'agent, le rôle complet et le propriétaire ouvrir une pièce %s", async (categorie) => {
    const { owner, doc } = await agence(categorie);
    for (const entete of [await jetonCollaborateur(owner.id, "AGENT"), await jetonCollaborateur(owner.id, "FULL"), authHeader(tokenFor(owner))]) {
      const res = await request(app).get(`/api/stored-documents/${doc.id}/link`).set(entete);
      expect(res.status).toBe(200);
      expect(res.body.url).toBe("http://test.local/signed/piece.pdf");
    }
  });

  it.each(CATEGORIES_DOCUMENT.filter((c) => !CATEGORIES_DOCUMENT_SENSIBLES.includes(c)))("laisse un comptable ouvrir un document %s (pas une pièce personnelle)", async (categorie) => {
    const { owner, doc } = await agence(categorie);

    const res = await request(app).get(`/api/stored-documents/${doc.id}/link`).set(await jetonCollaborateur(owner.id, "ACCOUNTANT"));

    expect(res.status).toBe(200);
  });
});
