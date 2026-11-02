/**
 * Calculs du « compte de l'agence » : complétude du profil, historique d'abonnement, parrainage, import, guide.
 * Tout est pur (aucune lecture de l'horloge ni du réseau) pour rester testable ; les pages n'ajoutent que l'affichage.
 */
import { bicValide, ibanValide } from "./iban";
import { CSV_BOM, csvEscape, csvMontant } from "./csv";

const ligne = (cases: Array<string | number>) => cases.map(csvEscape).join(";");

// ───────────────────────────── Profil de l'agence ─────────────────────────────

export type ElementProfil = "name" | "legalId" | "address" | "phone" | "legalNotice" | "bank" | "logo" | "stamp";

export interface FormulaireProfil {
  agencyName: string;
  siretOrId: string;
  address: string;
  phone: string;
  legalNotice: string;
  iban: string;
  bic: string;
}

/** Ancre de la rubrique où l'élément se renseigne (le sommaire des réglages porte les mêmes identifiants). */
export const ANCRE_PROFIL: Record<ElementProfil, string> = {
  name: "agency-identite",
  legalId: "agency-identite",
  address: "agency-identite",
  phone: "agency-identite",
  legalNotice: "agency-identite",
  bank: "agency-banque",
  logo: "agency-logo",
  stamp: "agency-stamp",
};

const rempli = (v: string | null | undefined) => Boolean(v && v.trim());

/**
 * Les huit éléments que portent les documents de l'agence (bail, quittance, mise en demeure). Le champ « coordonnées
 * bancaires » compte quand l'IBAN est saisi : sa validité est une indication à part (`avertissementsBancaires`).
 */
export function completudeProfil(form: FormulaireProfil, logoUrl: string | null, stampUrl: string | null) {
  const faits: Record<ElementProfil, boolean> = {
    name: rempli(form.agencyName),
    legalId: rempli(form.siretOrId),
    address: rempli(form.address),
    phone: rempli(form.phone),
    legalNotice: rempli(form.legalNotice),
    bank: rempli(form.iban),
    logo: Boolean(logoUrl),
    stamp: Boolean(stampUrl),
  };
  const elements = (Object.keys(faits) as ElementProfil[]).map((cle) => ({ cle, fait: faits[cle], ancre: ANCRE_PROFIL[cle] }));
  const nombreFaits = elements.filter((e) => e.fait).length;
  return { elements, faits: nombreFaits, total: elements.length, manquants: elements.filter((e) => !e.fait), complet: nombreFaits === elements.length };
}

/** Indications (jamais bloquantes) sur la saisie bancaire : la clé de l'IBAN et le gabarit du BIC. */
export function avertissementsBancaires(iban: string, bic: string): { iban: boolean; bic: boolean } {
  return { iban: rempli(iban) && !ibanValide(iban), bic: rempli(bic) && !bicValide(bic) };
}

/** Vrai quand le formulaire diffère de l'état enregistré (la comparaison se fait champ par champ). */
export function formulaireModifie<T extends Record<string, string | boolean>>(actuel: T, enregistre: T): boolean {
  return (Object.keys(actuel) as Array<keyof T>).some((cle) => actuel[cle] !== enregistre[cle]);
}

// ───────────────────────────── Abonnement ─────────────────────────────

export interface PaiementAbonnement {
  plan: string;
  amount: number;
  currency: string;
  billingCycle: string;
  status: string;
  paymentMethod: string;
  paymentRef?: string;
  createdAt: string;
  endDate?: string;
}

export interface SyntheseHistorique {
  paiements: number;
  /** Total réglé par devise (un abonnement réglé en francs CFA ne s'additionne jamais à un autre en euros). */
  totaux: Array<{ devise: string; montant: number }>;
  /** Date ISO du paiement le plus récent, ou null sans historique. */
  dernier: string | null;
}

export function syntheseHistorique(historique: PaiementAbonnement[]): SyntheseHistorique {
  const parDevise = new Map<string, number>();
  let dernier: string | null = null;
  for (const p of historique) {
    parDevise.set(p.currency, (parDevise.get(p.currency) ?? 0) + p.amount);
    if (!dernier || new Date(p.createdAt).getTime() > new Date(dernier).getTime()) dernier = p.createdAt;
  }
  return {
    paiements: historique.length,
    totaux: [...parDevise].map(([devise, montant]) => ({ devise, montant })),
    dernier,
  };
}

export function csvHistoriqueAbonnement(
  historique: PaiementAbonnement[],
  libelles: { date: string; plan: string; cycle: string; amount: string; currency: string; method: string; reference: string; status: string; start?: string },
  formaterDate: (iso: string) => string
): string {
  const sortie = [ligne([libelles.date, libelles.plan, libelles.cycle, libelles.amount, libelles.currency, libelles.method, libelles.reference, libelles.status])];
  for (const p of historique) {
    sortie.push(ligne([formaterDate(p.createdAt), p.plan, p.billingCycle, csvMontant(p.amount), p.currency, p.paymentMethod, p.paymentRef ?? "", p.status]));
  }
  return CSV_BOM + sortie.join("\n");
}

/** Économie annuelle d'une formule facturée à l'année plutôt qu'au mois (0 quand l'annuel ne rapporte rien). */
export function economieAnnuelle(plan: { monthlyPrice: number; annualPrice: number }): number {
  return Math.max(0, Math.round(plan.monthlyPrice * 12 - plan.annualPrice));
}

interface FormuleCapacite {
  id: string;
  monthlyPrice: number;
  maxProperties: string | number;
}

const capacite = (p: FormuleCapacite): number => (typeof p.maxProperties === "number" ? p.maxProperties : Number.isFinite(Number(p.maxProperties)) ? Number(p.maxProperties) : Infinity);

/**
 * La formule à proposer quand le parc approche (80 %) ou dépasse le plafond de la formule actuelle : la moins chère
 * des formules plus chères que la courante qui loge tout le parc avec de la marge. Aucune proposition sans plafond ni
 * quand le parc est loin de la limite.
 */
export function formuleSuperieure<P extends FormuleCapacite>(plans: P[], courante: string | undefined, usage: { count: number; max: number | null } | null): P | null {
  if (!usage || usage.max === null || usage.max <= 0 || usage.count < Math.ceil(usage.max * 0.8)) return null;
  const actuelle = plans.find((p) => p.id === courante);
  const candidates = plans
    .filter((p) => p.id !== courante && (!actuelle || p.monthlyPrice > actuelle.monthlyPrice) && capacite(p) > Math.max(usage.count, usage.max))
    .sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  return candidates[0] ?? null;
}

// ───────────────────────────── Parrainage ─────────────────────────────

/** Message prêt à envoyer à un confrère : l'accroche, puis le lien (qui porte déjà le code). */
export function messageParrainage(texte: string, url: string): string {
  return `${texte} ${url}`.trim();
}

export function lienWhatsappParrainage(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function lienMailParrainage(sujet: string, message: string): string {
  return `mailto:?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(message)}`;
}

/** Combien de filleuls peuvent encore prolonger l'accès, et combien de jours cela représente. */
export function placesRestantes(info: { rewardedReferrals: number; maxRewardedReferrals: number; rewardDays: number }) {
  const places = Math.max(0, info.maxRewardedReferrals - info.rewardedReferrals);
  return { places, jours: places * info.rewardDays };
}

// ───────────────────────────── Import ─────────────────────────────

export type StatutLigneImport = "OK" | "DOUBLON" | "ERREUR";
export type FiltreImport = "all" | StatutLigneImport;

export function filtrerLignesImport<T extends { statut: StatutLigneImport }>(lignes: T[], filtre: FiltreImport): T[] {
  return filtre === "all" ? lignes : lignes.filter((l) => l.statut === filtre);
}

/** Rapport des lignes à corriger (doublons et erreurs), à rouvrir dans le tableur : numéro de ligne, statut, contenu, motifs. */
export function csvRapportImport(
  lignes: Array<{ ligne: number; statut: StatutLigneImport; messages: string[]; resume: string }>,
  libelles: { line: string; status: string; data: string; reason: string; statuts: Record<StatutLigneImport, string> }
): string {
  const sortie = [ligne([libelles.line, libelles.status, libelles.data, libelles.reason])];
  for (const l of lignes.filter((x) => x.statut !== "OK")) sortie.push(ligne([l.ligne, libelles.statuts[l.statut], l.resume, l.messages.join(" | ")]));
  return CSV_BOM + sortie.join("\n");
}

// ───────────────────────────── Guide de démarrage ─────────────────────────────

/** Étapes cochées lues du stockage local : un contenu illisible ou étranger donne une liste vide, jamais une erreur. */
export function lireEtapesFaites(brut: string | null, valides: readonly string[]): string[] {
  if (!brut) return [];
  try {
    const lu: unknown = JSON.parse(brut);
    return Array.isArray(lu) ? lu.filter((c): c is string => typeof c === "string" && valides.includes(c)) : [];
  } catch {
    return [];
  }
}

export function basculerEtape(faites: string[], cle: string): string[] {
  return faites.includes(cle) ? faites.filter((c) => c !== cle) : [...faites, cle];
}

/** Première étape (dans l'ordre du guide) qui n'est pas cochée : celle à proposer maintenant. */
export function prochaineEtape(ordre: readonly string[], faites: string[]): string | null {
  return ordre.find((c) => !faites.includes(c)) ?? null;
}
