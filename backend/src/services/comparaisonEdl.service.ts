/**
 * Comparaison d'un état des lieux de sortie avec celui d'entrée : pièce par pièce, compteurs, clés.
 *
 * Fonction pure (aucun accès base) : elle ne fait que mettre en regard deux constats déjà finalisés et
 * dire ce qui a changé. Elle ne chiffre rien : évaluer une retenue sur le dépôt reste une décision du
 * gestionnaire (usure normale, vétusté, devis), saisie ensuite dans le solde de tout compte.
 */

export type EtatPiece = "BON" | "MOYEN" | "MAUVAIS";
export type VariationPiece = "INCHANGE" | "DEGRADE" | "AMELIORE" | "AJOUTEE" | "SUPPRIMEE";

export interface PieceEdl {
  name: string;
  condition: EtatPiece;
  notes?: string;
}
export interface CompteursEdl {
  electricity?: string;
  water?: string;
  gas?: string;
}
export interface CleEdl {
  label: string;
  quantity: number;
}
export interface ConstatEdl {
  rooms: PieceEdl[];
  meters: CompteursEdl;
  keys: CleEdl[];
}

export interface LignePiece {
  name: string;
  variation: VariationPiece;
  entry: { condition: EtatPiece; notes: string } | null;
  exit: { condition: EtatPiece; notes: string } | null;
}
export interface LigneCompteur {
  type: "electricity" | "water" | "gas";
  entry: string;
  exit: string;
  /** Consommation entre les deux relevés ; null si l'un des deux n'est pas un nombre exploitable. */
  consumption: number | null;
}
export interface LigneCle {
  label: string;
  entry: number;
  exit: number;
  /** Clés manquantes à la sortie (jamais négatif) ; 0 si le compte y est ou s'il y en a plus. */
  missing: number;
}
export interface ComparaisonEdl {
  rooms: LignePiece[];
  meters: LigneCompteur[];
  keys: LigneCle[];
  summary: {
    degraded: number;
    improved: number;
    unchanged: number;
    added: number;
    removed: number;
    missingKeys: number;
  };
}

const RANG: Record<EtatPiece, number> = { BON: 0, MOYEN: 1, MAUVAIS: 2 };

/** « Séjour », « sejour » et « SEJOUR  » désignent la même pièce : on compare sans accents ni casse. */
export function normaliserNom(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Relevé de compteur saisi à la main : « 12 345,6 », « 12345.6 », « 004521 kWh »… On garde le premier
 * nombre, virgule ou point décimal, espaces de milliers ignorés. Rien d'exploitable → null.
 */
export function lireReleve(texte: string | undefined): number | null {
  if (!texte) return null;
  const nettoye = texte.replace(/[\s  ]/g, "").replace(",", ".");
  const m = nettoye.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Deux pièces portant le même nom (« Chambre » ×2) se correspondent dans l'ordre de leur saisie : la
 * première d'entrée avec la première de sortie, etc.
 */
function indexerParNom<T extends { name?: string; label?: string }>(elements: T[], nom: (e: T) => string): Map<string, T> {
  const vus = new Map<string, number>();
  const index = new Map<string, T>();
  for (const e of elements) {
    const base = normaliserNom(nom(e));
    const rang = vus.get(base) ?? 0;
    vus.set(base, rang + 1);
    index.set(`${base}#${rang}`, e);
  }
  return index;
}

export function comparerEtatsDesLieux(entree: ConstatEdl, sortie: ConstatEdl): ComparaisonEdl {
  // ── Pièces ──
  const piecesEntree = indexerParNom(entree.rooms, (r) => r.name);
  const piecesSortie = indexerParNom(sortie.rooms, (r) => r.name);
  const rooms: LignePiece[] = [];

  for (const [cle, e] of piecesEntree) {
    const s = piecesSortie.get(cle);
    const ligneEntree = { condition: e.condition, notes: e.notes ?? "" };
    if (!s) {
      rooms.push({ name: e.name, variation: "SUPPRIMEE", entry: ligneEntree, exit: null });
      continue;
    }
    const ligneSortie = { condition: s.condition, notes: s.notes ?? "" };
    const ecart = RANG[s.condition] - RANG[e.condition];
    rooms.push({
      name: e.name,
      variation: ecart > 0 ? "DEGRADE" : ecart < 0 ? "AMELIORE" : "INCHANGE",
      entry: ligneEntree,
      exit: ligneSortie,
    });
  }
  for (const [cle, s] of piecesSortie) {
    if (!piecesEntree.has(cle)) {
      rooms.push({ name: s.name, variation: "AJOUTEE", entry: null, exit: { condition: s.condition, notes: s.notes ?? "" } });
    }
  }
  // Ce qui s'est dégradé d'abord : c'est ce que le gestionnaire doit regarder en premier.
  const ordre: Record<VariationPiece, number> = { DEGRADE: 0, SUPPRIMEE: 1, AJOUTEE: 2, AMELIORE: 3, INCHANGE: 4 };
  rooms.sort((a, b) => ordre[a.variation] - ordre[b.variation]);

  // ── Compteurs ──
  const types = ["electricity", "water", "gas"] as const;
  const meters: LigneCompteur[] = [];
  for (const type of types) {
    const e = (entree.meters[type] ?? "").trim();
    const s = (sortie.meters[type] ?? "").trim();
    if (!e && !s) continue;
    const ne = lireReleve(e);
    const ns = lireReleve(s);
    meters.push({ type, entry: e, exit: s, consumption: ne !== null && ns !== null ? Math.round((ns - ne) * 1000) / 1000 : null });
  }

  // ── Clés ──
  const clesEntree = indexerParNom(entree.keys, (k) => k.label);
  const clesSortie = indexerParNom(sortie.keys, (k) => k.label);
  const keys: LigneCle[] = [];
  for (const [cle, e] of clesEntree) {
    const s = clesSortie.get(cle);
    const rendues = s ? s.quantity : 0;
    keys.push({ label: e.label, entry: e.quantity, exit: rendues, missing: Math.max(0, e.quantity - rendues) });
  }
  for (const [cle, s] of clesSortie) {
    if (!clesEntree.has(cle)) keys.push({ label: s.label, entry: 0, exit: s.quantity, missing: 0 });
  }
  keys.sort((a, b) => b.missing - a.missing);

  const compte = (v: VariationPiece) => rooms.filter((r) => r.variation === v).length;
  return {
    rooms,
    meters,
    keys,
    summary: {
      degraded: compte("DEGRADE"),
      improved: compte("AMELIORE"),
      unchanged: compte("INCHANGE"),
      added: compte("AJOUTEE"),
      removed: compte("SUPPRIMEE"),
      missingKeys: keys.reduce((total, k) => total + k.missing, 0),
    },
  };
}
