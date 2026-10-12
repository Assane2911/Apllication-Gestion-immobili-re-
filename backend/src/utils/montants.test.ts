import { describe, expect, it } from "vitest";
import { arrondir, montantRegle, resteDu } from "./montants";

const facture = (o: Partial<{ amount: number; amountPaid: number; status: string }> = {}) => ({
  amount: 500,
  amountPaid: 0,
  status: "PENDING",
  ...o,
});

describe("arrondir", () => {
  it("neutralise les erreurs de virgule flottante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(arrondir(0.1 + 0.2)).toBe(0.3);
    expect(arrondir(499.99999999999994)).toBe(500);
  });
});

describe("reste dû et montant réglé", () => {
  it("une facture sans paiement doit tout", () => {
    expect(resteDu(facture())).toBe(500);
    expect(montantRegle(facture())).toBe(0);
  });

  it("un paiement partiel réduit le reste dû", () => {
    expect(resteDu(facture({ amountPaid: 300 }))).toBe(200);
    expect(montantRegle(facture({ amountPaid: 300, status: "LATE" }))).toBe(300);
  });

  it("une facture PAYÉE est réglée en totalité même si amountPaid vaut 0 (réglée avant les paiements partiels, ou en ligne)", () => {
    expect(montantRegle(facture({ status: "PAID", amountPaid: 0 }))).toBe(500);
    expect(resteDu(facture({ status: "PAID", amountPaid: 0 }))).toBe(0);
  });

  it("une facture annulée ne doit plus rien", () => {
    expect(resteDu(facture({ status: "CANCELLED" }))).toBe(0);
  });

  it("un reste inférieur à un demi-centime est nul, jamais négatif", () => {
    expect(resteDu(facture({ amountPaid: 499.999 }))).toBe(0);
    expect(resteDu(facture({ amountPaid: 700 }))).toBe(0);
  });
});
