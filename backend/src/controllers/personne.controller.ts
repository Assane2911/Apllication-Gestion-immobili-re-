import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contractGuarantors, contracts, listingLeads, listings, properties } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";
import { avecCode } from "../utils/validationExplicite";

/**
 * Droits des personnes qui n'ont PAS de compte : les garants d'un bail et les prospects qui ont écrit depuis une annonce.
 *
 * Le locataire et le propriétaire exercent leurs droits d'accès (RGPD art. 15), de portabilité (art. 20) et d'effacement
 * (art. 17) depuis leur espace, ou par le gestionnaire. Un garant ou un prospect n'a ni espace ni fiche : il adresse sa demande
 * au gestionnaire, responsable de traitement, qui n'avait aucun outil pour y répondre (un garant sur un bail signé ne peut
 * même plus être retiré : voir assertBailNonSigne, guarantor.controller.ts).
 *
 * La personne se retrouve par son adresse e-mail ou son numéro de téléphone, SEULEMENT parmi ce que cette agence détient :
 * l'export ne déborde jamais sur une autre agence, ni sur un autre garant ou prospect.
 */
const critereSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254)
      .email("Adresse email invalide")
      .transform((v) => v.toLowerCase())
      .optional(),
    phone: z
      .string()
      .trim()
      .max(40)
      .refine((v) => versE164(v) !== null, avecCode(MESSAGE_TELEPHONE_INVALIDE, "PHONE_INVALID"))
      .transform((v) => versE164(v)!)
      .optional(),
  })
  .refine((c) => c.email || c.phone, avecCode("Indiquez l'adresse email ou le téléphone de la personne.", "PERSON_CRITERIA_REQUIRED"));

type Critere = z.infer<typeof critereSchema>;

/** Les lignes de cette agence qui portent l'email ou le téléphone cherchés. Le téléphone d'un prospect est saisi librement : on cherche aussi sa forme normalisée. */
async function trouverPersonne(managerId: string, critere: Critere) {
  const conditionsGarant = [];
  const conditionsProspect = [];
  if (critere.email) {
    conditionsGarant.push(sql`lower(${contractGuarantors.email}) = ${critere.email}`);
    conditionsProspect.push(sql`lower(${listingLeads.prospectEmail}) = ${critere.email}`);
  }
  if (critere.phone) {
    conditionsGarant.push(eq(contractGuarantors.phone, critere.phone));
    conditionsProspect.push(inArray(listingLeads.prospectPhone, [critere.phone, critere.phone.replace(/^\+/, "")]));
  }

  const garants = await db
    .select({
      garant: contractGuarantors,
      bail: { id: contracts.id, startDate: contracts.startDate, endDate: contracts.endDate },
      bien: { title: properties.title, address: properties.address },
    })
    .from(contractGuarantors)
    .innerJoin(contracts, eq(contractGuarantors.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(properties.managerId, managerId), or(...conditionsGarant)));

  const prospects = await db
    .select({ prospect: listingLeads, annonce: { title: listings.title } })
    .from(listingLeads)
    .innerJoin(listings, eq(listingLeads.listingId, listings.id))
    .where(and(eq(listingLeads.managerId, managerId), or(...conditionsProspect)));

  return { garants, prospects };
}

const aucuneDonnee = () => new ApiError(404, "Aucune donnée détenue pour cette personne.", "PERSON_DATA_NOT_FOUND");

/**
 * Droit d'accès et portabilité : tout ce que cette agence détient sur la personne, en un fichier JSON (« structuré, couramment
 * utilisé et lisible par machine », art. 20). Rien n'est filtré de ce qui la concerne, notes internes comprises ; rien n'est
 * ajouté de ce qui concerne quelqu'un d'autre : pour un garant, le bail n'est désigné que par ses dates et son bien, jamais par
 * l'identité du locataire.
 */
export const exporterPersonne = asyncHandler(async (req: Request, res: Response) => {
  const critere = critereSchema.parse({ email: req.query.email || undefined, phone: req.query.phone || undefined });
  const managerId = req.user!.userId;
  const { garants, prospects } = await trouverPersonne(managerId, critere);
  if (garants.length === 0 && prospects.length === 0) throw aucuneDonnee();

  // Qui a sorti ce dossier, et quand, reste visible ; l'identité de la personne n'est PAS recopiée dans le journal.
  await logActivity({
    req,
    managerId,
    action: "personne.export",
    entityType: "personne",
    entityId: null,
    entityLabel: "Garant / prospect",
    details: `Export des données d'une personne sans compte : ${garants.length} garant(s), ${prospects.length} demande(s) de prospect.`,
  });

  const donnees = {
    exporteLe: new Date().toISOString(),
    critere,
    garants: garants.map((g: (typeof garants)[number]) => ({ ...g.garant, bail: g.bail, bien: g.bien })),
    prospects: prospects.map((p: (typeof prospects)[number]) => ({ ...p.prospect, annonce: p.annonce })),
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="donnees-personne.json"');
  res.send(JSON.stringify(donnees, null, 2));
});

/**
 * Droit à l'effacement : ce qui IDENTIFIE la personne disparaît (nom, téléphone, email, adresse, message, notes), les lignes
 * restent. Un garant d'un bail signé ne peut pas être retiré — son nom figure sur le contrat signé, que le gestionnaire doit
 * conserver — mais l'identité qu'il avait donnée n'a pas à rester dans la base pour autant : le plafond garanti et le rattachement
 * au bail demeurent, rattachés à une fiche anonyme. Une demande de prospect est anonymisée plutôt que supprimée, pour que les
 * statistiques de l'annonce restent justes.
 */
export const anonymiserPersonne = asyncHandler(async (req: Request, res: Response) => {
  const critere = critereSchema.parse(req.body);
  const managerId = req.user!.userId;
  const { garants, prospects } = await trouverPersonne(managerId, critere);
  if (garants.length === 0 && prospects.length === 0) throw aucuneDonnee();

  await db.transaction(async (tx: Pick<typeof db, "update">) => {
    const idsGarants = garants.map((g: (typeof garants)[number]) => g.garant.id);
    if (idsGarants.length > 0) {
      await tx
        .update(contractGuarantors)
        .set({ civility: null, firstName: "Garant", lastName: "anonymisé", phone: "", email: null, address: null, notes: null })
        .where(inArray(contractGuarantors.id, idsGarants));
    }
    for (const { prospect } of prospects) {
      await tx
        .update(listingLeads)
        .set({ prospectName: "Prospect anonymisé", prospectEmail: `anonyme-${prospect.id}@supprime.invalid`, prospectPhone: "", message: null, notes: null })
        .where(eq(listingLeads.id, prospect.id));
    }
  });

  await logActivity({
    req,
    managerId,
    action: "personne.anonymize",
    entityType: "personne",
    entityId: null,
    entityLabel: "Garant / prospect",
    details: `Données d'une personne sans compte anonymisées : ${garants.length} garant(s), ${prospects.length} demande(s) de prospect.`,
  });

  res.json({ garants: garants.length, prospects: prospects.length });
});
