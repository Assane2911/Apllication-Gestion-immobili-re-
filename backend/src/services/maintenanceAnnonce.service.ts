import { and, isNotNull, isNull, eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { langueOuDefaut } from "../utils/langue";
import { maintenanceAnnouncementEmail, sendEmail } from "./email.service";
import type { FenetreMaintenance } from "./maintenance.service";

/** Envois simultanés : assez pour tenir dans le délai d'une fonction serverless, pas assez pour saturer le serveur d'envoi. */
const ENVOIS_SIMULTANES = 8;

export interface BilanAnnonce {
  /** Gestionnaires ciblés. */
  destinataires: number;
  /** Adresses pour lesquelles l'envoi a été accepté par le serveur d'envoi. */
  envoyes: number;
  /** Adresses pour lesquelles l'envoi a échoué (déjà signalé dans les journaux et à Sentry par sendEmail). */
  echecs: number;
}

/**
 * Prévient par e-mail les gestionnaires qu'une maintenance est planifiée, chacun dans sa langue.
 *
 * Destinataires : les titulaires de compte gestionnaire (pas les collaborateurs d'une équipe) dont l'adresse est confirmée et
 * dont le compte n'est pas suspendu — un compte suspendu ne peut pas se connecter, l'annonce ne le concerne pas.
 * Un échec d'envoi n'interrompt pas les autres : il est compté dans le bilan.
 */
export async function annoncerMaintenanceAuxGestionnaires(fenetre: FenetreMaintenance): Promise<BilanAnnonce> {
  const destinataires = await db
    .select({ email: users.email, language: users.language })
    .from(users)
    .where(and(eq(users.role, "MANAGER"), isNull(users.teamOwnerId), isNull(users.suspendedAt), isNotNull(users.emailVerifiedAt)));

  const bilan: BilanAnnonce = { destinataires: destinataires.length, envoyes: 0, echecs: 0 };
  for (let i = 0; i < destinataires.length; i += ENVOIS_SIMULTANES) {
    const lot = destinataires.slice(i, i + ENVOIS_SIMULTANES);
    const resultats = await Promise.allSettled(
      lot.map((d) => {
        const { subject, html } = maintenanceAnnouncementEmail({ debut: fenetre.debut, fin: fenetre.fin, message: fenetre.message, langue: langueOuDefaut(d.language) });
        return sendEmail(d.email, subject, html);
      })
    );
    for (const r of resultats) {
      if (r.status === "fulfilled" && !("error" in r.value && r.value.error)) bilan.envoyes += 1;
      else bilan.echecs += 1;
    }
  }
  return bilan;
}
