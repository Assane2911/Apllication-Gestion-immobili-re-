import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { adminAuditLogs, users } from "../db/schema";

/**
 * Remet à zéro la double authentification d'un compte ADMINISTRATEUR qui a perdu son téléphone ET ses codes de secours.
 *
 * L'administration exige la double authentification (voir exigerDeuxFacteursAdmin, middleware/auth.ts), et la désactiver depuis le
 * site exige un code : un administrateur qui n'a plus aucun des deux ne peut pas se rattraper seul. Cette opération ne s'exécute
 * donc QUE par la ligne de commande (npm run reset-admin-2fa), c'est-à-dire avec l'accès à la base de production : il n'existe
 * volontairement aucune route web pour cela, qui deviendrait la porte dérobée d'une protection censée résister à un mot de passe volé.
 *
 * Effets : le secret, les codes de secours et le dernier pas accepté sont effacés ; toutes les sessions ouvertes du compte sont
 * révoquées (tokenVersion + 1), car la personne qui a perdu son téléphone peut aussi avoir perdu un appareil connecté ; l'action est
 * inscrite au journal d'audit de l'administration. Le mot de passe n'est PAS touché : l'administrateur se reconnecte avec lui,
 * puis l'espace d'administration lui impose de réactiver la double authentification, avec de nouveaux codes de secours.
 */
export async function reinitialiserDeuxFacteursAdmin(emailBrut: string) {
  const email = emailBrut.trim().toLowerCase();
  const [compte] = await db.select().from(users).where(eq(users.email, email));
  if (!compte) throw new Error(`Aucun compte pour ${email}.`);
  // Jamais un gestionnaire : sa double authentification est une protection personnelle que l'on ne retire pas en ligne de commande.
  if (compte.role !== "ADMIN") throw new Error(`${email} n'est pas un compte administrateur (rôle ${compte.role}) : rien n'a été modifié.`);

  const avaitDeuxFacteurs = !!compte.totpEnabledAt;
  await db.transaction(async (tx: Pick<typeof db, "update" | "insert">) => {
    await tx
      .update(users)
      .set({ totpSecret: null, totpEnabledAt: null, totpBackupCodesHash: null, totpLastUsedStep: null, tokenVersion: compte.tokenVersion + 1 })
      .where(eq(users.id, compte.id));
    await tx.insert(adminAuditLogs).values({
      adminId: compte.id,
      adminEmail: compte.email,
      action: "admin.two_factor_reset",
      targetUserId: compte.id,
      targetLabel: compte.email,
      details: "Double authentification réinitialisée en ligne de commande (accès à la base requis) ; sessions ouvertes révoquées ; réactivation exigée à la prochaine connexion.",
    });
  });

  return { id: compte.id, email: compte.email, avaitDeuxFacteurs };
}
