import { and, eq, gte, lte } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings, contracts, expenses, invoices, properties, tenants } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";
import { csvEscape, csvMontant, CSV_BOM, fecEscapeText, fecMontant, versLatin1Fec } from "../utils/csv";

/**
 * Module "Bilan Fiscal & Comptabilité" : synthèse annuelle (revenus/dépenses
 * par mois, ventilation par catégorie, bilan par bien) et export "Grand
 * Livre" (journal comptable chronologique de l'exercice), tous deux scopés
 * au gestionnaire connecté et à une année civile donnée.
 *
 * Choix délibéré de périmètre : contrairement au futur module "CRG"
 * (compte-rendu de gestion propriétaire, chantier séparé), rien ici ne
 * calcule de commission d'agence ni de reversement propriétaire — le bilan
 * par bien reste du point de vue du gestionnaire (revenus encaissés moins
 * charges), pas du propriétaire.
 *
 * Base de comptabilisation ("cash basis", cohérent avec exportFinancialReport
 * dans expense.controller.ts) : une facture compte l'année où elle a été
 * RÉELLEMENT ENCAISSÉE (paidAt), pas l'année de la période louée
 * (periodMonth/periodYear) ni de l'échéance (dueDate) — c'est la date qui
 * fait foi pour une déclaration de revenus fonciers en France (régime des
 * encaissements-décaissements). paidAt est normalement toujours renseigné
 * pour une facture PAID ; on retombe sur dueDate par précaution seulement.
 */
const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

function yearBounds(year: number) {
  return {
    start: new Date(year, 0, 1, 0, 0, 0, 0),
    end: new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

type PaidInvoiceRow = {
  invoice: typeof invoices.$inferSelect;
  contract: typeof contracts.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  property: typeof properties.$inferSelect;
};
type ExpenseRow = { expense: typeof expenses.$inferSelect; property: typeof properties.$inferSelect };

async function loadYearData(managerId: string, year: number) {
  const { start, end } = yearBounds(year);

  // On ne peut pas filtrer paidAt directement en SQL de façon fiable ici :
  // paidAt est nullable (une facture PAID sans paidAt renseigné retombe sur
  // dueDate, voir le commentaire de tête) — le filtre est donc appliqué en
  // mémoire après avoir choisi la bonne date par ligne, exactement comme
  // exportFinancialReport (expense.controller.ts) le fait déjà.
  const [paidInvoiceRows, expenseRows] = await Promise.all([
    db
      .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(invoices.status, "PAID"), eq(properties.managerId, managerId))),
    db
      .select({ expense: expenses, property: properties })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(and(eq(properties.managerId, managerId), gte(expenses.expenseDate, start), lte(expenses.expenseDate, end))),
  ]);

  const invoiceDate = (r: PaidInvoiceRow) => new Date(r.invoice.paidAt ?? r.invoice.dueDate);
  const filteredInvoices = (paidInvoiceRows as PaidInvoiceRow[]).filter((r) => {
    const d = invoiceDate(r);
    return d >= start && d <= end;
  });

  return { filteredInvoices, filteredExpenses: expenseRows as ExpenseRow[], invoiceDate };
}

/**
 * Années pour lesquelles le gestionnaire a au moins une facture payée ou une
 * dépense, pour peupler un sélecteur d'année côté frontend — sans jamais le
 * laisser vide même si le gestionnaire n'a encore aucune donnée sur l'année
 * en cours.
 */
async function availableYears(managerId: string): Promise<number[]> {
  const [paidInvoiceRows, expenseRows] = await Promise.all([
    db
      .select({ invoice: invoices })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(invoices.status, "PAID"), eq(properties.managerId, managerId))),
    db
      .select({ expense: expenses })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(eq(properties.managerId, managerId)),
  ]);

  const years = new Set<number>([new Date().getFullYear()]);
  for (const r of paidInvoiceRows as { invoice: typeof invoices.$inferSelect }[]) {
    years.add(new Date(r.invoice.paidAt ?? r.invoice.dueDate).getFullYear());
  }
  for (const r of expenseRows as { expense: typeof expenses.$inferSelect }[]) {
    years.add(new Date(r.expense.expenseDate).getFullYear());
  }
  return Array.from(years).sort((a, b) => b - a);
}

export const getAnnualSynthesis = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const { year: requestedYear } = yearQuerySchema.parse(req.query);
  const year = requestedYear ?? new Date().getFullYear();

  const { filteredInvoices, filteredExpenses, invoiceDate } = await loadYearData(managerId, year);

  // Plateforme multi-devises (EUR/XOF/...) : chaque total reste ventilé par
  // devise plutôt que sommé à travers des devises différentes, même
  // principe que dashboard.controller.ts / expense.controller.ts.
  const totalRevenueByCurrency: Record<string, number> = {};
  const revenueByMonth: Record<string, Record<string, number>> = {};
  for (const r of filteredInvoices) {
    const currency = r.invoice.currency || "EUR";
    totalRevenueByCurrency[currency] = (totalRevenueByCurrency[currency] ?? 0) + r.invoice.amount;
    const key = `${year}-${String(invoiceDate(r).getMonth() + 1).padStart(2, "0")}`;
    revenueByMonth[key] = revenueByMonth[key] ?? {};
    revenueByMonth[key][currency] = (revenueByMonth[key][currency] ?? 0) + r.invoice.amount;
  }

  const totalExpensesByCurrency: Record<string, number> = {};
  const expensesByMonth: Record<string, Record<string, number>> = {};
  const expensesByCategory: Record<string, Record<string, number>> = {};
  for (const r of filteredExpenses) {
    const currency = r.expense.currency || "EUR";
    totalExpensesByCurrency[currency] = (totalExpensesByCurrency[currency] ?? 0) + r.expense.amount;
    const key = `${year}-${String(new Date(r.expense.expenseDate).getMonth() + 1).padStart(2, "0")}`;
    expensesByMonth[key] = expensesByMonth[key] ?? {};
    expensesByMonth[key][currency] = (expensesByMonth[key][currency] ?? 0) + r.expense.amount;
    expensesByCategory[r.expense.category] = expensesByCategory[r.expense.category] ?? {};
    expensesByCategory[r.expense.category][currency] = (expensesByCategory[r.expense.category][currency] ?? 0) + r.expense.amount;
  }

  const netResultByCurrency: Record<string, number> = {};
  for (const currency of new Set([...Object.keys(totalRevenueByCurrency), ...Object.keys(totalExpensesByCurrency)])) {
    netResultByCurrency[currency] = (totalRevenueByCurrency[currency] ?? 0) - (totalExpensesByCurrency[currency] ?? 0);
  }

  // Bilan par bien, ventilé par devise (une clé propertyId+devise, et non
  // simplement propertyId comme le résumé par bien de exportFinancialReport)
  // : un bien a en pratique une seule devise, mais une dépense peut en
  // théorie être saisie dans une autre devise que celle du bien — mélanger
  // les deux sous une même ligne produirait un total sans signification.
  const byPropertyCurrency = new Map<
    string,
    { propertyId: string; propertyTitle: string; currency: string; revenue: number; expense: number }
  >();
  const keyFor = (propertyId: string, currency: string) => `${propertyId}::${currency}`;
  for (const r of filteredInvoices) {
    const currency = r.invoice.currency || "EUR";
    const key = keyFor(r.property.id, currency);
    const entry = byPropertyCurrency.get(key) ?? {
      propertyId: r.property.id,
      propertyTitle: r.property.title,
      currency,
      revenue: 0,
      expense: 0,
    };
    entry.revenue += r.invoice.amount;
    byPropertyCurrency.set(key, entry);
  }
  for (const r of filteredExpenses) {
    const currency = r.expense.currency || "EUR";
    const key = keyFor(r.property.id, currency);
    const entry = byPropertyCurrency.get(key) ?? {
      propertyId: r.property.id,
      propertyTitle: r.property.title,
      currency,
      revenue: 0,
      expense: 0,
    };
    entry.expense += r.expense.amount;
    byPropertyCurrency.set(key, entry);
  }
  const bilanParBien = Array.from(byPropertyCurrency.values())
    .map((entry) => ({ ...entry, net: entry.revenue - entry.expense }))
    .sort((a, b) => a.propertyTitle.localeCompare(b.propertyTitle) || a.currency.localeCompare(b.currency));

  res.json({
    year,
    availableYears: await availableYears(managerId),
    totalRevenueByCurrency,
    totalExpensesByCurrency,
    netResultByCurrency,
    revenueByMonth,
    expensesByMonth,
    expensesByCategory,
    bilanParBien,
  });
});

/**
 * Grand Livre : journal comptable chronologique de l'exercice (recettes et
 * dépenses mêlées, triées par date), avec un solde cumulé par devise —
 * contrairement à exportFinancialReport (revenus puis dépenses, groupés par
 * type), qui reste un rapport de synthèse et pas un journal chronologique.
 */
export const exportGrandLivre = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const { year: requestedYear } = yearQuerySchema.parse(req.query);
  const year = requestedYear ?? new Date().getFullYear();

  const { filteredInvoices, filteredExpenses, invoiceDate } = await loadYearData(managerId, year);

  type JournalEntry = {
    date: Date;
    type: "Recette" | "Dépense";
    propertyTitle: string;
    categorie: string;
    libelle: string;
    montant: number;
    currency: string;
  };

  const entries: JournalEntry[] = [
    ...filteredInvoices.map(
      (r): JournalEntry => ({
        date: invoiceDate(r),
        type: "Recette",
        propertyTitle: r.property.title,
        categorie: "Loyer",
        libelle: `Loyer ${r.invoice.periodMonth}/${r.invoice.periodYear} - ${r.tenant.firstName} ${r.tenant.lastName}`,
        montant: r.invoice.amount,
        currency: r.invoice.currency || "EUR",
      })
    ),
    ...filteredExpenses.map(
      (r): JournalEntry => ({
        date: new Date(r.expense.expenseDate),
        type: "Dépense",
        propertyTitle: r.property.title,
        categorie: r.expense.category,
        libelle: r.expense.title,
        montant: r.expense.amount,
        currency: r.expense.currency || "EUR",
      })
    ),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const lines: string[] = [];
  lines.push(`Grand Livre ${year}`);
  lines.push("");
  lines.push(["Date", "Bien", "Type", "Catégorie", "Libellé", "Recette", "Dépense", "Devise", "Solde cumulé"].join(";"));

  const runningBalanceByCurrency = new Map<string, number>();
  for (const entry of entries) {
    const previousBalance = runningBalanceByCurrency.get(entry.currency) ?? 0;
    const newBalance = entry.type === "Recette" ? previousBalance + entry.montant : previousBalance - entry.montant;
    runningBalanceByCurrency.set(entry.currency, newBalance);

    lines.push(
      [
        entry.date.toLocaleDateString("fr-FR"),
        csvEscape(entry.propertyTitle),
        entry.type,
        csvEscape(entry.categorie),
        csvEscape(entry.libelle),
        entry.type === "Recette" ? csvMontant(entry.montant) : "",
        entry.type === "Dépense" ? csvMontant(entry.montant) : "",
        entry.currency,
        csvMontant(newBalance),
      ].join(";")
    );
  }

  if (entries.length === 0) {
    lines.push(["Aucune écriture pour cet exercice"].join(";"));
  }

  const csvContent = CSV_BOM + lines.join("\n");
  const filename = `grand-livre-${year}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
});

const FEC_JOURNAL_CODE = "BQ";
const FEC_JOURNAL_LIB = "Journal de banque";
const FEC_HEADER = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
];

const COMPTE_BANQUE = { num: "512000", lib: "Banque" };
const COMPTE_LOYERS = { num: "706100", lib: "Loyers et produits de gestion locative" };
/**
 * Un compte par catégorie de dépense (expenses.category, schema.ts), plutôt
 * qu'un compte fourre-tout unique : c'est ce qui rend le fichier exploitable
 * par un comptable (chaque ligne du Grand Livre imputée sur un poste
 * cohérent), au prix d'un plan comptable volontairement simplifié — un
 * comptable reste seul juge du plan comptable définitif de l'agence.
 */
const COMPTES_DEPENSES: Record<string, { num: string; lib: string }> = {
  MAINTENANCE: { num: "615500", lib: "Entretien et réparations" },
  TAX: { num: "635100", lib: "Impôts, taxes et versements assimilés" },
  INSURANCE: { num: "616100", lib: "Primes d'assurances" },
  SYNDIC: { num: "622600", lib: "Honoraires (syndic)" },
  OTHER: { num: "628000", lib: "Charges diverses de gestion courante" },
};

function formatFecDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * SIREN (9 premiers chiffres du SIRET) à partir du champ libre
 * agencySettings.siretOrId — celui-ci accueille aussi bien un SIRET français
 * qu'un identifiant national étranger (l'agence n'est pas nécessairement
 * française), donc pas nécessairement 14 chiffres. Une valeur absente ou non
 * numérique retombe sur 9 zéros plutôt que de faire échouer l'export : le
 * fichier reste généré, à charge du gestionnaire de renseigner son SIRET
 * dans les paramètres d'agence avant de le transmettre.
 */
function sirenDepuisSiretOrId(siretOrId: string | null | undefined): string {
  const chiffres = (siretOrId ?? "").replace(/\D/g, "");
  return chiffres.length >= 9 ? chiffres.slice(0, 9) : "000000000";
}

/**
 * Export FEC (Fichier des Écritures Comptables, arrêté du 29 juillet 2013) :
 * réservé à l'Entreprise comme le Grand Livre CSV ci-dessus, dont il partage
 * les mêmes données sources (loyers encaissés, dépenses de l'exercice), mais
 * dans le format réglementaire attendu par l'administration fiscale en cas de
 * contrôle — colonnes fixes séparées par une tabulation, écritures en partie
 * double (une ligne Débit, une ligne Crédit par mouvement).
 *
 * Limites assumées, documentées ici plutôt que silencieuses : plan comptable
 * simplifié (voir COMPTES_DEPENSES) à valider par un comptable ; montants
 * exportés dans la devise d'origine de chaque facture/dépense sans
 * conversion (Montantdevise/Idevise laissés vides) — un export FEC suppose
 * une comptabilité tenue en euros, cohérent avec son usage (déclaration
 * fiscale française) ; ValidDate systématiquement égale à EcritureDate
 * (aucune écriture n'est laissée "non validée"). Comme le rappelle le §8 des
 * CGU, le Service reste un outil de gestion, pas un substitut à un conseil
 * comptable.
 */
export const exportFEC = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const { year: requestedYear } = yearQuerySchema.parse(req.query);
  const year = requestedYear ?? new Date().getFullYear();

  const [{ filteredInvoices, filteredExpenses, invoiceDate }, [settings]] = await Promise.all([
    loadYearData(managerId, year),
    db.select().from(agencySettings).where(eq(agencySettings.userId, managerId)),
  ]);

  type Ecriture = {
    date: Date;
    pieceRef: string;
    libelle: string;
    lignes: [
      { num: string; lib: string; debit: number; credit: number },
      { num: string; lib: string; debit: number; credit: number },
    ];
  };

  const ecritures: Ecriture[] = [
    ...filteredInvoices.map((r): Ecriture => {
      const montant = r.invoice.amount;
      return {
        date: invoiceDate(r),
        pieceRef: r.invoice.id,
        libelle: `Loyer ${r.invoice.periodMonth}/${r.invoice.periodYear} - ${r.tenant.firstName} ${r.tenant.lastName} (${r.property.title})`,
        lignes: [
          { ...COMPTE_BANQUE, debit: montant, credit: 0 },
          { ...COMPTE_LOYERS, debit: 0, credit: montant },
        ],
      };
    }),
    ...filteredExpenses.map((r): Ecriture => {
      const montant = r.expense.amount;
      const compte = COMPTES_DEPENSES[r.expense.category] ?? COMPTES_DEPENSES.OTHER;
      return {
        date: new Date(r.expense.expenseDate),
        pieceRef: r.expense.id,
        libelle: `${r.expense.title} (${r.property.title})`,
        lignes: [
          { ...compte, debit: montant, credit: 0 },
          { ...COMPTE_BANQUE, debit: 0, credit: montant },
        ],
      };
    }),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const rows: string[] = [FEC_HEADER.join("\t")];

  ecritures.forEach((ecriture, index) => {
    const ecritureNum = String(index + 1).padStart(6, "0");
    const dateFec = formatFecDate(ecriture.date);
    for (const ligne of ecriture.lignes) {
      rows.push(
        [
          FEC_JOURNAL_CODE,
          FEC_JOURNAL_LIB,
          ecritureNum,
          dateFec,
          ligne.num,
          fecEscapeText(ligne.lib),
          "",
          "",
          fecEscapeText(ecriture.pieceRef),
          dateFec,
          fecEscapeText(ecriture.libelle),
          fecMontant(ligne.debit),
          fecMontant(ligne.credit),
          "",
          "",
          dateFec,
          "",
          "",
        ].join("\t")
      );
    }
  });

  const siren = sirenDepuisSiretOrId(settings?.siretOrId);
  const filename = `${siren}FEC${year}1231.txt`;
  res.setHeader("Content-Type", "text/plain; charset=iso-8859-1");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(versLatin1Fec(rows.join("\n")));
});
