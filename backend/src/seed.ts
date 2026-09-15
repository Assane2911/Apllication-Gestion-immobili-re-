import bcrypt from "bcryptjs";
import crypto from "crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { contracts, invoices, properties, tenants, users } from "./db/schema";
import { generateInvoicesForContract } from "./services/invoice.service";

/**
 * Le seed a-t-il le droit de s'exécuter sur la base actuellement configurée ?
 * Renvoie `null` si oui, sinon la raison du refus.
 *
 * Pourquoi ce garde-fou existe. Ce fichier créait des comptes de
 * démonstration avec un mot de passe écrit en clair dans le code — donc
 * publié, puisque le dépôt est public. Ces comptes se sont retrouvés dans la
 * base de PRODUCTION : un `npm run seed` (ou un `npm run dev`, qui déclenchait
 * alors un seed automatique) lancé avec DATABASE_URL pointant sur Supabase
 * suffisait. N'importe qui lisant le dépôt pouvait ensuite se connecter à la
 * plateforme en gestionnaire.
 *
 * Deux verrous, parce qu'un seul n'aurait pas suffi :
 *
 *  - le premier refuse la production (NODE_ENV, VERCEL) ;
 *  - le second refuse toute base NON LOCALE, et c'est celui qui aurait
 *    réellement évité l'incident : la machine était en développement, seule
 *    l'URL de base pointait ailleurs. Un `SEED_ALLOW_REMOTE=true` explicite
 *    reste possible pour un cas légitime (base de test distante), mais il faut
 *    alors l'écrire soi-même — ce n'est plus un défaut silencieux.
 */
export function refusDeSeed(): { raison: string } | null {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return { raison: "environnement de production" };
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    return { raison: "DATABASE_URL absente" };
  }

  if (!estBaseLocale(url) && process.env.SEED_ALLOW_REMOTE !== "true") {
    return {
      raison:
        `la base visée n'est pas locale (${hoteDe(url) ?? "hôte illisible"}). ` +
        `Si c'est volontaire, relance avec SEED_ALLOW_REMOTE=true`,
    };
  }

  return null;
}

function hoteDe(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function estBaseLocale(url: string): boolean {
  const hote = hoteDe(url);
  if (!hote) return false;
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"].includes(hote);
}

export async function seedDatabase() {
  const refus = refusDeSeed();
  if (refus) {
    throw new Error(
      `Seed refusé : ${refus.raison}. Ce script crée des comptes de démonstration — ` +
        `il ne doit jamais toucher une base réelle.`
    );
  }

  console.log("🌱 Seed de la base de données...");

  const managerEmail = "gestionnaire@demo.com";
  // Mot de passe ALÉATOIRE, affiché une seule fois. Un mot de passe fixe dans
  // le code est un identifiant publié : c'est précisément ce qui a ouvert la
  // plateforme de production. SEED_PASSWORD permet d'en fixer un pour un usage
  // local répétable, mais ce n'est jamais la valeur par défaut.
  const motDePasse = process.env.SEED_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
  const managerPassword = motDePasse;
  const tenantPassword = motDePasse;
  let comptesCrees = false;

  let [existingManager] = await db.select().from(users).where(eq(users.email, managerEmail));
  const trialEndsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 jours d'essai gratuit

  if (!existingManager) {
    const [created] = await db
      .insert(users)
      .values({
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        subscriptionStatus: "TRIAL",
        subscriptionPlan: "PRO",
        trialEndsAt,
      })
      .returning();
    existingManager = created;
    comptesCrees = true;
    console.log(`👤 Compte gestionnaire créé : ${managerEmail} (essai : 15 jours)`);
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

  const managerId = existingManager.id;

  const propertyRows = [];
  for (const p of propertiesData) {
    const [existing] = await db.select().from(properties).where(eq(properties.title, p.title));
    propertyRows.push(existing ?? (await db.insert(properties).values({ ...p, managerId }).returning())[0]);
  }

  const tenantsData = [
    { firstName: "Amine", lastName: "Silva", phone: "+239 990 1122", email: "amine.silva@demo.com" },
    { firstName: "Carla", lastName: "Neto", phone: "+239 990 3344", email: "carla.neto@demo.com" },
  ];

  const tenantRows = [];
  for (const t of tenantsData) {
    const [existing] = await db.select().from(tenants).where(eq(tenants.email, t.email));
    tenantRows.push(existing ?? (await db.insert(tenants).values({ ...t, managerId }).returning())[0]);
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

  if (comptesCrees) {
    console.log("");
    console.log("   ┌─────────────────────────────────────────────────────────");
    console.log(`   │ Mot de passe des comptes de démonstration : ${motDePasse}`);
    console.log("   │ Généré aléatoirement, affiché une seule fois — note-le.");
    console.log("   └─────────────────────────────────────────────────────────");
    console.log("");
  }
}

if (process.argv[1]?.includes("seed")) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((e) => {
      // Un refus du garde-fou n'est pas un plantage : on affiche la raison
      // seule, sans pile d'appels, pour que le message soit lisible.
      console.error(e instanceof Error ? `\n❌ ${e.message}\n` : e);
      process.exit(1);
    });
}

