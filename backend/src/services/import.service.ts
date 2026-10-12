import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { properties, tenants } from "../db/schema";
import { DEVISES } from "../utils/devises";
import { type CsvLu, lireNombre } from "../utils/csvImport";
import { estCiviliteConnue } from "../utils/nom";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";

/**
 * Import CSV de biens et de locataires (migration depuis un tableur).
 *
 * Deux temps, et c'est voulu : `analyser…` lit le fichier, vérifie CHAQUE ligne
 * avec les règles de la création à la main, repère les doublons et le plafond de
 * la formule, sans rien écrire ; `importer…` rejoue la même analyse (jamais ce
 * que le navigateur affirme avoir validé) puis n'écrit que les lignes valides.
 * Une ligne en erreur ou en doublon n'empêche pas les autres, et un fichier
 * importé deux fois ne crée rien la seconde fois.
 */
export type TypeImport = "properties" | "tenants";
export type StatutLigne = "OK" | "DOUBLON" | "ERREUR";

export interface LigneAnalysee<D> {
  ligne: number;
  statut: StatutLigne;
  messages: string[];
  /** Valeurs lues (affichées à l'aperçu) ; absentes pour une ligne illisible. */
  donnees: D;
}

export interface Analyse<D> {
  type: TypeImport;
  delimiteur: string;
  lignes: Array<LigneAnalysee<D>>;
  resume: { total: number; valides: number; doublons: number; erreurs: number };
  /** Biens : places restantes dans la formule (null = illimité). */
  capacite?: { maximum: number | null; existants: number; restant: number | null };
}

export class ImportInvalide extends Error {}

/** Colonnes acceptées par champ : en-têtes normalisés (voir normaliserEntete). */
const COLONNES_BIENS = {
  title: ["titre", "title", "nom", "bien", "intitule", "designation"],
  address: ["adresse", "address"],
  surface: ["surface", "superficie", "m2", "surfacem2"],
  rent: ["loyer", "rent", "loyermensuel", "loyerhorscharges"],
  currency: ["devise", "currency", "monnaie"],
  status: ["statut", "status", "etat"],
  description: ["description", "commentaire", "notes"],
} as const;

const COLONNES_LOCATAIRES = {
  civility: ["civilite", "civility", "titre"],
  firstName: ["prenom", "firstname", "prenoms"],
  lastName: ["nom", "lastname", "nomdefamille"],
  phone: ["telephone", "tel", "phone", "mobile", "portable"],
  email: ["email", "courriel", "mail", "adresseemail"],
} as const;

export const COLONNES_OBLIGATOIRES = {
  properties: ["title", "address", "surface", "rent"],
  tenants: ["firstName", "lastName", "phone", "email"],
} as const;

/** Modèles proposés au téléchargement : les noms d'en-tête canoniques, une ligne d'exemple. */
export const MODELES_CSV: Record<TypeImport, string> = {
  properties: "titre;adresse;surface;loyer;devise;statut;description\nStudio Centre-ville;12 rue des Écoles, Dakar;28;250000;XOF;DISPONIBLE;Studio meublé au 2e étage\n",
  tenants: "civilite;prenom;nom;telephone;email\nM;Moussa;Diop;+221 77 123 45 67;moussa.diop@example.com\n",
};

function lire<C extends Record<string, readonly string[]>>(valeurs: Record<string, string>, colonnes: C, champ: keyof C): string {
  for (const nom of colonnes[champ]) {
    if (valeurs[nom] !== undefined && valeurs[nom] !== "") return valeurs[nom];
  }
  return "";
}

/** Colonnes obligatoires absentes du FICHIER (et non d'une ligne) : on refuse tout de suite, avec les noms acceptés. */
function verifierEntetes<C extends Record<string, readonly string[]>>(csv: CsvLu, colonnes: C, obligatoires: readonly (keyof C)[]) {
  const manquantes = obligatoires.filter((champ) => !colonnes[champ].some((nom) => csv.entetes.includes(nom)));
  if (manquantes.length > 0) {
    throw new ImportInvalide(
      "Colonnes manquantes : " +
        manquantes.map((champ) => `« ${String(colonnes[champ][0])} » (ou ${colonnes[champ].slice(1, 3).join(", ")})`).join(" ; ") +
        ". Téléchargez le modèle pour voir l'en-tête attendu."
    );
  }
}

const cleDoublon = (...parties: string[]) => parties.map((p) => p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()).join("|");

// --- Biens ---------------------------------------------------------------------------------------------------------

export interface DonneesBien {
  title: string;
  address: string;
  surface: number | null;
  rent: number | null;
  currency: string;
  status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE";
  description: string;
}

const STATUTS_BIEN: Record<string, DonneesBien["status"]> = {
  AVAILABLE: "AVAILABLE", DISPONIBLE: "AVAILABLE", LIBRE: "AVAILABLE", VACANT: "AVAILABLE",
  OCCUPIED: "OCCUPIED", OCCUPE: "OCCUPIED", LOUE: "OCCUPIED",
  MAINTENANCE: "MAINTENANCE", ENTRETIEN: "MAINTENANCE", TRAVAUX: "MAINTENANCE",
};

export async function analyserBiens(
  managerId: string,
  csv: CsvLu,
  options: { deviseParDefaut: string; maximumBiens: number | null }
): Promise<Analyse<DonneesBien>> {
  verifierEntetes(csv, COLONNES_BIENS, COLONNES_OBLIGATOIRES.properties);

  const existants = await db.select({ title: properties.title, address: properties.address }).from(properties).where(eq(properties.managerId, managerId));
  const dejaVus = new Set(existants.map((p: { title: string; address: string }) => cleDoublon(p.title, p.address)));
  let places = options.maximumBiens === null ? Infinity : Math.max(0, options.maximumBiens - existants.length);

  const lignes: Array<LigneAnalysee<DonneesBien>> = csv.lignes.map(({ ligne, valeurs }) => {
    const messages: string[] = [];
    const title = lire(valeurs, COLONNES_BIENS, "title");
    const address = lire(valeurs, COLONNES_BIENS, "address");
    const surfaceBrute = lire(valeurs, COLONNES_BIENS, "surface");
    const loyerBrut = lire(valeurs, COLONNES_BIENS, "rent");
    const deviseBrute = lire(valeurs, COLONNES_BIENS, "currency").toUpperCase();
    const statutBrut = lire(valeurs, COLONNES_BIENS, "status");

    if (title.length < 2) messages.push("Titre manquant ou trop court (2 caractères minimum).");
    if (address.length < 2) messages.push("Adresse manquante ou trop courte (2 caractères minimum).");

    const surface = surfaceBrute ? lireNombre(surfaceBrute) : null;
    if (surface === null || surface <= 0) messages.push(surfaceBrute ? `Surface invalide : « ${surfaceBrute} ».` : "Surface manquante.");
    const rent = loyerBrut ? lireNombre(loyerBrut) : null;
    if (rent === null || rent <= 0) messages.push(loyerBrut ? `Loyer invalide : « ${loyerBrut} ».` : "Loyer manquant.");

    let currency = options.deviseParDefaut;
    if (deviseBrute) {
      if (DEVISES[deviseBrute]) currency = deviseBrute;
      else messages.push(`Devise inconnue : « ${deviseBrute} ».`);
    }

    let status: DonneesBien["status"] = "AVAILABLE";
    if (statutBrut) {
      const connu = STATUTS_BIEN[statutBrut.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()];
      if (connu) status = connu;
      else messages.push(`Statut inconnu : « ${statutBrut} » (disponible, occupé ou maintenance).`);
    }

    const donnees: DonneesBien = { title, address, surface, rent, currency, status, description: lire(valeurs, COLONNES_BIENS, "description") };
    if (messages.length > 0) return { ligne, statut: "ERREUR", messages, donnees };

    const cle = cleDoublon(title, address);
    if (dejaVus.has(cle)) {
      return { ligne, statut: "DOUBLON", messages: ["Un bien avec ce titre et cette adresse existe déjà (ou figure plus haut dans le fichier)."], donnees };
    }
    if (places <= 0) {
      return {
        ligne,
        statut: "ERREUR",
        messages: [`Limite de ${options.maximumBiens} biens atteinte pour votre formule : passez à une formule supérieure pour importer ce bien.`],
        donnees,
      };
    }
    dejaVus.add(cle);
    places--;
    return { ligne, statut: "OK", messages: [], donnees };
  });

  return {
    type: "properties",
    delimiteur: csv.delimiteur,
    lignes,
    resume: resumer(lignes),
    capacite: {
      maximum: options.maximumBiens,
      existants: existants.length,
      restant: options.maximumBiens === null ? null : Math.max(0, options.maximumBiens - existants.length),
    },
  };
}

// --- Locataires ----------------------------------------------------------------------------------------------------

export interface DonneesLocataire {
  civility: "M" | "MME" | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

const CIVILITES_ACCEPTEES: Record<string, "M" | "MME"> = {
  M: "M", MR: "M", MONSIEUR: "M", MME: "MME", MADAME: "MME", MRS: "MME", MS: "MME",
};

export async function analyserLocataires(managerId: string, csv: CsvLu): Promise<Analyse<DonneesLocataire>> {
  verifierEntetes(csv, COLONNES_LOCATAIRES, COLONNES_OBLIGATOIRES.tenants);

  const existants = await db.select({ email: tenants.email }).from(tenants).where(eq(tenants.managerId, managerId));
  const dejaVus = new Set(existants.map((t: { email: string }) => t.email.toLowerCase()));

  const lignes: Array<LigneAnalysee<DonneesLocataire>> = csv.lignes.map(({ ligne, valeurs }) => {
    const messages: string[] = [];
    const firstName = lire(valeurs, COLONNES_LOCATAIRES, "firstName");
    const lastName = lire(valeurs, COLONNES_LOCATAIRES, "lastName");
    const telephoneBrut = lire(valeurs, COLONNES_LOCATAIRES, "phone");
    const email = lire(valeurs, COLONNES_LOCATAIRES, "email").toLowerCase();
    const civiliteBrute = lire(valeurs, COLONNES_LOCATAIRES, "civility");

    if (!firstName) messages.push("Prénom manquant.");
    if (!lastName) messages.push("Nom manquant.");
    // Même règle qu'à la création : adresse valide ; les doubles points ou espaces la rendent illisible pour l'envoi.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) messages.push(email ? `Adresse email invalide : « ${email} ».` : "Adresse email manquante.");

    const phone = telephoneBrut ? versE164(telephoneBrut) : null;
    if (!phone) messages.push(telephoneBrut ? MESSAGE_TELEPHONE_INVALIDE : "Numéro de téléphone manquant.");

    let civility: DonneesLocataire["civility"] = null;
    if (civiliteBrute) {
      const cle = civiliteBrute.replace(/\./g, "").toUpperCase();
      civility = CIVILITES_ACCEPTEES[cle] ?? null;
      if (!civility && !estCiviliteConnue(cle)) messages.push(`Civilité inconnue : « ${civiliteBrute} » (M ou Mme).`);
    }

    const donnees: DonneesLocataire = { civility, firstName, lastName, phone: phone ?? telephoneBrut, email };
    if (messages.length > 0) return { ligne, statut: "ERREUR", messages, donnees };

    if (dejaVus.has(email)) {
      return { ligne, statut: "DOUBLON", messages: ["Un locataire avec cet email existe déjà (ou figure plus haut dans le fichier)."], donnees };
    }
    dejaVus.add(email);
    return { ligne, statut: "OK", messages: [], donnees };
  });

  return { type: "tenants", delimiteur: csv.delimiteur, lignes, resume: resumer(lignes) };
}

function resumer(lignes: Array<{ statut: StatutLigne }>) {
  return {
    total: lignes.length,
    valides: lignes.filter((l) => l.statut === "OK").length,
    doublons: lignes.filter((l) => l.statut === "DOUBLON").length,
    erreurs: lignes.filter((l) => l.statut === "ERREUR").length,
  };
}

// --- Écriture ------------------------------------------------------------------------------------------------------

/** Insère les lignes valides d'une analyse, en une transaction : tout est écrit, ou rien. Renvoie le nombre de lignes écrites. */
export async function importerBiens(managerId: string, analyse: Analyse<DonneesBien>): Promise<number> {
  const valides = analyse.lignes.filter((l) => l.statut === "OK");
  if (valides.length === 0) return 0;
  await db.transaction(async (tx) => {
    await tx.insert(properties).values(
      valides.map((l) => ({
        managerId,
        title: l.donnees.title,
        address: l.donnees.address,
        surface: l.donnees.surface!,
        rent: l.donnees.rent!,
        currency: l.donnees.currency,
        status: l.donnees.status,
        description: l.donnees.description || null,
      }))
    );
  });
  return valides.length;
}

export async function importerLocataires(managerId: string, analyse: Analyse<DonneesLocataire>): Promise<number> {
  const valides = analyse.lignes.filter((l) => l.statut === "OK");
  if (valides.length === 0) return 0;
  // onConflictDoNothing : l'index unique (agence, email) fait foi si une fiche a été créée entre
  // l'analyse et l'écriture (deuxième onglet, import simultané) — la ligne est alors ignorée, pas fatale.
  const ecrites = await db
    .insert(tenants)
    .values(
      valides.map((l) => ({
        managerId,
        civility: l.donnees.civility,
        firstName: l.donnees.firstName,
        lastName: l.donnees.lastName,
        phone: l.donnees.phone,
        email: l.donnees.email,
      }))
    )
    .onConflictDoNothing()
    .returning({ id: tenants.id });
  return ecrites.length;
}

/** Utilisé par les tests et le contrôleur : nombre de biens de l'agence. */
export async function compterBiens(managerId: string): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(properties).where(and(eq(properties.managerId, managerId)));
  return count;
}
