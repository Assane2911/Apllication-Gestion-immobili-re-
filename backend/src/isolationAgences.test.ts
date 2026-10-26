import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app";
import { contractCotenants, contractGuarantors, formalNotices, issueReports, listingLeads, listings, ownerPayouts, rentRevisions } from "./db/schema";
import {
  authHeader,
  createContract,
  createExpense,
  createInspection,
  createInsurancePolicy,
  createInvoice,
  createManager,
  createOwner,
  createProperty,
  createTeamMember,
  createTenant,
  createVendor,
  tokenFor,
  tokenLocataire,
  tokenProprietaire,
} from "./test/authHelpers";
import { testDb } from "./test/setupTestDb";

/**
 * Isolement entre agences, sur TOUTES les routes de l'API.
 *
 * Chaque agence ne doit voir et toucher que ses propres données. Ce test parcourt les routes réellement enregistrées et,
 * pour chaque route qui porte un identifiant, l'appelle avec les VRAIS identifiants de l'agence A (bien, locataire, bail,
 * facture, état des lieux, propriétaire, prestataire, dépense, assurance, incident, annonce, demande de contact, révision
 * de loyer, mise en demeure, colocataire, garant, versement, collaborateur) depuis trois intrus : un gestionnaire de
 * l'agence B (formule Entreprise, pour qu'aucune limite de formule ne masque un défaut d'isolement), un locataire de B et un
 * propriétaire de B. Les identifiants imbriqués (révision, garant, versement…) sont aussi réels : sinon le 404 d'un
 * identifiant inventé cacherait un défaut sur la ressource parente.
 *
 * Attendu : jamais de succès (2xx), jamais d'erreur serveur (5xx), et aucune donnée de A dans la réponse. Les routes
 * sans identifiant (listes, exports, tableau de bord, recherche) sont aussi appelées : rien de A ne doit en sortir.
 *
 * Une route qui porte un identifiant que ce test ne sait pas remplacer FAIT ÉCHOUER le test : on l'ajoute au monde ci-dessous.
 */
const MARQUEUR = "SECRETAGENCEA";
// La recherche renvoie le terme cherché : on cherche un fragment du marqueur, qui trouverait les données de A sans être lui-même le marqueur.
const RECHERCHE = MARQUEUR.slice(0, -1);

interface Route {
  methode: string;
  chemin: string;
  parametres: string[];
}

function cheminDepuisRegexp(source: string): string {
  return source.replace("^", "").replace("\\/?(?=\\/|$)", "").replace("(?:\\/(?=$))?", "").replace(/\\\//g, "/").replace("$", "");
}
function collecter(pile: any[], prefixe: string, sortie: Route[]) {
  for (const couche of pile) {
    if (couche.route) {
      for (const methode of Object.keys(couche.route.methods)) {
        const chemin = (prefixe + (typeof couche.route.path === "string" ? couche.route.path : "")).replace(/\/+$/, "") || "/";
        sortie.push({ methode: methode.toUpperCase(), chemin, parametres: [...chemin.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]) });
      }
    } else if (couche.name === "router" && couche.handle?.stack) {
      collecter(couche.handle.stack, prefixe + cheminDepuisRegexp(couche.regexp.source), sortie);
    }
  }
}
const toutes: Route[] = [];
collecter((app as any)._router.stack, "", toutes);

// Routes publiques par conception (voir routesOuvertes.test.ts) et routes qui ne désignent aucune ressource.
const IGNOREES = [/^\/api\/listings\/public/, /^\/api\/auth\//, /^\/api\/health/, /^\/api\/csp-report/, /^\/api\/payments\/paydunya\/ipn/, /^\/api\/cron\//, /^\/api\/subscription\/plans/];
const routes = toutes.filter((r) => r.chemin.startsWith("/api") && !IGNOREES.some((re) => re.test(r.chemin)));

async function monde() {
  const a = await createManager({ subscriptionPlan: "ENTERPRISE" });
  const b = await createManager({ subscriptionPlan: "ENTERPRISE" });

  const bien = await createProperty(a.id, { title: `${MARQUEUR} Villa` });
  const locataire = await createTenant(a.id, { lastName: MARQUEUR });
  const colocataire = await createTenant(a.id, { lastName: `${MARQUEUR}2` });
  const proprio = await createOwner(a.id, { lastName: MARQUEUR });
  const bail = await createContract(bien.id, locataire.id);
  const facture = await createInvoice(bail.id, { status: "PAID", paidAt: new Date() });
  const edl = await createInspection(bail, a.id);
  const prestataire = await createVendor(a.id, { name: MARQUEUR });
  const depense = await createExpense(bien.id, { title: MARQUEUR });
  const police = await createInsurancePolicy(bien.id, { insurerName: MARQUEUR });
  const [revision] = await testDb.insert(rentRevisions).values({ contractId: bail.id, previousRent: 500, newRent: 520, effectiveDate: new Date(2027, 0, 1), method: "MANUAL", note: MARQUEUR }).returning();
  const [miseEnDemeure] = await testDb.insert(formalNotices).values({ contractId: bail.id, managerId: a.id, invoicesSnapshot: "[]", totalDue: 500, deadlineDays: 8 }).returning();
  const [coloc] = await testDb.insert(contractCotenants).values({ contractId: bail.id, tenantId: colocataire.id }).returning();
  const [garant] = await testDb.insert(contractGuarantors).values({ contractId: bail.id, firstName: MARQUEUR, lastName: "Garant", phone: "0600000009" }).returning();
  const [versement] = await testDb.insert(ownerPayouts).values({ ownerId: proprio.id, periodMonth: 6, periodYear: 2026, currency: "EUR", amount: 400, paidAt: new Date(), method: "BANK_TRANSFER", note: MARQUEUR }).returning();
  const [incident] = await testDb.insert(issueReports).values({ contractId: bail.id, tenantId: locataire.id, title: MARQUEUR, description: "Fuite", photoUrl: "issues/x.jpg" }).returning();
  const [annonce] = await testDb.insert(listings).values({ managerId: a.id, title: MARQUEUR, description: "Belle villa", price: 500, location: "Dakar" }).returning();
  const [demande] = await testDb.insert(listingLeads).values({ listingId: annonce.id, managerId: a.id, prospectName: MARQUEUR, prospectEmail: "p@test.local", prospectPhone: "0600000008" }).returning();
  const collaborateur = await createTeamMember(a.id);

  const bienB = await createProperty(b.id);
  const locataireB = await createTenant(b.id);
  await createContract(bienB.id, locataireB.id);
  const proprioB = await createOwner(b.id);

  const ids = { bien, locataire, proprio, bail, facture, edl, prestataire, depense, police, revision, miseEnDemeure, coloc, garant, versement, incident, annonce, demande, collaborateur, a };
  const intrus = {
    "gestionnaire de B": authHeader(tokenFor(b)),
    "locataire de B": authHeader(await tokenLocataire(locataireB.id)),
    "propriétaire de B": authHeader(await tokenProprietaire(proprioB)),
  };
  return { ids, intrus };
}

/** L'identifiant de l'agence A que doit recevoir ce paramètre de cette route. */
function identifiant(route: Route, parametre: string, w: Awaited<ReturnType<typeof monde>>["ids"]): string | null {
  const c = route.chemin;
  const p = parametre;
  if (c.startsWith("/api/admin/")) return w.a.id;
  if (c.startsWith("/api/properties")) return p === "id" ? w.bien.id : null;
  if (c.startsWith("/api/tenants")) return p === "id" ? w.locataire.id : null;
  if (c.startsWith("/api/owners")) return p === "id" ? w.proprio.id : null;
  if (c.startsWith("/api/crg")) return p === "ownerId" ? w.proprio.id : p === "payoutId" ? w.versement.id : null;
  if (c.startsWith("/api/contracts")) {
    return { id: w.bail.id, revisionId: w.revision.id, cotenantId: w.coloc.id, guarantorId: w.garant.id }[p] ?? null;
  }
  if (c.startsWith("/api/invoices")) return p === "id" ? w.facture.id : null;
  if (c.startsWith("/api/inspections")) return p === "id" ? w.edl.id : null;
  if (c.startsWith("/api/expenses")) return p === "id" ? w.depense.id : null;
  if (c.startsWith("/api/insurance-policies")) return p === "id" ? w.police.id : null;
  if (c.startsWith("/api/vendors")) return p === "id" ? w.prestataire.id : null;
  if (c.startsWith("/api/issues")) return p === "id" ? w.incident.id : null;
  if (c.startsWith("/api/listings/leads")) return p === "id" ? w.demande.id : null;
  if (c.startsWith("/api/listings")) return p === "id" ? w.annonce.id : null;
  if (c.startsWith("/api/messages")) return p === "contractId" ? w.bail.id : null;
  if (c.startsWith("/api/team")) return p === "id" ? w.collaborateur.id : null;
  if (c.startsWith("/api/documents")) {
    return { invoiceId: w.facture.id, contractId: w.bail.id, inspectionId: w.edl.id, revisionId: w.revision.id, noticeId: w.miseEnDemeure.id }[p] ?? null;
  }
  return null;
}

// Paramètres qui ne désignent pas une ressource d'une agence.
const NEUTRES = /^\/api\/import\/modele\/:type$/;

describe("isolement entre agences : aucune route ne livre ni ne modifie les données d'une autre agence", () => {
  it("le parcours trouve bien les routes de l'application", () => {
    expect(routes.length).toBeGreaterThan(120);
  });

  it("chaque route qui porte un identifiant sait recevoir celui d'une ressource réelle de l'agence A", async () => {
    const { ids } = await monde();
    const nonMappees = routes
      .filter((r) => !NEUTRES.test(r.chemin))
      .flatMap((r) => r.parametres.filter((p) => identifiant(r, p, ids) === null).map((p) => `${r.methode} ${r.chemin} (:${p})`));
    expect(nonMappees, `ajoutez ces paramètres à l'identifiant() du test :\n${nonMappees.join("\n")}`).toEqual([]);
  });

  it("depuis l'agence B, aucune route ne répond par un succès, une erreur serveur ou une donnée de A", async () => {
    const { ids, intrus } = await monde();
    const fautes: string[] = [];
    for (const [nomIntrus, entete] of Object.entries(intrus)) {
      for (const r of routes) {
        if (NEUTRES.test(r.chemin)) continue;
        const url = r.parametres.reduce((u, p) => u.replace(`:${p}`, encodeURIComponent(identifiant(r, p, ids)!)), r.chemin);
        const requete = (request(app) as any)[r.methode.toLowerCase()](`${url}?q=${RECHERCHE}`).set(entete);
        const res: request.Response = ["GET", "DELETE"].includes(r.methode) ? await requete : await requete.send({});
        const corps = `${res.text ?? ""}${JSON.stringify(res.body ?? {})}`;
        if (res.status >= 500) fautes.push(`${nomIntrus} — ${r.methode} ${r.chemin} → ${res.status} (erreur serveur)`);
        else if (res.status >= 200 && res.status < 300 && r.parametres.length > 0) fautes.push(`${nomIntrus} — ${r.methode} ${r.chemin} → ${res.status} (succès sur une ressource d'une autre agence)`);
        if (corps.includes(MARQUEUR)) fautes.push(`${nomIntrus} — ${r.methode} ${r.chemin} → ${res.status} (donnée de l'agence A dans la réponse)`);
      }
    }
    expect(fautes, fautes.join("\n")).toEqual([]);
  }, 300_000);
});
