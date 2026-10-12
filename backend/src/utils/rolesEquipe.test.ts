import { describe, expect, it } from "vitest";
import {
  ROLES_EQUIPE,
  type RoleEquipe,
  normaliserChemin,
  roleEquipeEffectif,
  verifierAutorisationEquipe,
} from "./rolesEquipe";

const ok = (role: RoleEquipe, methode: string, url: string) => verifierAutorisationEquipe(role, methode, url).autorise;

describe("rôle effectif", () => {
  it("un rôle jamais choisi vaut les droits d'avant (FULL)", () => {
    expect(roleEquipeEffectif(null)).toBe("FULL");
    expect(roleEquipeEffectif(undefined)).toBe("FULL");
  });
  it("un rôle connu est conservé", () => {
    for (const r of ROLES_EQUIPE) expect(roleEquipeEffectif(r)).toBe(r);
  });
  it("une valeur inconnue (donnée corrompue) échoue fermé : lecture seule", () => {
    expect(roleEquipeEffectif("SUPERADMIN")).toBe("READ_ONLY");
    expect(roleEquipeEffectif("")).toBe("READ_ONLY");
  });
});

describe("normalisation du chemin", () => {
  it.each([
    ["/api/properties?page=2", "/properties"],
    ["/api/properties/", "/properties"],
    ["/api/tenants/abc/export?x=1#y", "/tenants/abc/export"],
    ["/api", "/api"],
  ])("%s → %s", (entree, attendu) => {
    expect(normaliserChemin(entree)).toBe(attendu);
  });
});

describe("FULL : aucune restriction", () => {
  it.each([
    ["PUT", "/api/agency"],
    ["DELETE", "/api/properties/p1"],
    ["GET", "/api/tenants/t1/export"],
    ["POST", "/api/invoices/i1/mark-paid"],
    ["GET", "/api/activity-log"],
  ])("%s %s", (m, u) => expect(ok("FULL", m, u)).toBe(true));
});

describe("READ_ONLY : consultation seulement", () => {
  it.each([
    "/api/properties",
    "/api/properties/p1",
    "/api/tenants",
    "/api/invoices?status=LATE",
    "/api/documents/receipt/i1",
    "/api/agency",
    "/api/dashboard/stats",
    "/api/team",
  ])("peut lire %s", (u) => expect(ok("READ_ONLY", "GET", u)).toBe(true));

  it.each([
    ["POST", "/api/properties"],
    ["PUT", "/api/properties/p1"],
    ["DELETE", "/api/properties/p1"],
    ["POST", "/api/tenants"],
    ["POST", "/api/contracts"],
    ["POST", "/api/invoices/i1/mark-paid"],
    ["POST", "/api/invoices/i1/send-reminder"],
    ["POST", "/api/expenses"],
    ["PUT", "/api/agency"],
    ["POST", "/api/messages/c1"],
    ["POST", "/api/import"],
    ["POST", "/api/import/preview"],
    ["PATCH", "/api/team/u1/role"],
    ["DELETE", "/api/team/u1"],
  ])("ne peut pas %s %s", (m, u) => expect(ok("READ_ONLY", m, u)).toBe(false));

  it.each(["/api/tenants/t1/export", "/api/activity-log", "/api/conservation/echeances", "/api/tenants/t1/id-document-url", "/api/fiscal/fec", "/api/expenses/export"])(
    "ne peut pas lire la donnée sensible %s",
    (u) => expect(ok("READ_ONLY", "GET", u)).toBe(false)
  );

  it("garde ses actions personnelles (notifications, session, suggestion)", () => {
    expect(ok("READ_ONLY", "POST", "/api/notifications/seen")).toBe(true);
    expect(ok("READ_ONLY", "POST", "/api/notifications/read")).toBe(true);
    expect(ok("READ_ONLY", "POST", "/api/auth/logout-all")).toBe(true);
    expect(ok("READ_ONLY", "PATCH", "/api/auth/currency")).toBe(true);
    expect(ok("READ_ONLY", "POST", "/api/suggestions")).toBe(true);
  });
});

describe("AGENT : exploitation courante, sans suppression ni encaissement", () => {
  it.each([
    ["POST", "/api/properties"],
    ["PUT", "/api/properties/p1"],
    ["POST", "/api/tenants"],
    ["PUT", "/api/tenants/t1"],
    ["POST", "/api/tenants/t1/portal-account"],
    ["POST", "/api/owners"],
    ["POST", "/api/owners/o1/invite"],
    ["POST", "/api/contracts"],
    ["POST", "/api/contracts/c1/renew"],
    ["POST", "/api/contracts/c1/scan"],
    ["PUT", "/api/contracts/c1/deposit-refund"],
    ["PUT", "/api/contracts/c1"],
    ["POST", "/api/inspections"],
    ["POST", "/api/listings"],
    ["PATCH", "/api/listings/leads/l1"],
    ["PUT", "/api/issues/i1/status"],
    ["POST", "/api/vendors"],
    ["POST", "/api/messages/c1"],
    ["POST", "/api/invoices/i1/send-reminder"],
    ["POST", "/api/invoices/send-monthly-reminders"],
    ["POST", "/api/import"],
    ["POST", "/api/import/preview"],
  ])("peut %s %s", (m, u) => expect(ok("AGENT", m, u)).toBe(true));

  it.each([
    ["DELETE", "/api/properties/p1"],
    ["DELETE", "/api/tenants/t1"],
    ["DELETE", "/api/contracts/c1"],
    ["DELETE", "/api/owners/o1"],
    ["DELETE", "/api/listings/l1"],
    ["DELETE", "/api/listings/leads/l1"],
    ["POST", "/api/tenants/t1/anonymiser"],
    ["POST", "/api/owners/o1/anonymiser"],
    ["PUT", "/api/agency"],
    ["POST", "/api/invoices/i1/mark-paid"],
    ["POST", "/api/invoices/i1/cancel"],
    ["POST", "/api/expenses"],
    ["POST", "/api/team"],
    ["DELETE", "/api/team/u1"],
    ["PATCH", "/api/team/u1/role"],
    ["POST", "/api/subscription/subscribe"],
  ])("ne peut pas %s %s", (m, u) => expect(ok("AGENT", m, u)).toBe(false));

  it("lit les pièces d'identité mais pas l'export complet d'un locataire ni le journal", () => {
    expect(ok("AGENT", "GET", "/api/tenants/t1/id-document-url")).toBe(true);
    expect(ok("AGENT", "GET", "/api/tenants/t1/export")).toBe(false);
    expect(ok("AGENT", "GET", "/api/activity-log")).toBe(false);
    expect(ok("AGENT", "GET", "/api/fiscal/grand-livre")).toBe(false);
  });
});

describe("ACCOUNTANT : finances seulement", () => {
  it.each([
    ["POST", "/api/invoices/i1/mark-paid"],
    ["POST", "/api/invoices/i1/cancel"],
    ["POST", "/api/invoices/i1/send-reminder"],
    ["POST", "/api/expenses"],
    ["DELETE", "/api/expenses/e1"],
  ])("peut %s %s", (m, u) => expect(ok("ACCOUNTANT", m, u)).toBe(true));

  it.each([
    ["POST", "/api/properties"],
    ["POST", "/api/tenants"],
    ["POST", "/api/contracts"],
    ["DELETE", "/api/properties/p1"],
    ["PUT", "/api/agency"],
    ["POST", "/api/messages/c1"],
    ["POST", "/api/import"],
    ["POST", "/api/team"],
  ])("ne peut pas %s %s", (m, u) => expect(ok("ACCOUNTANT", m, u)).toBe(false));

  it("lit les exports comptables mais ni l'export locataire ni les pièces d'identité", () => {
    expect(ok("ACCOUNTANT", "GET", "/api/fiscal/fec")).toBe(true);
    expect(ok("ACCOUNTANT", "GET", "/api/fiscal/syscohada")).toBe(true);
    expect(ok("ACCOUNTANT", "GET", "/api/expenses/export")).toBe(true);
    expect(ok("ACCOUNTANT", "GET", "/api/tenants/t1/export")).toBe(false);
    expect(ok("ACCOUNTANT", "GET", "/api/tenants/t1/id-document-url")).toBe(false);
  });
});

describe("refus : message et défaut fermé", () => {
  it("nomme le rôle et la marche à suivre", () => {
    const v = verifierAutorisationEquipe("READ_ONLY", "DELETE", "/api/properties/p1");
    expect(v.autorise).toBe(false);
    if (!v.autorise) {
      expect(v.message).toContain("Lecture seule");
      expect(v.message).toContain("propriétaire");
    }
  });

  it("une route d'écriture inconnue (ajoutée plus tard) est refusée par défaut à un rôle restreint", () => {
    for (const r of ["AGENT", "ACCOUNTANT", "READ_ONLY"] as const) {
      expect(ok(r, "POST", "/api/une-nouvelle-fonction")).toBe(false);
      expect(ok(r, "DELETE", "/api/une-nouvelle-fonction/x")).toBe(false);
    }
  });

  it("ne se laisse pas tromper par un paramètre de requête ou une barre finale", () => {
    expect(ok("READ_ONLY", "POST", "/api/properties/?notifications/seen")).toBe(false);
    expect(ok("AGENT", "DELETE", "/api/properties/p1/?x=1")).toBe(false);
    expect(ok("AGENT", "GET", "/api/tenants/t1/export/?x=1")).toBe(false);
  });
});
