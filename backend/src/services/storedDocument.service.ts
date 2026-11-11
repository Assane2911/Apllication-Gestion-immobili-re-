import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { storedDocuments } from "../db/schema";
import { deleteStorageObjectBestEffort } from "./storage.service";

/**
 * Chemins de stockage des documents rangés d'un locataire. À lire AVANT de supprimer ou d'anonymiser la fiche : une fois
 * les lignes parties (par cascade ou explicitement), plus rien ne permet de retrouver les fichiers pour les purger.
 */
export async function cheminsDocumentsDuLocataire(tenantId: string): Promise<string[]> {
  return (await documentsDuLocataire(tenantId)).map((d) => d.chemin);
}

/** Identifiant et chemin de chaque document rangé au nom d'un locataire (les identifiants servent à retrouver le journal d'activité). */
export async function documentsDuLocataire(tenantId: string): Promise<Array<{ id: string; chemin: string }>> {
  return db.select({ id: storedDocuments.id, chemin: storedDocuments.filePath }).from(storedDocuments).where(eq(storedDocuments.tenantId, tenantId));
}

/** Idem pour un bien. */
export async function cheminsDocumentsDuBien(propertyId: string): Promise<string[]> {
  const lignes = await db.select({ chemin: storedDocuments.filePath }).from(storedDocuments).where(eq(storedDocuments.propertyId, propertyId));
  return lignes.map((l: { chemin: string }) => l.chemin);
}

/** Purge best-effort, après l'opération en base : un stockage indisponible ne doit jamais annuler ce que la base a enregistré. */
export async function supprimerFichiers(chemins: string[]): Promise<void> {
  await Promise.allSettled(chemins.map((c) => deleteStorageObjectBestEffort(c)));
}
