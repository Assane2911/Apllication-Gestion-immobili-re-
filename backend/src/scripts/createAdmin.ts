/**
 * Crée (ou met à jour) un compte ADMIN directement en base — il n'existe
 * volontairement aucune inscription publique pour ce rôle. À lancer une
 * seule fois par compte admin nécessaire :
 *
 *   npm run create-admin -- admin@immoplatformpro.com "MotDePasseSolide!23"
 *
 * Si l'email existe déjà (quel que soit son rôle actuel), son rôle est
 * simplement basculé sur ADMIN et son mot de passe mis à jour — pratique
 * pour promouvoir un compte de test existant sans repartir de zéro.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";

async function main() {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error("Usage : npm run create-admin -- <email> <mot-de-passe>");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Le mot de passe doit contenir au moins 8 caractères.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [existing] = await db.select().from(users).where(eq(users.email, email));

  if (existing) {
    await db
      .update(users)
      .set({ role: "ADMIN", passwordHash, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() })
      .where(eq(users.id, existing.id));
    console.log(`✅ Compte existant ${email} promu ADMIN et mot de passe mis à jour.`);
  } else {
    await db.insert(users).values({
      email,
      passwordHash,
      role: "ADMIN",
      emailVerifiedAt: new Date(),
    });
    console.log(`✅ Compte ADMIN créé : ${email}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Échec de la création du compte admin :", err);
  process.exit(1);
});
