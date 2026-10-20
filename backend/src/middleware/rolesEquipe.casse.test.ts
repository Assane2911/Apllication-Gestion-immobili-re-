import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import type { RoleEquipe } from "../utils/rolesEquipe";
import { verifierAutorisationEquipe } from "../utils/rolesEquipe";

/**
 * Express route sans tenir compte de la casse (`/api/Activity-Log` atteint la même route que
 * `/api/activity-log`). Si la matrice des rôles compare le chemin brut et en respectant la casse, une lecture
 * sensible refusée à un collaborateur restreint redevient permise en écrivant une majuscule dans l'URL.
 */
let ctx: { owner: Awaited<ReturnType<typeof createManager>>; tenantId: string };
beforeEach(async () => {
  const owner = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(owner.id);
  const tenant = await createTenant(owner.id);
  await createContract(property.id, tenant.id, { status: "ACTIVE" });
  ctx = { owner, tenantId: tenant.id };
});

async function jeton(role: RoleEquipe) {
  const c = await createTeamMember(ctx.owner.id, { teamRole: role });
  return tokenFor({ id: ctx.owner.id, role: "MANAGER" }, null, null, c.id);
}

describe("lectures sensibles : la casse de l'URL ne change pas le verdict", () => {
  it.each([
    ["/api/activity-log"],
    ["/api/Activity-Log"],
    ["/API/activity-log"],
    ["/api/fiscal/fec"],
    ["/api/Fiscal/FEC"],
    ["/api/conservation/echeances"],
    ["/api/CONSERVATION/echeances"],
  ])("READ_ONLY est refusé sur %s", async (url) => {
    const res = await request(app).get(url).set(authHeader(await jeton("READ_ONLY")));
    expect(res.status, url).toBe(403);
  });

  it("READ_ONLY est refusé sur l'export des données d'un locataire, quelle que soit la casse", async () => {
    const token = await jeton("READ_ONLY");
    for (const url of [`/api/tenants/${ctx.tenantId}/export`, `/api/Tenants/${ctx.tenantId}/Export`, `/api/TENANTS/${ctx.tenantId}/EXPORT`]) {
      const res = await request(app).get(url).set(authHeader(token));
      expect(res.status, url).toBe(403);
    }
  });

  it("la matrice elle-même ignore la casse", () => {
    expect(verifierAutorisationEquipe("READ_ONLY", "GET", "/API/Activity-Log").autorise).toBe(false);
    expect(verifierAutorisationEquipe("AGENT", "GET", "/api/Fiscal/FEC").autorise).toBe(false);
    expect(verifierAutorisationEquipe("ACCOUNTANT", "GET", "/api/Tenants/abc/ID-Document-URL").autorise).toBe(false);
    // Et ne refuse pas à tort ce qui est permis.
    expect(verifierAutorisationEquipe("ACCOUNTANT", "GET", "/api/Fiscal/FEC").autorise).toBe(true);
    expect(verifierAutorisationEquipe("AGENT", "POST", "/API/Properties").autorise).toBe(true);
  });
});
