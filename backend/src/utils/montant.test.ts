import { describe, expect, it } from "vitest";
import { rentDueReminderEmail } from "../services/email.service";
import { generateReceiptHtml } from "../services/pdf.service";
import { rentDueReminderWhatsappVariables } from "../services/whatsapp.service";
import { formaterMontant } from "./montant";

/**
 * Un même montant, une seule écriture.
 *
 * Le portail affichait « 35 000 FCFA » quand l'email et le message WhatsApp
 * écrivaient « 35000 XOF » : le frontend savait mettre en forme un montant, le
 * serveur non. Tant que les rappels ne partaient pas vraiment, personne ne
 * voyait les deux versions côte à côte. Ce sont pourtant les deux seuls
 * messages qu'un locataire reçoit.
 *
 * La référence est le formatage du portail (`frontend/src/context/
 * CurrencyContext.tsx`) : locale fr-FR, deux décimales au plus, zéro au
 * minimum, symbole avant ou après selon la devise.
 */
describe("Mise en forme d'un montant", () => {
  const espaceFine = " "; // fr-FR sépare les milliers par U+202F, pas par une espace ordinaire.

  it("écrit le franc CFA avec son symbole local et un séparateur de milliers", () => {
    expect(formaterMontant(35000, "XOF")).toBe(`35${espaceFine}000 FCFA`);
  });

  it("place le symbole avant le nombre là où l'usage le veut", () => {
    expect(formaterMontant(1200, "USD")).toBe(`$1${espaceFine}200`);
  });

  it("n'ajoute pas de décimales à un montant rond, et en garde deux au plus", () => {
    // Un loyer s'écrit « 450 € », pas « 450,00 € » ; une régularisation au
    // centime garde ses centimes.
    expect(formaterMontant(450, "EUR")).toBe("450 €");
    expect(formaterMontant(450.5, "EUR")).toBe("450,5 €");
    expect(formaterMontant(450.567, "EUR")).toBe("450,57 €");
  });

  it("affiche le code brut d'une devise inconnue plutôt qu'un symbole inventé", () => {
    // Même principe que côté portail : un montant faux d'apparence normale se
    // découvre au litige, un montant visiblement inhabituel se corrige tout de
    // suite.
    expect(formaterMontant(35000, "XYZ")).toBe(`35${espaceFine}000 XYZ`);
  });

  it("traite une devise absente comme un euro, valeur par défaut en base", () => {
    expect(formaterMontant(100, undefined)).toBe("100 €");
    expect(formaterMontant(100, null)).toBe("100 €");
  });

  it("écrit la même somme sur la quittance que dans l'email et le message", () => {
    // La quittance est le document que le locataire garde. Elle affichait
    // « 35000 XOF » quand son portail affichait « 35 000 FCFA » : comparer les
    // deux faisait douter du montant, pas de la mise en page.
    const html = generateReceiptHtml({
      receiptNumber: "Q-2026-09-0001",
      agency: { name: "Agence du Port", address: null, phone: null, email: null, siretOrId: null, legalNotice: null },
      tenant: { fullName: "Monsieur ALIOU THIAM", email: "aliou@test.local", phone: "+221778422993" },
      property: { title: "APPT MEUBLÉ", address: "Almadies", surface: 80 },
      invoice: {
        periodMonth: 9,
        periodYear: 2026,
        amount: 35000,
        currency: "XOF",
        paidAt: new Date(2026, 8, 24),
        paymentMethod: "BANK_TRANSFER",
      },
    });

    expect(html).toContain(formaterMontant(35000, "XOF"));
  });

  it("écrit la même somme dans l'email et dans le message WhatsApp", () => {
    // Les deux seuls messages qu'un locataire reçoit. Ils partent du même
    // rappel, à la seconde près (voir sendSingleInvoiceReminder) : deux
    // écritures différentes du même montant se liraient côte à côte.
    const commun = {
      tenantName: "ALIOU THIAM",
      propertyTitle: "APPT MEUBLÉ",
      amount: 35000,
      currency: "XOF",
      periodMonth: 9,
      periodYear: 2026,
      frontendUrl: "https://app.test",
    };
    const attendu = formaterMontant(commun.amount, commun.currency);

    const { html } = rentDueReminderEmail({ ...commun, dueDate: new Date(2026, 8, 24) });
    const variables = rentDueReminderWhatsappVariables(commun);

    expect(attendu).toBe(`35${espaceFine}000 FCFA`);
    expect(html).toContain(attendu);
    expect(variables["4"]).toBe(attendu);
  });
});
