import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { adminAuditLogs } from "../db/schema";
import * as emailService from "../services/email.service";
import { invaliderCacheMaintenance, lireMaintenance } from "../services/maintenance.service";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const HEURE = 3_600_000;
const dans = (ms: number) => new Date(Date.now() + ms).toISOString();

let envoi: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  invaliderCacheMaintenance();
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  invaliderCacheMaintenance();
  vi.restoreAllMocks();
});

async function programmer(corps: Record<string, unknown>) {
  const admin = await createAdmin();
  return request(app).put("/api/admin/maintenance").set(authHeader(tokenFor(admin))).send(corps);
}

describe("Annonce de la maintenance aux gestionnaires par e-mail (PUT /api/admin/maintenance, notifier)", () => {
  it("sans « notifier », aucun e-mail ne part : l'envoi est un choix explicite de l'administrateur", async () => {
    await createManager();
    const res = await programmer({ debut: dans(2 * HEURE), fin: dans(3 * HEURE) });
    expect(res.status).toBe(200);
    expect(res.body.annonce).toBeNull();
    expect(envoi).not.toHaveBeenCalled();
  });

  it("prévient les gestionnaires actifs, chacun dans sa langue, et laisse de côté les autres comptes", async () => {
    const fr = await createManager({ email: "agence-fr@test.local" });
    const en = await createManager({ email: "agence-en@test.local", language: "en" });
    await createManager({ email: "suspendu@test.local", suspendedAt: new Date() });
    await createManager({ email: "non-verifie@test.local", emailVerifiedAt: null });
    await createManager({ email: "collaborateur@test.local", teamOwnerId: fr.id });

    const res = await programmer({ debut: dans(2 * HEURE), fin: dans(3 * HEURE), notifier: true });

    expect(res.status).toBe(200);
    expect(res.body.annonce).toEqual({ destinataires: 2, envoyes: 2, echecs: 0 });
    const envoyes = (envoi.mock.calls as Array<[string, string, string]>).map(([a, sujet]) => [a, sujet] as [string, string]);
    expect(envoyes.map(([a]) => a).sort()).toEqual(["agence-en@test.local", "agence-fr@test.local"]);
    expect(envoyes.find(([a]) => a === "agence-fr@test.local")![1]).toContain("Maintenance prévue");
    expect(envoyes.find(([a]) => a === "agence-en@test.local")![1]).toContain("Scheduled maintenance");
    expect(en.language).toBe("en");
  });

  it("le courriel porte les dates en UTC et le message de l'administrateur, échappé", async () => {
    await createManager({ email: "agence@test.local" });
    await programmer({ debut: dans(2 * HEURE), fin: dans(3 * HEURE), message: "Mise à niveau <script>alert(1)</script>\nRetour vers 20 h", notifier: true });

    const html = envoi.mock.calls[0][2] as string;
    expect(html).toContain("UTC");
    expect(html).toContain("Mise à niveau &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Retour vers 20 h");
  });

  it("un envoi qui échoue (réponse en erreur ou exception) n'empêche pas les autres et figure au bilan, comme dans le journal d'audit", async () => {
    await createManager({ email: "a@test.local" });
    await createManager({ email: "b@test.local" });
    await createManager({ email: "c@test.local" });
    envoi.mockImplementation((async (a: string) => {
      if (a === "a@test.local") return { simulated: false, error: true };
      if (a === "b@test.local") throw new Error("connexion coupée");
      return { simulated: false, messageId: "ok" };
    }) as never);

    const res = await programmer({ debut: dans(2 * HEURE), fin: dans(3 * HEURE), notifier: true });

    expect(res.status).toBe(200);
    expect(res.body.annonce).toEqual({ destinataires: 3, envoyes: 1, echecs: 2 });
    expect(envoi).toHaveBeenCalledTimes(3);
    expect((await lireMaintenance())?.debut).toBeInstanceOf(Date); // la fenêtre est bien enregistrée
    const [journal] = await testDb.select().from(adminAuditLogs);
    expect(journal.details).toContain("annonce par e-mail : 1 envoyé(s) sur 3, 2 échec(s)");
  });

  it("refuse d'annoncer une maintenance qui a déjà commencé : rien n'est enregistré ni envoyé", async () => {
    await createManager();
    const res = await programmer({ debut: dans(-HEURE), fin: dans(HEURE), notifier: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MAINTENANCE_NOTIFY_TOO_LATE");
    expect(envoi).not.toHaveBeenCalled();
    invaliderCacheMaintenance();
    expect(await lireMaintenance()).toBeNull();
  });

  it("une fenêtre invalide n'envoie rien, même avec « notifier »", async () => {
    await createManager();
    const res = await programmer({ debut: dans(3 * HEURE), fin: dans(2 * HEURE), notifier: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MAINTENANCE_WINDOW_INVALID");
    expect(envoi).not.toHaveBeenCalled();
  });

  it("un gestionnaire ne peut pas déclencher l'envoi : réservé à l'administrateur", async () => {
    const manager = await createManager();
    const res = await request(app)
      .put("/api/admin/maintenance")
      .set(authHeader(tokenFor(manager)))
      .send({ debut: dans(2 * HEURE), fin: dans(3 * HEURE), notifier: true });
    expect(res.status).toBe(403);
    expect(envoi).not.toHaveBeenCalled();
  });
});
