import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, formalNotices, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import {
  bauxAMettreEnDemeure,
  DELAI_PAR_DEFAUT_JOURS,
  donneesDuCourrier,
  emettreMiseEnDemeure,
  listerMisesEnDemeure,
  referenceMiseEnDemeure,
} from "../services/miseEnDemeure.service";
import { generateFormalNoticeHtml } from "../services/pdf.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire, assertOwnership, estLocataireDuBail } from "../utils/authorization";
import { formaterMontant } from "../utils/montant";
import { nomComplet } from "../utils/nom";

const emissionSchema = z.object({
  deadlineDays: z.coerce.number().int("Le délai est un nombre entier de jours.").min(1).max(60).default(DELAI_PAR_DEFAUT_JOURS),
  sendEmail: z.boolean().default(false),
  notifyGuarantors: z.boolean().default(false),
});

async function contratDuGestionnaire(req: Request) {
  const [contrat] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!contrat) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  const [bien] = await db.select().from(properties).where(eq(properties.id, contrat.propertyId));
  assertOwnership(bien, (p) => p.managerId, req.user!.userId, "Contrat introuvable", 404, "CONTRACT_NOT_FOUND");
  return { contrat, bien };
}

/** Baux dont un impayé appelle une mise en demeure qui n'a pas encore été émise. */
export const listFormalNoticesDue = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bauxAMettreEnDemeure(req.user!.userId));
});

export const listFormalNotices = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await contratDuGestionnaire(req);
  const notices = await listerMisesEnDemeure(contrat.id);
  res.json(notices.map(({ invoicesSnapshot: _snapshot, ...n }) => ({ ...n, reference: referenceMiseEnDemeure(n) })));
});

export const createFormalNotice = asyncHandler(async (req: Request, res: Response) => {
  const body = emissionSchema.parse(req.body ?? {});
  const { contrat, bien } = await contratDuGestionnaire(req);

  const resultat = await emettreMiseEnDemeure({
    contractId: contrat.id,
    managerId: bien.managerId,
    deadlineDays: body.deadlineDays,
    envoyerParEmail: body.sendEmail,
    prevenirGarants: body.notifyGuarantors,
    createdBy: req.user!.collaboratorId ?? req.user!.userId,
  });
  const n = resultat.notice;
  const reference = referenceMiseEnDemeure(n);

  const [locataire] = await db.select().from(tenants).where(eq(tenants.id, contrat.tenantId));
  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.formal_notice",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: `${bien.title}${locataire ? ` — ${nomComplet(locataire)}` : ""}`,
    details:
      `Mise en demeure ${reference} émise : ${formaterMontant(n.totalDue, n.currency)} à régler sous ${n.deadlineDays} jour(s)` +
      (body.sendEmail ? (resultat.emailEnvoye ? ", envoyée par email" : ", email NON parti") : ", sans envoi par email") +
      (resultat.garantsPrevenus > 0 ? `, ${resultat.garantsPrevenus} garant(s) en copie.` : "."),
  });

  const { invoicesSnapshot: _snapshot, ...notice } = n;
  res.status(201).json({
    ...notice,
    reference,
    emailEnvoye: resultat.emailEnvoye,
    colocatairesPrevenus: resultat.colocatairesPrevenus,
    garantsPrevenus: resultat.garantsPrevenus,
  });
});

/** Le courrier, à l'écran ou à imprimer : le gestionnaire du bien, ou un locataire du bail. */
export const getFormalNoticeDocument = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const [notice] = await db.select().from(formalNotices).where(eq(formalNotices.id, req.params.noticeId));
  if (!notice) throw new ApiError(404, "Mise en demeure introuvable", "FORMAL_NOTICE_NOT_FOUND");
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, notice.contractId));
  if (!contract) throw new ApiError(404, "Mise en demeure introuvable", "FORMAL_NOTICE_NOT_FOUND");
  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));
  assertAccesLocataireOuGestionnaire(req.user.role, await estLocataireDuBail(req, contract), property?.managerId === req.user.userId);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(generateFormalNoticeHtml(await donneesDuCourrier(notice)));
});
