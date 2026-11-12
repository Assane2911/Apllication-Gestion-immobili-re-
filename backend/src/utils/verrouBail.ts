import { eq } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { contracts } from "../db/schema";
import { ApiError } from "./asyncHandler";

/**
 * Relit le bail SOUS VERROU DE LIGNE, dans la transaction de l'appelant, et refuse s'il a été signé par le locataire.
 *
 * Les garants et les colocataires font partie du contenu signé du bail : on ne les ajoute, modifie ni retire plus après la signature.
 * Ce contrôle, fait sur une lecture faite au début de la requête, ne suffisait pas : le locataire peut signer (sur son téléphone) entre
 * cette lecture et l'écriture, et la liste changeait alors sous une signature qui ne l'avait jamais couverte. Avec le verrou, la
 * signature (dont l'UPDATE attend la fin de la transaction) passe soit avant : l'écriture est refusée ; soit après : elle couvre déjà la
 * nouvelle liste. Le même verrou sérialise aussi deux ajouts simultanés, donc le plafond par bail tient.
 */
export async function bailNonSigneSousVerrou(tx: Transaction, contractId: string, refus: () => ApiError): Promise<void> {
  const [bail] = await tx.select({ signedByTenantAt: contracts.signedByTenantAt }).from(contracts).where(eq(contracts.id, contractId)).for("update");
  if (!bail) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  if (bail.signedByTenantAt) throw refus();
}
