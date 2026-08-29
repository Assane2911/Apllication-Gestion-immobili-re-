import bcrypt from "bcryptjs";
import { asc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { contracts, invoices, properties, tenants, users } from "./db/schema";
import { generateInvoicesForContract } from "./services/invoice.service";

export async function seedDatabase() {
  console.log("🌱 Seed de la base de données...");

  const managerEmail = "gestionnaire@demo.com";
  const managerPassword = "Demo1234!";
  const tenantPassword = "Demo1234!";

  const [existingManager] = await db.select().from(users).where(eq(users.email, managerEmail));
  const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 jours d'essai gratuit

  if (!existingManager) {
    await db.insert(users).values({
      email: managerEmail,
      passwordHash: await bcrypt.hash(managerPassword, 10),
      role: "MANAGER",
      subscriptionStatus: "TRIAL",
      subscriptionPlan: "PRO",
      trialEndsAt,
    });
    console.log(`👤 Compte gestionnaire créé: ${managerEmail} / ${managerPassword} (Essai: 15 jours)`);
  } else {
    await db
      .update(users)
      .set({
        subscriptionStatus: existingManager.subscriptionStatus || "TRIAL",
        subscriptionPlan: existingManager.subscriptionPlan || "PRO",
        trialEndsAt: existingManager.trialEndsAt || trialEndsAt,
      })
      .where(eq(users.id, existingManager.id));
  }

  const propertiesData = [
    { title: "Appartement T3 - Bairro Alto", address: "Rua da Liberdade 12, São Tomé", surface: 75, rent: 350, status: "OCCUPIED" as const },
    { title: "Studio meublé - Centre-ville", address: "Avenida Marginal 5, São Tomé", surface: 30, rent: 180, status: "OCCUPIED" as const },
    { title: "Villa avec jardin", address: "Praia Micondó, São Tomé", surface: 160, rent: 650, status: "AVAILABLE" as const },
    { title: "Local commercial", address: "Mercado Municipal, São Tomé", surface: 90, rent: 400, status: "MAINTENANCE" as const },
  ];

  const propertyRows = [];
  for (const p of propertiesData) {
    const [existing] = await db.select().from(properties).where(eq(properties.title, p.title));
    propertyRows.push(existing ?? (await db.insert(properties).values(p).returning())[0]);
  }

  const tenantsData = [
    { firstName: "Amine", lastName: "Silva", phone: "+239 990 1122", email: "amine.silva@demo.com" },
    { firstName: "Carla", lastName: "Neto", phone: "+239 990 3344", email: "carla.neto@demo.com" },
  ];

  const tenantRows = [];
  for (const t of tenantsData) {
    const [existing] = await db.select().from(tenants).where(eq(tenants.email, t.email));
    tenantRows.push(existing ?? (await db.insert(tenants).values(t).returning())[0]);
  }

  // Compte portail pour le premier locataire (démo)
  const [tenantUserExisting] = await db.select().from(users).where(eq(users.email, tenantRows[0].email));
  if (!tenantUserExisting) {
    const [user] = await db
      .insert(users)
      .values({
        email: tenantRows[0].email,
        passwordHash: await bcrypt.hash(tenantPassword, 10),
        role: "TENANT",
      })
      .returning();
    await db.update(tenants).set({ userId: user.id }).where(eq(tenants.id, tenantRows[0].id));
    console.log(`👤 Compte locataire (portail) créé: ${tenantRows[0].email} / ${tenantPassword} (userId=${user.id})`);
  }

  const now = new Date();
  const in13Days = new Date(now);
  in13Days.setDate(in13Days.getDate() + 13);

  const contractsData = [
    {
      propertyId: propertyRows[0].id,
      tenantId: tenantRows[0].id,
      rent: propertyRows[0].rent,
      deposit: propertyRows[0].rent * 2,
      startDate: new Date(now.getFullYear(), now.getMonth() - 4, 1),
      endDate: in13Days,
      status: "ACTIVE" as const,
    },
    {
      propertyId: propertyRows[1].id,
      tenantId: tenantRows[1].id,
      rent: propertyRows[1].rent,
      deposit: propertyRows[1].rent * 2,
      startDate: new Date(now.getFullYear(), now.getMonth() - 2, 1),
      endDate: new Date(now.getFullYear() + 1, now.getMonth(), 1),
      status: "ACTIVE" as const,
    },
  ];

  const createdContracts = [];
  for (const c of contractsData) {
    const existingRows = await db.select().from(contracts).where(eq(contracts.propertyId, c.propertyId));
    const existing = existingRows.find((row: typeof contracts.$inferSelect) => row.tenantId === c.tenantId);
    const [contract] = existing ? [existing] : await db.insert(contracts).values(c).returning();
    createdContracts.push(contract);
    await generateInvoicesForContract(contract);
  }

  const firstContractInvoices = await db
    .select()
    .from(invoices)
    .where(eq(invoices.contractId, createdContracts[0].id))
    .orderBy(asc(invoices.periodYear), asc(invoices.periodMonth));

  if (firstContractInvoices[0] && firstContractInvoices[0].status !== "PAID") {
    await db
      .update(invoices)
      .set({ status: "PAID", paidAt: new Date(), paymentMethod: "DEMO", paymentRef: "seed_demo" })
      .where(eq(invoices.id, firstContractInvoices[0].id));
  }

  console.log("✅ Seed terminé.");
}

if (process.argv[1]?.includes("seed")) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

