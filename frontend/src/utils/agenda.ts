import type { EvenementAgenda, TypeEvenementAgenda } from "../types";
import { correspond } from "./recherche";

export const TYPES_AGENDA: readonly TypeEvenementAgenda[] = ["RENT_DUE", "LEASE_END", "EXIT", "RENT_REVISION", "INSURANCE_EXPIRY"];

/** Écran où l'on traite chaque type d'échéance. */
export const LIEN_AGENDA: Record<TypeEvenementAgenda, string> = {
  RENT_DUE: "/invoices",
  LEASE_END: "/contracts",
  EXIT: "/contracts",
  RENT_REVISION: "/contracts",
  INSURANCE_EXPIRY: "/assurances",
};

export interface JourAgenda {
  /** Jour de calendrier « AAAA-MM-JJ » (les dates sont enregistrées à minuit UTC). */
  jour: string;
  evenements: EvenementAgenda[];
}
export interface MoisAgenda {
  /** « AAAA-MM ». */
  mois: string;
  jours: JourAgenda[];
}
export interface AgendaGroupe {
  enRetard: EvenementAgenda[];
  parMois: MoisAgenda[];
  total: number;
}

export const jourDe = (e: Pick<EvenementAgenda, "date">) => new Date(e.date).toISOString().slice(0, 10);

/** Effectif de chaque type, sur la liste déjà filtrée par la recherche (pour les onglets de filtre). */
export function comptesParType(evenements: EvenementAgenda[], recherche: string): Record<TypeEvenementAgenda, number> {
  const comptes = Object.fromEntries(TYPES_AGENDA.map((t) => [t, 0])) as Record<TypeEvenementAgenda, number>;
  for (const e of evenements) if (correspond(recherche, e.propertyTitle, e.tenantName ?? "", e.label ?? "")) comptes[e.type] += 1;
  return comptes;
}

/**
 * Range les échéances pour l'affichage : ce qui est en retard d'abord (du plus ancien au plus récent), puis les
 * échéances à venir par mois et par jour. L'ordre d'entrée (déjà trié par le serveur) est conservé dans chaque jour.
 */
export function grouperAgenda(evenements: EvenementAgenda[], filtre: "all" | TypeEvenementAgenda, recherche: string): AgendaGroupe {
  const gardes = evenements.filter((e) => (filtre === "all" || e.type === filtre) && correspond(recherche, e.propertyTitle, e.tenantName ?? "", e.label ?? ""));
  const enRetard = gardes.filter((e) => e.enRetard).sort((a, b) => a.date.localeCompare(b.date));
  const mois = new Map<string, Map<string, EvenementAgenda[]>>();
  for (const e of gardes.filter((x) => !x.enRetard).sort((a, b) => a.date.localeCompare(b.date))) {
    const jour = jourDe(e);
    const cle = jour.slice(0, 7);
    if (!mois.has(cle)) mois.set(cle, new Map());
    const jours = mois.get(cle)!;
    jours.set(jour, [...(jours.get(jour) ?? []), e]);
  }
  return {
    enRetard,
    parMois: [...mois.entries()].map(([m, jours]) => ({ mois: m, jours: [...jours.entries()].map(([jour, evts]) => ({ jour, evenements: evts })) })),
    total: gardes.length,
  };
}
