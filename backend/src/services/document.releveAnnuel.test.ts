import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formaterMontant } from "../utils/montant";
import { generateReleveAnnuelHtml, type ReleveAnnuelExportData } from "./document.releveAnnuel";

/**
 * Le relevé annuel remis à un propriétaire (somme de ses douze comptes-rendus mensuels) : dans SA langue, sans jamais mélanger
 * deux devises, sans prétendre être une déclaration fiscale, et sans laisser passer du HTML venu d'un nom saisi par un
 * gestionnaire. Ces tests appellent le générateur directement ; ceux du contrôleur vérifient les totaux.
 */

const MOIS_VIDES = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  totalLoyersByCurrency: {},
  totalChargesByCurrency: {},
  totalCommissionByCurrency: {},
  totalNetByCurrency: {},
  totalReverseByCurrency: {},
}));

function donnees(extra: Partial<ReleveAnnuelExportData> = {}): ReleveAnnuelExportData {
  return {
    agencyName: "Agence du Port",
    ownerName: "Fatou Diop",
    ownerCompanyName: null,
    managementFeeRate: 8,
    year: 2026,
    months: MOIS_VIDES.map((m) => (m.month === 1 ? { ...m, totalLoyersByCurrency: { EUR: 1000 }, totalNetByCurrency: { EUR: 920 } } : m)),
    properties: [{ propertyTitle: "Villa Ngor", currency: "EUR", loyersEncaisses: 1000, chargesDeduites: 0, commission: 80, netAReverser: 920 }],
    totalLoyersByCurrency: { EUR: 1000 },
    totalChargesByCurrency: { EUR: 0 },
    totalCommissionByCurrency: { EUR: 80 },
    totalNetByCurrency: { EUR: 920 },
    reversements: [],
    totalReverseByCurrency: { EUR: 0 },
    resteAReverserByCurrency: { EUR: 0 },
    ...extra,
  };
}

const nombreDeTableauxMois = (html: string) => (html.match(/class="section-title"/g) ?? []).length;

describe("generateReleveAnnuelHtml", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("langue du propriétaire", () => {
    it("espagnol : titre, année, mois, pied de page et déclaration « pas une déclaration fiscale »", () => {
      const html = generateReleveAnnuelHtml(donnees({ langue: "es" }));

      expect(html).toContain('<html lang="es">');
      expect(html).toContain("EXTRACTO ANUAL DE ALQUILERES");
      expect(html).toContain("Año: 2026");
      expect(html).toContain("<title>Extracto anual de alquileres - 2026 - Fatou Diop</title>");
      expect(html).toContain("Enero");
      expect(html).toContain("Mes a mes (€)");
      expect(html).toContain("Total del año por inmueble");
      expect(html).toContain("Documento generado el");
      expect(html).toContain("No constituye una declaración fiscal");
      expect(html).not.toContain("ANNUAL RENT STATEMENT");
    });

    it("portugais du Portugal : titre, année, mois, pied de page et déclaration « pas une déclaration fiscale »", () => {
      const html = generateReleveAnnuelHtml(donnees({ langue: "pt" }));

      expect(html).toContain('<html lang="pt">');
      expect(html).toContain("EXTRATO ANUAL DE RENDAS");
      expect(html).toContain("Ano: 2026");
      expect(html).toContain("<title>Extrato anual de rendas - 2026 - Fatou Diop</title>");
      expect(html).toContain("Janeiro");
      expect(html).toContain("Mês a mês (€)");
      expect(html).toContain("Total do ano por imóvel");
      expect(html).toContain("Documento gerado em");
      expect(html).toContain("Não constitui uma declaração fiscal");
    });

    it("français par défaut, et chaque langue dit que le relevé n'est pas une déclaration fiscale", () => {
      const defaut = generateReleveAnnuelHtml(donnees());
      expect(defaut).toContain('<html lang="fr">');
      expect(defaut).toContain("RELEVÉ ANNUEL DES LOYERS");
      for (const langue of ["fr", "en", "es", "pt"] as const) {
        const html = generateReleveAnnuelHtml(donnees({ langue }));
        expect(html, langue).toMatch(/d[ée]claration fiscale|tax return|declaraci[oó]n fiscal|declara[cç][aã]o fiscal/i);
      }
    });
  });

  describe("devises : jamais de somme croisée", () => {
    const deuxDevises = () =>
      donnees({
        months: MOIS_VIDES.map((m) => (m.month === 1 ? { ...m, totalLoyersByCurrency: { EUR: 1000, XOF: 500000 }, totalNetByCurrency: { EUR: 920, XOF: 460000 } } : m)),
        properties: [
          { propertyTitle: "Villa Ngor", currency: "EUR", loyersEncaisses: 1000, chargesDeduites: 0, commission: 80, netAReverser: 920 },
          { propertyTitle: "Studio Plateau", currency: "XOF", loyersEncaisses: 500000, chargesDeduites: 0, commission: 40000, netAReverser: 460000 },
        ],
        totalLoyersByCurrency: { EUR: 1000, XOF: 500000 },
        totalNetByCurrency: { EUR: 920, XOF: 460000 },
      });

    it("un tableau mensuel par devise, dans l'ordre alphabétique, chacun avec ses propres totaux", () => {
      const html = generateReleveAnnuelHtml(deuxDevises());

      expect(html).toContain("Mois par mois (€)");
      expect(html).toContain("Mois par mois (FCFA)");
      expect(html.indexOf("Mois par mois (€)")).toBeLessThan(html.indexOf("Mois par mois (FCFA)"));
      expect(html).toContain("Total €");
      expect(html).toContain("Total FCFA");
      const tableauEuro = html.slice(html.indexOf("Mois par mois (€)"), html.indexOf("Mois par mois (FCFA)"));
      expect(tableauEuro).toContain(formaterMontant(1000, "EUR", "fr"));
      expect(tableauEuro).not.toContain(formaterMontant(500000, "XOF", "fr"));
      const tableauFcfa = html.slice(html.indexOf("Mois par mois (FCFA)"), html.indexOf("Total de l'année par bien"));
      expect(tableauFcfa).toContain(formaterMontant(500000, "XOF", "fr"));
      expect(tableauFcfa).not.toContain(formaterMontant(1000, "EUR", "fr"));
    });

    it("l'ordre des tableaux ne dépend pas de l'ordre des données : toujours alphabétique", () => {
      const html = generateReleveAnnuelHtml(
        donnees({
          totalLoyersByCurrency: { XOF: 500000, EUR: 1000 },
          totalChargesByCurrency: { XOF: 0, EUR: 0 },
          totalCommissionByCurrency: { XOF: 40000, EUR: 80 },
          totalNetByCurrency: { XOF: 460000, EUR: 920 },
          totalReverseByCurrency: { XOF: 0, EUR: 0 },
          properties: [
            { propertyTitle: "Studio Plateau", currency: "XOF", loyersEncaisses: 500000, chargesDeduites: 0, commission: 40000, netAReverser: 460000 },
            { propertyTitle: "Villa Ngor", currency: "EUR", loyersEncaisses: 1000, chargesDeduites: 0, commission: 80, netAReverser: 920 },
          ],
        })
      );

      expect(html.indexOf("Mois par mois (€)")).toBeGreaterThan(-1);
      expect(html.indexOf("Mois par mois (€)")).toBeLessThan(html.indexOf("Mois par mois (FCFA)"));
    });

    it("une devise qui n'apparaît que sur un bien reçoit aussi son tableau", () => {
      const html = generateReleveAnnuelHtml(
        donnees({
          totalLoyersByCurrency: {},
          totalChargesByCurrency: {},
          totalCommissionByCurrency: {},
          totalNetByCurrency: {},
          totalReverseByCurrency: {},
          resteAReverserByCurrency: {},
          properties: [{ propertyTitle: "Studio Plateau", currency: "XOF", loyersEncaisses: 0, chargesDeduites: 0, commission: 0, netAReverser: 0 }],
        })
      );

      expect(html).toContain("Mois par mois (FCFA)");
      expect(html).not.toContain("Mois par mois (€)");
    });

    it("le montant de chaque bien est écrit dans la devise de ce bien", () => {
      const html = generateReleveAnnuelHtml(deuxDevises());

      // Le tableau « par bien » seul : les montants du tableau mensuel ne doivent pas masquer une erreur de devise ici.
      const parBien = html.slice(html.indexOf("Total de l'année par bien"), html.indexOf("Reversements"));
      const ligneVilla = parBien.slice(parBien.indexOf("Villa Ngor"), parBien.indexOf("Studio Plateau"));
      const ligneStudio = parBien.slice(parBien.indexOf("Studio Plateau"));
      expect(ligneVilla).toContain(formaterMontant(920, "EUR", "fr"));
      expect(ligneVilla).not.toContain("FCFA");
      expect(ligneStudio).toContain(formaterMontant(460000, "XOF", "fr"));
      expect(ligneStudio).not.toContain("€");
    });

    it("le tableau d'une devise ne contient jamais la somme de plusieurs devises", () => {
      const html = generateReleveAnnuelHtml(deuxDevises());

      const tableauEuro = html.slice(html.indexOf("Mois par mois (€)"), html.indexOf("Mois par mois (FCFA)"));
      const tableauFcfa = html.slice(html.indexOf("Mois par mois (FCFA)"), html.indexOf("Total de l'année par bien"));
      // 1 000 € + 500 000 FCFA = 501 000 : un nombre qui ne doit apparaître nulle part.
      expect(tableauEuro).not.toMatch(/501\D?000/);
      expect(tableauFcfa).not.toMatch(/501\D?000/);
      expect(tableauEuro).not.toMatch(/460\D?920|461\D?/);
    });
  });

  describe("reversements et solde", () => {
    it("sans reversement ni bien, le document le dit au lieu de laisser des tableaux vides", () => {
      const html = generateReleveAnnuelHtml(donnees({ properties: [], reversements: [] }));

      expect(html).toContain("Aucun reversement enregistré pour cette année");
      expect(html).toContain("Aucun bien rattaché à ce propriétaire");
      expect(html).not.toContain("Villa Ngor");
    });

    it("un reversement montre sa date, son moyen traduit, sa référence et son montant dans sa devise", () => {
      const html = generateReleveAnnuelHtml(
        donnees({ reversements: [{ currency: "EUR", amount: 920, paidAt: new Date(2026, 1, 5), method: "BANK_TRANSFER", reference: "VIR-2026-02" }] })
      );

      expect(html).toContain("Virement — VIR-2026-02");
      expect(html).toContain(formaterMontant(920, "EUR", "fr"));
      expect(html).toContain("2026");
      expect(html).not.toContain("Aucun reversement enregistré");
    });

    it("sans référence, aucun tiret orphelin ; un moyen inconnu est écrit tel quel plutôt que perdu", () => {
      const html = generateReleveAnnuelHtml(
        donnees({
          reversements: [
            { currency: "EUR", amount: 100, paidAt: new Date(2026, 2, 1), method: "CASH", reference: null },
            { currency: "EUR", amount: 50, paidAt: new Date(2026, 3, 1), method: "CRYPTO", reference: null },
          ],
        })
      );

      expect(html).toContain("<td>Espèces</td>");
      expect(html).not.toContain("Espèces —");
      expect(html).toContain("<td>CRYPTO</td>");
    });

    it("ce qui reste à reverser, ou le trop-versé, est montré par devise en valeur positive ; un solde nul n'a pas de ligne", () => {
      const html = generateReleveAnnuelHtml(donnees({ resteAReverserByCurrency: { EUR: 300, XOF: -12000, USD: 0 } }));

      expect(html).toContain("Reste à reverser (EUR)");
      expect(html).toContain(formaterMontant(300, "EUR", "fr"));
      expect(html).toContain("Versé en trop (XOF)");
      expect(html).toContain(formaterMontant(12000, "XOF", "fr"));
      expect(html).not.toContain(formaterMontant(-12000, "XOF", "fr"));
      expect(html).not.toContain("(USD)");
    });
  });

  describe("commission", () => {
    it("un seul taux : écrit une fois ; plusieurs taux dans l'année : écrits dans l'ordre, reliés par une flèche", () => {
      expect(generateReleveAnnuelHtml(donnees({ managementFeeRate: 8 }))).toContain("8 %");
      expect(generateReleveAnnuelHtml(donnees({ managementFeeRate: 8 }))).not.toContain("→");

      const html = generateReleveAnnuelHtml(donnees({ managementFeeRates: [8, 10] }));
      expect(html).toContain("8 % → 10 %");
    });

    it("le nom de la société du propriétaire s'ajoute entre parenthèses, et n'apparaît pas s'il n'y en a pas", () => {
      expect(generateReleveAnnuelHtml(donnees({ ownerCompanyName: "SCI Les Mouettes" }))).toContain("Fatou Diop (SCI Les Mouettes)");
      expect(generateReleveAnnuelHtml(donnees({ ownerCompanyName: null }))).not.toContain("Fatou Diop (");
    });
  });

  describe("échappement : un nom saisi par un utilisateur ne devient jamais du HTML", () => {
    const piege = '<img src=x onerror=alert(1)>';

    it("agence, propriétaire, société, bien, référence et moyen de paiement", () => {
      const html = generateReleveAnnuelHtml(
        donnees({
          agencyName: `Agence ${piege}`,
          ownerName: `Fatou ${piege}`,
          ownerCompanyName: `SCI ${piege}`,
          properties: [{ propertyTitle: `Villa ${piege}`, currency: "EUR", loyersEncaisses: 1, chargesDeduites: 0, commission: 0, netAReverser: 1 }],
          reversements: [{ currency: "EUR", amount: 1, paidAt: new Date(2026, 0, 2), method: `AUTRE ${piege}`, reference: `REF ${piege}` }],
        })
      );

      expect(html).not.toContain(piege);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(nombreDeTableauxMois(html)).toBeGreaterThan(0);
    });
  });
});
