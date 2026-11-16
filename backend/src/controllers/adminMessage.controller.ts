import { and, eq, ne } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { users } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { adminMessageEmail, sendEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { langueOuDefaut } from "../utils/langue";

const messageSchema = z.object({
  subject: z.string().trim().min(3, "Indiquez l'objet du message").max(150),
  message: z.string().trim().min(5, "Écrivez votre message").max(5000),
});

/**
 * Écrit à un compte (gestionnaire, collaborateur, auteur d'une suggestion) DEPUIS la plateforme : le geste des boutons « Écrire à… »
 * de l'administration. C'étaient des liens « mailto: » qui n'ouvraient rien sur un poste sans messagerie configurée.
 *
 * Les réponses partent vers l'adresse de l'administrateur qui écrit (jamais vers la boîte d'envoi de la plateforme, que personne ne
 * lit). Un compte suspendu peut être contacté : c'est souvent justement pour régler sa suspension. Un administrateur n'est jamais
 * destinataire. Un envoi simulé (messagerie non configurée) est un ÉCHEC : annoncer « message envoyé » alors que rien n'est parti
 * serait un mensonge. Le texte lui-même n'est pas recopié dans le journal d'audit (il peut contenir des données personnelles) : on
 * y garde l'objet.
 */
export const sendAdminMessage = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { subject, message } = messageSchema.parse(req.body ?? {});

  const [cible] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), ne(users.role, "ADMIN")));
  if (!cible) throw new ApiError(404, "Compte introuvable", "USER_NOT_FOUND");

  const [admin] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.user!.userId));

  const { subject: sujet, html } = adminMessageEmail({ subject, message, langue: langueOuDefaut(cible.language) });
  const resultat = await sendEmail(cible.email, sujet, html, undefined, admin?.email ? { replyTo: admin.email } : undefined);
  if ("error" in resultat || resultat.simulated) {
    throw new ApiError(502, "Le message n'a pas pu être envoyé : le service d'e-mail n'a pas accepté le message.", "ADMIN_MESSAGE_SEND_FAILED");
  }

  await logAdminAction({
    req,
    action: "user.message",
    targetUserId: id,
    targetLabel: cible.email,
    details: `Message envoyé. Objet : ${subject}`,
  });

  res.json({ success: true });
});
