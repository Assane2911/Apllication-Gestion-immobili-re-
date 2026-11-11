import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storedDocuments, users } from "../db/schema";
import { createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { budgetTemps } from "../utils/budgetTemps";
import * as emailService from "./email.service";
import { runStoredDocumentExpiryReminders } from "./reminder.service";

async function deposer(managerId: string, valeurs: Partial<typeof storedDocuments.$inferInsert>) {
  const [doc] = await testDb
    .insert(storedDocuments)
    .values({
      managerId,
      title: "Diagnostic électrique",
      category: "DIAGNOSTIC",
      filePath: "documents/x.pdf",
      fileName: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      ...valeurs,
    })
    .returning();
  return doc;
}

/** Rappels d'expiration des documents rangés : un e-mail groupé par gestionnaire, fenêtre de 30 jours par défaut. */
describe("runStoredDocumentExpiryReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0)); // 10 août 2026, 8h
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prévient pour un document qui expire dans la fenêtre (10 jours, puis 29 jours) et marque l'envoi", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const proche = await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 7, 20) });
    await deposer(manager.id, { propertyId: property.id, title: "Amiante", expiresAt: new Date(2026, 8, 8) });

    const result = await runStoredDocumentExpiryReminders();

    expect(result.sent).toBe(2);
    expect(result.echecs).toBe(0);
    const [enBase] = await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, proche.id));
    expect(enBase.reminderSentAt).not.toBeNull();
  });

  it("ne dit rien d'un document hors fenêtre, déjà expiré, sans date ou déjà signalé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 9, 9) }); // dans 60 jours
    await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 6, 1) }); // déjà expiré
    await deposer(manager.id, { propertyId: property.id, expiresAt: null });
    await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 7, 20), reminderSentAt: new Date(2026, 7, 1) });

    expect((await runStoredDocumentExpiryReminders()).sent).toBe(0);
  });

  it("n'envoie qu'une fois le rappel d'un même document", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 7, 20) });

    expect((await runStoredDocumentExpiryReminders()).sent).toBe(1);
    expect((await runStoredDocumentExpiryReminders()).sent).toBe(0);
  });

  it("regroupe tous les documents d'un gestionnaire dans UN e-mail, adressé à son compte", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    const manager = await createManager({ email: "agence-nord@test.local" });
    const property = await createProperty(manager.id, { title: "Studio Gambetta" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Ndiaye" });
    await deposer(manager.id, { propertyId: property.id, title: "Diagnostic gaz", expiresAt: new Date(2026, 7, 25) });
    await deposer(manager.id, { tenantId: tenant.id, title: "Attestation d'assurance", expiresAt: new Date(2026, 7, 15) });

    const result = await runStoredDocumentExpiryReminders();

    expect(result.sent).toBe(2);
    expect(envois).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, html] = envois.mock.calls[0];
    expect(destinataire).toBe("agence-nord@test.local");
    expect(sujet).toBe("Rappel : 2 documents arrivent à échéance");
    expect(html).toContain("Diagnostic gaz");
    expect(html).toContain("Studio Gambetta");
    expect(html).toContain("Attestation d&#39;assurance");
    expect(html).toContain("Awa");
    // Le plus proche de l'échéance en premier.
    expect(html.indexOf("Attestation")).toBeLessThan(html.indexOf("Diagnostic gaz"));
  });

  it("écrit un e-mail distinct à chaque gestionnaire et n'expose rien d'un autre", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    const a = await createManager({ email: "a@test.local" });
    const b = await createManager({ email: "b@test.local" });
    const bienA = await createProperty(a.id, { title: "Bien de A" });
    const bienB = await createProperty(b.id, { title: "Bien de B" });
    await deposer(a.id, { propertyId: bienA.id, title: "Doc A", expiresAt: new Date(2026, 7, 20) });
    await deposer(b.id, { propertyId: bienB.id, title: "Doc B", expiresAt: new Date(2026, 7, 20) });

    await runStoredDocumentExpiryReminders();

    const parDestinataire = new Map(envois.mock.calls.map((c) => [c[0], c[2]]));
    expect(parDestinataire.size).toBe(2);
    expect(parDestinataire.get("a@test.local")).toContain("Doc A");
    expect(parDestinataire.get("a@test.local")).not.toContain("Doc B");
    expect(parDestinataire.get("b@test.local")).toContain("Doc B");
    expect(parDestinataire.get("b@test.local")).not.toContain("Doc A");
  });

  it("échappe le titre du document dans l'e-mail", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await deposer(manager.id, { propertyId: property.id, title: "<script>alert(1)</script>", expiresAt: new Date(2026, 7, 20) });

    await runStoredDocumentExpiryReminders();

    expect(envois.mock.calls[0][2]).not.toContain("<script>");
  });

  it("libère les marqueurs quand l'envoi échoue, pour que le rappel reparte au prochain passage", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const doc = await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 7, 20) });

    const result = await runStoredDocumentExpiryReminders();

    expect(result.sent).toBe(0);
    expect(result.echecs).toBe(1);
    const [enBase] = await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, doc.id));
    expect(enBase.reminderSentAt).toBeNull();
  });

  it("ne réclame rien pour une agence suspendue, puis envoie à la réactivation", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const doc = await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 7, 20) });
    await testDb.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, manager.id));

    expect((await runStoredDocumentExpiryReminders()).sent).toBe(0);
    const [intact] = await testDb.select().from(storedDocuments).where(eq(storedDocuments.id, doc.id));
    expect(intact.reminderSentAt).toBeNull();

    await testDb.update(users).set({ suspendedAt: null }).where(eq(users.id, manager.id));
    expect((await runStoredDocumentExpiryReminders()).sent).toBe(1);
  });

  it("s'interrompt faute de temps en laissant les documents non réclamés pour l'exécution suivante", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await deposer(manager.id, { propertyId: property.id, expiresAt: new Date(2026, 7, 20) });

    const interrompue = await runStoredDocumentExpiryReminders(budgetTemps(0));
    expect(interrompue.sent).toBe(0);
    expect(interrompue.interrompu).toBe(true);

    const reprise = await runStoredDocumentExpiryReminders();
    expect(reprise.sent).toBe(1);
    expect(reprise.interrompu).toBe(false);
  });
});
