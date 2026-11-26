import * as Sentry from "@sentry/node";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLogs } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { formaterMontant } from "../utils/montant";
import * as emailService from "./email.service";
import { signalerAbonnementNonRapproche, signalerPaiementNonRapproche } from "./paiementNonRapproche.service";

/**
 * Audit par sabotage de paiementNonRapproche.service.ts : ce que les tests de webhooks (qui ne font que constater « un message est
 * parti ») ne tenaient pas — contenu exact du journal et de l'e-mail, échappement du HTML, devise du paiement ou de la facture,
 * portée du « un seul message par paiement » (jamais d'une agence à l'autre), absence de facture, échecs absorbés.
 *
 * Aucun e-mail ni message Sentry réel : `sendEmail`, `captureMessage` et `flush` sont remplacés.
 */
let envoi: ReturnType<typeof vi.spyOn>;
let sentry: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  sentry = vi.spyOn(Sentry, "captureMessage").mockReturnValue("id");
  vi.spyOn(Sentry, "flush").mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

/** Une agence, un bien, un contrat et une facture de loyer de mars 2026 : 500 dus, 120 déjà réglés (reste 380). */
async function monde(titre = "Villa des Lilas", facture: Record<string, unknown> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: titre });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { periodMonth: 3, periodYear: 2026, amount: 500, amountPaid: 120, status: "PENDING", ...facture });
  return { manager, property, invoice };
}

const signaler = (facture: { id: string }, extra: Partial<Parameters<typeof signalerPaiementNonRapproche>[0]> = {}) =>
  signalerPaiementNonRapproche({
    prestataire: "STRIPE",
    referenceFacture: facture.id,
    referencePrestataire: "cs_live_abc123",
    montant: 500,
    devise: "EUR",
    raison: "la facture est déjà réglée",
    ...extra,
  });

const journal = (managerId: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, "paiement_en_ligne.non_rapproche")));
const courriel = () => {
  const [a, sujet, html] = envoi.mock.calls[0] as [string, string, string];
  return { a, sujet, html };
};

describe("message à Sentry", () => {
  it("niveau « warning », avec la source, le prestataire, le nom du prestataire et la raison", async () => {
    const { invoice } = await monde();

    await signaler(invoice, { raison: "la facture a été annulée" });

    expect(sentry).toHaveBeenCalledWith("Paiement Stripe encaissé mais non rapproché (la facture a été annulée)", {
      level: "warning",
      tags: { source: "paiement.non_rapproche", prestataire: "STRIPE" },
    });
  });

  it("PayDunya s'écrit « PayDunya » partout : Sentry, journal et e-mail", async () => {
    const { manager, invoice } = await monde();

    await signaler(invoice, { prestataire: "PAYDUNYA", referencePrestataire: "tok_pd_1" });

    expect(sentry).toHaveBeenCalledWith("Paiement PayDunya encaissé mais non rapproché (la facture est déjà réglée)", {
      level: "warning",
      tags: { source: "paiement.non_rapproche", prestataire: "PAYDUNYA" },
    });
    const [ligne] = await journal(manager.id);
    expect(ligne.details).toContain("Paiement PayDunya de");
    expect(ligne.details).toContain("Référence PayDunya : tok_pd_1.");
    expect(ligne.details).toContain("À rembourser depuis PayDunya");
    expect(courriel().html).toContain("par PayDunya pour le loyer");
  });

  it("le message part même si la facture est introuvable — et rien n'est écrit ni envoyé", async () => {
    const { manager } = await monde();

    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(signaler({ id: "00000000-0000-0000-0000-000000000000" })).resolves.toBeUndefined();

    expect(erreur).not.toHaveBeenCalled(); // une facture absente est un cas normal : sortie propre, pas une erreur absorbée
    expect(sentry).toHaveBeenCalledTimes(1);
    expect(await journal(manager.id)).toHaveLength(0);
    expect(envoi).not.toHaveBeenCalled();
  });
});

describe("journal d'activité", () => {
  it("une ligne, au nom du gestionnaire du bien, sur la facture, avec le texte complet", async () => {
    const { manager, invoice } = await monde("Villa des Lilas");

    await signaler(invoice, { montant: 380, raison: "la facture a été réglée à la main" });

    const lignes = await journal(manager.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      managerId: manager.id,
      action: "paiement_en_ligne.non_rapproche",
      entityType: "invoice",
      entityId: invoice.id,
      entityLabel: "Villa des Lilas — 03/2026",
    });
    expect(lignes[0].details).toBe(
      `Paiement Stripe de ${formaterMontant(380, "EUR")} encaissé mais non rapproché de la facture 03/2026 (la facture a été réglée à la main). ` +
        "Référence Stripe : cs_live_abc123. À rembourser depuis Stripe ou à enregistrer à la main."
    );
  });

  it("le mois s'écrit sur deux chiffres, avant l'année", async () => {
    const { manager, invoice } = await monde("Studio", { periodMonth: 1, periodYear: 2027 });

    await signaler(invoice);

    const [ligne] = await journal(manager.id);
    expect(ligne.entityLabel).toBe("Studio — 01/2027");
    expect(ligne.details).toContain("de la facture 01/2027 (");
  });
});

describe("devise", () => {
  it("le paiement est écrit dans SA devise, le reste dû dans celle de la facture", async () => {
    const { manager, invoice } = await monde(); // facture en EUR : reste 380 €

    await signaler(invoice, { montant: 250_000, devise: "XOF" });

    const [ligne] = await journal(manager.id);
    expect(ligne.details).toContain(`Paiement Stripe de ${formaterMontant(250_000, "XOF")} encaissé`);
    expect(courriel().html).toContain(`<strong>${formaterMontant(250_000, "XOF")}</strong>`);
    expect(courriel().html).toContain(`reste dû actuellement : ${formaterMontant(380, "EUR")}`);
  });

  it("sans devise du prestataire, c'est celle de la facture (ici FCFA) ; le reste dû aussi", async () => {
    const { manager, invoice } = await monde("Villa", { currency: "XOF" });

    await signaler(invoice, { montant: 500, devise: "" });

    const [ligne] = await journal(manager.id);
    expect(ligne.details).toContain(`Paiement Stripe de ${formaterMontant(500, "XOF")} encaissé`);
    expect(courriel().html).toContain(`reste dû actuellement : ${formaterMontant(380, "XOF")}`);
  });
});

describe("e-mail au gestionnaire", () => {
  it("destinataire, objet (bien et période) et corps (montant, prestataire, période, bien, raison, reste dû, référence)", async () => {
    const { manager, invoice } = await monde("Villa des Lilas");

    await signaler(invoice, { montant: 500, raison: "la facture est déjà réglée" });

    expect(envoi).toHaveBeenCalledTimes(1);
    const { a, sujet, html } = courriel();
    expect(a).toBe(manager.email);
    expect(sujet).toBe("Paiement en ligne à vérifier — Villa des Lilas, loyer 03/2026");
    expect(html).toContain(`<strong>${formaterMontant(500, "EUR")}</strong>`);
    expect(html).toContain("par Stripe pour le loyer");
    expect(html).toContain("<strong>03/2026</strong> de <strong>Villa des Lilas</strong>");
    expect(html).toContain("ce paiement : la facture est déjà réglée.");
    expect(html).toContain("Nous n'avons rien modifié sur la facture");
    expect(html).toContain(`reste dû actuellement : ${formaterMontant(380, "EUR")}`);
    expect(html).toContain("<code>cs_live_abc123</code>");
  });

  it("le reste dû d'une facture déjà soldée est zéro", async () => {
    const { invoice } = await monde("Villa", { status: "PAID", amountPaid: 500 });

    await signaler(invoice);

    expect(courriel().html).toContain(`reste dû actuellement : ${formaterMontant(0, "EUR")}`);
  });

  it("tout ce qui vient de l'extérieur est échappé : titre du bien, raison et référence ne peuvent pas injecter de HTML", async () => {
    const { invoice } = await monde("<b>Villa</b> & Co");

    await signaler(invoice, { raison: "<script>alert(1)</script>", referencePrestataire: "cs_<img src=x>" });

    const { html, sujet } = courriel();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Villa</b>");
    expect(html).toContain("&lt;b&gt;Villa&lt;/b&gt; &amp; Co");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<code>cs_&lt;img src=x&gt;</code>");
    expect(sujet).toBe("Paiement en ligne à vérifier — <b>Villa</b> & Co, loyer 03/2026"); // l'objet est du texte, pas du HTML
  });
});

describe("un seul message par paiement", () => {
  it("rejouer le même paiement ne prévient pas deux fois", async () => {
    const { manager, invoice } = await monde();

    await signaler(invoice);
    await signaler(invoice);

    expect(await journal(manager.id)).toHaveLength(1);
    expect(envoi).toHaveBeenCalledTimes(1);
  });

  it("un AUTRE paiement sur la même facture est signalé à part", async () => {
    const { manager, invoice } = await monde();

    await signaler(invoice, { referencePrestataire: "cs_live_premier" });
    await signaler(invoice, { referencePrestataire: "cs_live_second" });

    expect(await journal(manager.id)).toHaveLength(2);
    expect(envoi).toHaveBeenCalledTimes(2);
  });

  it("la même référence sur deux factures différentes est signalée pour chacune", async () => {
    const a = await monde("Bien A");
    const b = await monde("Bien B");

    await signaler(a.invoice);
    await signaler(b.invoice);

    expect(await journal(a.manager.id)).toHaveLength(1);
    expect(await journal(b.manager.id)).toHaveLength(1);
    expect(envoi).toHaveBeenCalledTimes(2);
  });

  it("une ligne de journal d'une autre agence, d'une autre action ou d'une autre facture ne compte jamais comme « déjà signalé »", async () => {
    const { manager, invoice } = await monde();
    const voisin = await monde("Bien voisin");
    const base = { entityType: "invoice", actorLabel: "Test", entityLabel: "Test", details: "… Référence Stripe : cs_live_abc123. …" };
    await testDb.insert(activityLogs).values([
      { ...base, managerId: voisin.manager.id, action: "paiement_en_ligne.non_rapproche", entityId: invoice.id }, // autre agence
      { ...base, managerId: manager.id, action: "paiement_en_ligne.rembourse", entityId: invoice.id }, // autre action
      { ...base, managerId: manager.id, action: "paiement_en_ligne.non_rapproche", entityId: voisin.invoice.id }, // autre facture
    ]);

    await signaler(invoice);

    expect(await journal(manager.id)).toHaveLength(2); // la ligne de l'autre facture (même agence) + la nouvelle
    expect(envoi).toHaveBeenCalledTimes(1);
  });
});

describe("jamais d'échec bruyant", () => {
  it("un e-mail qui échoue est absorbé et journalisé ; le signalement dans le journal est déjà fait", async () => {
    const { manager, invoice } = await monde();
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    envoi.mockRejectedValue(new Error("SMTP en panne"));

    await expect(signaler(invoice)).resolves.toBeUndefined();

    expect(await journal(manager.id)).toHaveLength(1);
    expect(erreur).toHaveBeenCalledWith("[paiement] Échec du signalement d'un paiement Stripe non rapproché (cs_live_abc123):", expect.any(Error));
  });
});

describe("signalerAbonnementNonRapproche", () => {
  it("niveau « error », avec source, prestataire, message, référence et montant retrouvables chez le prestataire", async () => {
    await signalerAbonnementNonRapproche({ prestataire: "PAYDUNYA", referencePrestataire: "tok_abo_9", montant: 19, raison: "montant différent de l'attendu" });

    expect(sentry).toHaveBeenCalledWith("Paiement d'abonnement PayDunya encaissé mais non appliqué (montant différent de l'attendu)", {
      level: "error",
      tags: { source: "abonnement.non_rapproche", prestataire: "PAYDUNYA" },
      extra: { referencePrestataire: "tok_abo_9", montant: 19 },
    });
  });
});
