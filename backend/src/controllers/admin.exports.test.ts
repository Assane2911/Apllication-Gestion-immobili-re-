import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs, agencySettings } from "../db/schema";
import { authHeader, createAdmin, createManager, createProperty, createTeamMember, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { MAX_LIGNES_EXPORT } from "./adminExport.controller";

const BOM = "﻿";
const jours = (n: number) => new Date(Date.now() + n * 86_400_000);

async function adminToken() {
  return tokenFor(await createAdmin());
}

// Le client de test lit un corps texte : on le récupère tel quel (BOM compris).
const telecharger = (chemin: string, token: string) =>
  request(app)
    .get(chemin)
    .set(authHeader(token))
    .buffer(true)
    .parse((res, cb) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (data += c));
      res.on("end", () => cb(null, data));
    });

const lignesDe = (res: { body: unknown }) => String(res.body).replace(BOM, "").split("\n");

describe("accès aux exports", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    for (const chemin of ["/api/admin/exports/managers.csv", "/api/admin/exports/audit-logs.csv"]) {
      expect((await request(app).get(chemin)).status).toBe(401);
      expect((await request(app).get(chemin).set(authHeader(tokenFor(manager)))).status).toBe(403);
    }
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });
});

describe("GET /api/admin/exports/managers.csv", () => {
  it("renvoie un CSV Excel-compatible, non mis en cache, avec les colonnes en français", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: jours(20) });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port" });
    const bien = await createProperty(manager.id);
    await createProperty(manager.id);
    await createTenant(manager.id);

    const res = await telecharger("/api/admin/exports/managers.csv", token);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="gestionnaires-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(String(res.body).startsWith(BOM)).toBe(true);

    const [entete, ligne] = lignesDe(res);
    expect(entete).toBe("Email;Agence;Formule;Statut;Suspendu;Fin d'essai;Fin d'abonnement;Biens;Locataires;Inscrit le");
    const cellules = ligne.split(";");
    expect(cellules[0]).toBe(`"${manager.email}"`);
    expect(cellules[1]).toBe('"Agence du Port"');
    expect(cellules.slice(2, 5)).toEqual(["Professionnel", "Actif", "Non"]);
    expect(cellules[6]).toBe(jours(20).toISOString().slice(0, 10));
    expect(cellules.slice(7, 9)).toEqual(["2", "1"]);
    expect(bien.id).toBeTruthy();
  });

  it("n'exporte que les gestionnaires propriétaires, jamais un collaborateur ni un administrateur", async () => {
    const token = await adminToken();
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id);

    const res = await telecharger("/api/admin/exports/managers.csv", token);

    const corps = String(res.body);
    expect(corps).toContain(proprietaire.email);
    expect(corps).not.toContain(collaborateur.email);
    expect(lignesDe(res)).toHaveLength(2);
  });

  it("applique les mêmes filtres que la liste (formule, statut, recherche)", async () => {
    const token = await adminToken();
    const pro = await createManager({ subscriptionPlan: "PRO", subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(10) });
    const starter = await createManager({ subscriptionPlan: "STARTER", subscriptionStatus: "ACTIVE", subscriptionEndsAt: jours(10) });
    const suspendu = await createManager({ suspendedAt: new Date(), suspensionReason: "Impayé" });

    const emails = async (query: string) => {
      const corps = String((await telecharger(`/api/admin/exports/managers.csv${query}`, token)).body);
      return [pro, starter, suspendu].filter((m) => corps.includes(m.email)).map((m) => m.email);
    };

    expect(await emails("?plan=PRO")).toEqual([pro.email]);
    expect(await emails("?status=SUSPENDED")).toEqual([suspendu.email]);
    expect(await emails(`?search=${encodeURIComponent(starter.email)}`)).toEqual([starter.email]);
  });

  it("neutralise les formules et double les guillemets dans les champs saisis à la main", async () => {
    const token = await adminToken();
    const manager = await createManager();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: '=HYPERLINK("http://evil.test","clic")' });

    const res = await telecharger("/api/admin/exports/managers.csv", token);

    const ligne = lignesDe(res)[1];
    // Apostrophe de tête : le tableur lit du texte, pas une formule. Guillemets doublés : la colonne ne se décale pas.
    expect(ligne).toContain(`"'=HYPERLINK(""http://evil.test"",""clic"")"`);
    expect(ligne.split(";")).toHaveLength(10);
  });

  it("n'expose aucune donnée sensible", async () => {
    const token = await adminToken();
    await createManager({ stripeCustomerId: "cus_secret123", stripeSubscriptionId: "sub_secret456", totpSecret: "TOTPSECRET789" });

    const corps = String((await telecharger("/api/admin/exports/managers.csv", token)).body);

    for (const secret of ["cus_secret123", "sub_secret456", "TOTPSECRET789", "$2"]) {
      expect(corps).not.toContain(secret);
    }
  });

  it("trace l'export dans le journal d'audit, sans que le fichier contienne sa propre trace", async () => {
    const admin = await createAdmin();
    await createManager();
    await createManager();

    const res = await telecharger("/api/admin/exports/managers.csv?plan=STARTER&search=agence", tokenFor(admin));

    const trace = await testDb.select().from(adminAuditLogs);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ action: "export.managers", adminId: admin.id });
    expect(trace[0].details).toContain("formule STARTER");
    // Le texte de la recherche peut être un email : on note qu'il y en avait une, pas sa valeur.
    expect(trace[0].details).toContain("recherche");
    expect(trace[0].details).not.toContain("agence");
    expect(String(res.body)).not.toContain("export.managers");
    expect(String(res.body)).not.toContain("Export des gestionnaires");
  });

  it("rejette un filtre invalide (400), sans trace", async () => {
    const res = await telecharger("/api/admin/exports/managers.csv?plan=AUTRE", await adminToken());
    expect(res.status).toBe(400);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });
});

describe("GET /api/admin/exports/audit-logs.csv", () => {
  async function ecrire(valeurs: Array<Partial<typeof adminAuditLogs.$inferInsert>>) {
    await testDb.insert(adminAuditLogs).values(
      valeurs.map((v, i) => ({
        adminEmail: "admin@test.local",
        action: "manager.suspend",
        createdAt: new Date(Date.UTC(2026, 9, 1, 10, 0, i)),
        ...v,
      }))
    );
  }

  it("exporte le journal du plus récent au plus ancien, avec des libellés français et des dates UTC", async () => {
    const token = await adminToken();
    await ecrire([
      { action: "manager.suspend", targetLabel: "a@test.local", details: "Compte suspendu. Motif : Impayé", createdAt: new Date("2026-10-01T10:00:00Z") },
      { action: "listing.hide", targetLabel: "b@test.local", details: "Annonce masquée", createdAt: new Date("2026-10-02T11:30:45Z") },
    ]);

    const res = await telecharger("/api/admin/exports/audit-logs.csv", token);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/filename="journal-audit-\d{4}-\d{2}-\d{2}\.csv"/);
    const [entete, premiere, seconde] = lignesDe(res);
    expect(entete).toBe("Date (UTC);Administrateur;Action;Gestionnaire visé;Détail");
    expect(premiere).toBe('2026-10-02 11:30:45;"admin@test.local";"Annonce masquée";"b@test.local";"Annonce masquée"');
    expect(seconde).toContain('"Compte suspendu"');
    expect(seconde).toContain("Motif : Impayé");
  });

  it("applique le filtre par action et garde une action inconnue lisible", async () => {
    const token = await adminToken();
    await ecrire([{ action: "listing.hide" }, { action: "manager.suspend" }, { action: "action.future" }]);

    const filtre = await telecharger("/api/admin/exports/audit-logs.csv?action=listing.hide", token);
    expect(lignesDe(filtre)).toHaveLength(2);
    expect(String(filtre.body)).toContain("Annonce masquée");

    const tout = String((await telecharger("/api/admin/exports/audit-logs.csv", token)).body);
    expect(tout).toContain('"action.future"');
  });

  it("neutralise les formules et garde un détail multiligne dans sa cellule", async () => {
    const token = await adminToken();
    await ecrire([{ details: '=1+1";\nSecond paragraphe', targetLabel: "@cmd|' /C calc'!A0" }]);

    const corps = String((await telecharger("/api/admin/exports/audit-logs.csv", token)).body);

    expect(corps).toContain(`"'=1+1"";\nSecond paragraphe"`);
    expect(corps).toContain(`"'@cmd|' /C calc'!A0"`);
  });

  it("plafonne l'export aux entrées les plus récentes", async () => {
    const token = await adminToken();
    const total = MAX_LIGNES_EXPORT + 3;
    await testDb.insert(adminAuditLogs).values(
      Array.from({ length: total }, (_, i) => ({
        adminEmail: "admin@test.local",
        action: "manager.suspend",
        details: `entrée ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      }))
    );

    const res = await telecharger("/api/admin/exports/audit-logs.csv", token);

    const lignes = lignesDe(res);
    expect(lignes).toHaveLength(MAX_LIGNES_EXPORT + 1);
    expect(lignes[1]).toContain(`entrée ${total - 1}`);
    expect(String(res.body)).not.toContain(`entrée 0"`);
  });

  it("trace l'export, après coup, et rejette un filtre invalide sans trace", async () => {
    const admin = await createAdmin();
    await ecrire([{}]);

    const res = await telecharger("/api/admin/exports/audit-logs.csv", tokenFor(admin));
    expect(lignesDe(res)).toHaveLength(2);
    const trace = await testDb.select().from(adminAuditLogs);
    expect(trace.filter((t: { action: string }) => t.action === "export.audit")).toHaveLength(1);
    expect(String(res.body)).not.toContain("Export du journal");

    const invalide = await telecharger("/api/admin/exports/audit-logs.csv?action=inconnue", tokenFor(admin));
    expect(invalide.status).toBe(400);
    expect((await testDb.select().from(adminAuditLogs)).filter((t: { action: string }) => t.action === "export.audit")).toHaveLength(1);
  });
});
