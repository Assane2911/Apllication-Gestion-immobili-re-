/**
 * Compare le schéma applicatif (src/db/schema.ts) à la base réellement
 * connectée, et signale toute colonne ou table manquante :
 *
 *   npm run db:check
 *
 * Pourquoi ce script existe. Drizzle ne fait jamais de `SELECT *` : il nomme
 * explicitement chaque colonne déclarée dans schema.ts. Une seule colonne
 * absente en base fait donc échouer la requête entière, et la page concernée
 * répond « Erreur interne du serveur » sans dire pourquoi. C'est exactement ce
 * qui est arrivé en production : deux colonnes ajoutées au schéma pour la
 * fonctionnalité de bail scanné, déployées, mais jamais propagées à la base
 * faute d'un `npm run db:push` — et toute la page Contrats hors service.
 *
 * À lancer après chaque modification de schema.ts, en pointant DATABASE_URL
 * sur la base à vérifier. Le script est en lecture seule : il n'interroge que
 * information_schema et ne modifie rien.
 *
 * Il sort en code 1 dès qu'une divergence est trouvée, afin de pouvoir servir
 * de garde-fou dans un enchaînement de commandes.
 */
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "../db/client";
import * as schema from "../db/schema";

type LigneInformationSchema = { table_name: string; column_name: string };

async function main() {
  // Les tables attendues sont lues depuis les métadonnées de Drizzle
  // elles-mêmes, et non par analyse du fichier source : c'est la même
  // information que celle utilisée pour construire les requêtes, donc elle ne
  // peut pas s'en écarter.
  const attendu = new Map<string, string[]>();
  for (const valeur of Object.values(schema)) {
    if (!is(valeur, PgTable)) continue;
    const colonnes = Object.values(getTableColumns(valeur)).map((c) => c.name);
    attendu.set(getTableName(valeur), colonnes);
  }

  const resultat = await db.execute(
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );

  // Les deux pilotes (postgres-js en production, PGlite en local) renvoient
  // soit un tableau de lignes, soit un objet { rows: [...] }.
  const lignes = (Array.isArray(resultat) ? resultat : (resultat as { rows?: unknown[] }).rows ?? []) as LigneInformationSchema[];

  const reel = new Map<string, Set<string>>();
  for (const ligne of lignes) {
    if (!reel.has(ligne.table_name)) reel.set(ligne.table_name, new Set());
    reel.get(ligne.table_name)!.add(ligne.column_name);
  }

  let divergences = 0;
  for (const [table, colonnes] of [...attendu.entries()].sort()) {
    const presentes = reel.get(table);

    if (!presentes) {
      console.error(`  ✖ ${table} — TABLE ABSENTE de la base`);
      divergences++;
      continue;
    }

    const manquantes = colonnes.filter((c) => !presentes.has(c));
    if (manquantes.length > 0) {
      console.error(`  ✖ ${table} — colonnes manquantes : ${manquantes.join(", ")}`);
      divergences++;
    } else {
      console.log(`  ✔ ${table}`);
    }
  }

  console.log("");
  if (divergences > 0) {
    console.error(
      `${divergences} table(s) en écart sur ${attendu.size}. La base est en retard sur le schéma :\n` +
        `lancez « npm run db:push » en pointant DATABASE_URL sur cette base.`
    );
    process.exit(1);
  }

  console.log(`Base conforme au schéma (${attendu.size} tables vérifiées).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Vérification impossible :", err instanceof Error ? err.message : err);
  process.exit(1);
});
