/**
 * Récupération d'un compte ADMINISTRATEUR qui a perdu son téléphone ET ses codes de secours :
 *
 *   npm run reset-admin-2fa -- admin@immoplatformpro.com
 *
 * Efface son secret et ses codes de secours, révoque ses sessions et l'inscrit au journal d'audit. Son mot de passe est conservé :
 * à la prochaine connexion, l'espace d'administration lui impose de réactiver la double authentification (nouveaux codes de secours).
 * Se lance avec l'accès à la base de production (DATABASE_URL) ; aucune route web n'existe pour cela, volontairement.
 */
import { reinitialiserDeuxFacteursAdmin } from "../services/recuperationAdmin.service";

async function main() {
  const [, , email] = process.argv;
  if (!email) {
    console.error("Usage : npm run reset-admin-2fa -- <email-de-l-administrateur>");
    process.exit(1);
  }
  const resultat = await reinitialiserDeuxFacteursAdmin(email);
  console.log(
    resultat.avaitDeuxFacteurs
      ? `✅ Double authentification de ${resultat.email} réinitialisée ; ses sessions sont révoquées. Elle devra la réactiver à sa prochaine connexion.`
      : `ℹ️ ${resultat.email} n'avait pas de double authentification active ; ses sessions sont tout de même révoquées.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Échec de la réinitialisation :", err instanceof Error ? err.message : err);
  process.exit(1);
});
