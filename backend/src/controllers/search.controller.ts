import { and, eq, ilike, or } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";

export interface SearchResultItem {
  id: string;
  type: "tenant" | "property" | "contract" | "invoice";
  title: string;
  subtitle: string;
  link: string;
}

/**
 * Recherche globale (barre de recherche unique en haut de l'app) parmi
 * locataires, biens, contrats et factures — jusqu'à 5 résultats par
 * catégorie, triés par pertinence simple (correspondance directe en tête).
 */
export const globalSearch = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    return res.json({ query: q, results: [] });
  }
  const pattern = `%${q}%`;

  const [tenantRows, propertyRows, contractRows, invoiceRows] = await Promise.all([
    db
      .select()
      .from(tenants)
      .where(
        and(
          eq(tenants.managerId, managerId),
          or(ilike(tenants.firstName, pattern), ilike(tenants.lastName, pattern), ilike(tenants.email, pattern), ilike(tenants.phone, pattern))
        )
      )
      .limit(5),
    db
      .select()
      .from(properties)
      .where(and(eq(properties.managerId, managerId), or(ilike(properties.title, pattern), ilike(properties.address, pattern))))
      .limit(5),
    db
      .select({ contract: contracts, property: properties, tenant: tenants })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(
        and(
          eq(properties.managerId, managerId),
          or(ilike(properties.title, pattern), ilike(tenants.firstName, pattern), ilike(tenants.lastName, pattern))
        )
      )
      .limit(5),
    db
      .select({ invoice: invoices, contract: contracts, property: properties, tenant: tenants })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(
        and(
          eq(properties.managerId, managerId),
          or(ilike(properties.title, pattern), ilike(tenants.firstName, pattern), ilike(tenants.lastName, pattern))
        )
      )
      .limit(5),
  ]);

  type TenantRow = typeof tenants.$inferSelect;
  type PropertyRow = typeof properties.$inferSelect;
  type ContractRow = { contract: typeof contracts.$inferSelect; property: PropertyRow; tenant: TenantRow };
  type InvoiceRow = { invoice: typeof invoices.$inferSelect; contract: typeof contracts.$inferSelect; property: PropertyRow; tenant: TenantRow };

  const results: SearchResultItem[] = [
    ...(tenantRows as TenantRow[]).map((t) => ({
      id: t.id,
      type: "tenant" as const,
      title: `${t.firstName} ${t.lastName}`,
      subtitle: t.email,
      link: "/tenants",
    })),
    ...(propertyRows as PropertyRow[]).map((p) => ({
      id: p.id,
      type: "property" as const,
      title: p.title,
      subtitle: p.address,
      link: "/properties",
    })),
    ...(contractRows as ContractRow[]).map((r) => ({
      id: r.contract.id,
      type: "contract" as const,
      title: `${r.property.title} — ${r.tenant.firstName} ${r.tenant.lastName}`,
      subtitle: `Contrat • ${r.contract.status}`,
      link: "/contracts",
    })),
    ...(invoiceRows as InvoiceRow[]).map((r) => ({
      id: r.invoice.id,
      type: "invoice" as const,
      title: `Facture ${r.invoice.periodMonth}/${r.invoice.periodYear} — ${r.property.title}`,
      subtitle: `${r.tenant.firstName} ${r.tenant.lastName} • ${r.invoice.status}`,
      link: "/invoices",
    })),
  ];

  res.json({ query: q, results });
});
