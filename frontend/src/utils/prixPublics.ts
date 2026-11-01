import { PLAFOND_BIENS, type IdFormule } from "../data/lignesFormules";

export type DevisePublique = "EUR" | "XOF";
export type CycleFacturation = "MONTHLY" | "ANNUAL";
export interface TarifFormule {
  monthly: number;
  annual: number;
}
export type Tarifs = Record<IdFormule, TarifFormule>;

const FORMULES: IdFormule[] = ["STARTER", "PRO", "ENTERPRISE"];

/**
 * Lit la réponse de GET /api/subscription/plans (route publique) : un tableau de formules avec leurs prix mensuel et
 * annuel dans la devise demandée. Toute réponse incomplète ou mal formée donne `null` : l'accueil garde alors ses
 * prix affichés par défaut plutôt que d'inventer un chiffre.
 */
export function lireTarifs(donnees: unknown): Tarifs | null {
  if (!Array.isArray(donnees)) return null;
  const tarifs: Partial<Tarifs> = {};
  for (const id of FORMULES) {
    const formule = donnees.find((f): f is { id: string; monthlyPrice: unknown; annualPrice: unknown } => typeof f === "object" && f !== null && (f as { id?: unknown }).id === id);
    if (!formule || typeof formule.monthlyPrice !== "number" || typeof formule.annualPrice !== "number") return null;
    if (formule.monthlyPrice <= 0 || formule.annualPrice <= 0) return null;
    tarifs[id] = { monthly: formule.monthlyPrice, annual: formule.annualPrice };
  }
  return tarifs as Tarifs;
}

/** Part économisée en payant à l'année plutôt que douze mois, en pourcentage entier (0 si l'annuel ne coûte pas moins). */
export function economieAnnuelle(tarif: TarifFormule): number {
  const douzeMois = tarif.monthly * 12;
  if (douzeMois <= 0 || tarif.annual >= douzeMois) return 0;
  return Math.round((1 - tarif.annual / douzeMois) * 100);
}

/** Montant lisible avec le symbole de la devise (« 29 € », « 15 000 FCFA ») : jamais de décimales sur des prix entiers. */
export function formaterPrix(montant: number, devise: DevisePublique, langue: string): string {
  const nombre = new Intl.NumberFormat(langue, { maximumFractionDigits: Number.isInteger(montant) ? 0 : 2 }).format(montant);
  return devise === "XOF" ? `${nombre} FCFA` : `${nombre} €`;
}

/** La plus petite formule dont le plafond de biens couvre le parc du visiteur. */
export function formuleConseillee(nombreDeBiens: number): IdFormule {
  for (const id of FORMULES) {
    const plafond = PLAFOND_BIENS[id];
    if (plafond === null || nombreDeBiens <= plafond) return id;
  }
  return "ENTERPRISE";
}
