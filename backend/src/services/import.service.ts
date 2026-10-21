import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { contracts, properties, tenants } from "../db/schema";
import { DEVISES } from "../utils/devises";
import { type CsvLu, lireDate, lireNombre } from "../utils/csvImport";
import { dateDeBailPlausible, debutDeLaJournee } from "../utils/dates";
import { MONTANT_MAXIMUM, SURFACE_MAXIMUM } from "../utils/montant";
import { echeanceDuMois, jourEcheanceDuContrat } from "../utils/jourEcheance";
import { estCiviliteConnue } from "../utils/nom";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";
import { TYPES_BAIL } from "../utils/typeBail";
import { generateInvoicesForContract } from "./invoice.service";

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
export type TypeImport = "properties" | "tenants" | "contracts";
export type StatutLigne = "OK" | "DOUBLON" | "ERREUR";

/** Ce que l'interface traduit à la place d'un message : un code (`common.serverErrors.<CODE>`) et ses valeurs. */
export interface DetailMessage {
  code: string;
  params?: Record<string, string | number>;
}

/**
 * Messages d'une ligne : le texte français (conservé pour tout lecteur qui ne traduit pas) ET, au même rang, le
 * code que l'interface traduit dans la langue choisie.
 */
class MessagesLigne {
  private textes: string[] = [];
  private details: DetailMessage[] = [];

  push(texte: string, code: string, params?: Record<string, string | number>) {
    this.textes.push(texte);
    this.details.push(params ? { code, params } : { code });
  }

  get length() {
    return this.textes.length;
  }

  /** `{ messages, details }`, à étaler dans la ligne analysée. */
  enBloc() {
    return { messages: this.textes, details: this.details };
  }
}

/** Ligne qui ne porte qu'un seul message (doublon, plafond atteint, chevauchement). */
function unMessage(texte: string, code: string, params?: Record<string, string | number>) {
  const m = new MessagesLigne();
  m.push(texte, code, params);
  return m.enBloc();
}

export interface LigneAnalysee<D> {
  ligne: number;
  statut: StatutLigne;
  messages: string[];
  /** Même rang que `messages` : le code (et ses valeurs) que l'interface traduit. */
  details: DetailMessage[];
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

export class ImportInvalide extends Error {
  /** Code que l'interface traduit (voir apiErrorMessage), avec les valeurs à insérer dans la traduction. */
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: Record<string, string | number>
  ) {
    super(message);
  }
}

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

const COLONNES_CONTRATS = {
  property: ["bien", "titrebien", "titre", "property", "logement"],
  propertyAddress: ["adressebien", "adresse", "address"],
  tenantEmail: ["emaillocataire", "email", "courriel", "mail", "tenantemail"],
  rent: ["loyer", "rent", "loyermensuel"],
  deposit: ["depot", "depotdegarantie", "caution", "cautionnement", "deposit"],
  currency: ["devise", "currency", "monnaie"],
  startDate: ["debut", "datedebut", "datededebut", "startdate", "entree", "dateentree"],
  endDate: ["fin", "datefin", "datedefin", "enddate"],
  paymentDay: ["jourecheance", "jourdepaiement", "jourloyer", "paymentday"],
  leaseType: ["typedebail", "typebail", "type", "leasetype"],
  applicableLaw: ["droitapplicable", "droit", "applicablelaw"],
  status: ["statut", "status", "etat"],
  billingFrom: ["facturationdepuis", "facturerapartirde", "facturationapartirde", "billingfrom"],
} as const;

export const COLONNES_OBLIGATOIRES = {
  properties: ["title", "address", "surface", "rent"],
  tenants: ["firstName", "lastName", "phone", "email"],
  contracts: ["property", "tenantEmail", "rent", "deposit", "startDate", "endDate"],
} as const;

/** Modèles proposés au téléchargement : les noms d'en-tête canoniques, une ligne d'exemple. */
export const MODELES_CSV: Record<TypeImport, string> = {
  properties: "titre;adresse;surface;loyer;devise;statut;description\nStudio Centre-ville;12 rue des Écoles, Dakar;28;250000;XOF;DISPONIBLE;Studio meublé au 2e étage\n",
  tenants: "civilite;prenom;nom;telephone;email\nM;Moussa;Diop;+221 77 123 45 67;moussa.diop@example.com\n",
  contracts:
    "bien;email_locataire;loyer;depot;debut;fin;jour_echeance;type_de_bail;droit_applicable;statut;facturation_depuis\n" +
    "Studio Centre-ville;moussa.diop@example.com;250000;500000;01/03/2024;28/02/2026;5;habitation;Droit sénégalais;actif;01/11/2026\n",
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
    const colonnesTexte = manquantes.map((champ) => `« ${String(colonnes[champ][0])} » (ou ${colonnes[champ].slice(1, 3).join(", ")})`).join(" ; ");
    throw new ImportInvalide(
      `Colonnes manquantes : ${colonnesTexte}. Téléchargez le modèle pour voir l'en-tête attendu.`,
      "IMPORT_MISSING_COLUMNS",
      { columns: colonnesTexte }
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
    const messages = new MessagesLigne();
    const title = lire(valeurs, COLONNES_BIENS, "title");
    const address = lire(valeurs, COLONNES_BIENS, "address");
    const surfaceBrute = lire(valeurs, COLONNES_BIENS, "surface");
    const loyerBrut = lire(valeurs, COLONNES_BIENS, "rent");
    const deviseBrute = lire(valeurs, COLONNES_BIENS, "currency").toUpperCase();
    const statutBrut = lire(valeurs, COLONNES_BIENS, "status");

    if (title.length < 2) messages.push("Titre manquant ou trop court (2 caractères minimum).", "IMPORT_ROW_TITLE_SHORT");
    else if (title.length > 200) messages.push("Titre trop long (200 caractères maximum).", "IMPORT_ROW_TITLE_LONG");
    if (address.length < 2) messages.push("Adresse manquante ou trop courte (2 caractères minimum).", "IMPORT_ROW_ADDRESS_SHORT");
    else if (address.length > 300) messages.push("Adresse trop longue (300 caractères maximum).", "IMPORT_ROW_ADDRESS_LONG");
    const descriptionLue = lire(valeurs, COLONNES_BIENS, "description");
    if (descriptionLue.length > 5000) messages.push("Description trop longue (5 000 caractères maximum).", "IMPORT_ROW_DESCRIPTION_LONG");

    const surface = surfaceBrute ? lireNombre(surfaceBrute) : null;
    if (surface === null || surface <= 0 || surface > SURFACE_MAXIMUM) messages.push(surfaceBrute ? `Surface invalide : « ${surfaceBrute} ».` : "Surface manquante.", surfaceBrute ? "IMPORT_ROW_AREA_INVALID" : "IMPORT_ROW_AREA_MISSING", surfaceBrute ? { value: surfaceBrute } : undefined);
    const rent = loyerBrut ? lireNombre(loyerBrut) : null;
    if (rent === null || rent <= 0 || rent > MONTANT_MAXIMUM) messages.push(loyerBrut ? `Loyer invalide : « ${loyerBrut} ».` : "Loyer manquant.", loyerBrut ? "IMPORT_ROW_RENT_INVALID" : "IMPORT_ROW_RENT_MISSING", loyerBrut ? { value: loyerBrut } : undefined);

    let currency = options.deviseParDefaut;
    if (deviseBrute) {
      if (DEVISES[deviseBrute]) currency = deviseBrute;
      else messages.push(`Devise inconnue : « ${deviseBrute} ».`, "IMPORT_ROW_CURRENCY_UNKNOWN", { value: deviseBrute });
    }

    let status: DonneesBien["status"] = "AVAILABLE";
    if (statutBrut) {
      const connu = STATUTS_BIEN[statutBrut.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()];
      if (connu) status = connu;
      else messages.push(`Statut inconnu : « ${statutBrut} » (disponible, occupé ou maintenance).`, "IMPORT_ROW_PROPERTY_STATUS_UNKNOWN", { value: statutBrut });
    }

    const donnees: DonneesBien = { title, address, surface, rent, currency, status, description: descriptionLue };
    if (messages.length > 0) return { ligne, statut: "ERREUR", ...messages.enBloc(), donnees };

    const cle = cleDoublon(title, address);
    if (dejaVus.has(cle)) {
      return {
        ligne,
        statut: "DOUBLON",
        ...unMessage("Un bien avec ce titre et cette adresse existe déjà (ou figure plus haut dans le fichier).", "IMPORT_ROW_PROPERTY_DUPLICATE"),
        donnees,
      };
    }
    if (places <= 0) {
      return {
        ligne,
        statut: "ERREUR",
        ...unMessage(
          `Limite de ${options.maximumBiens} biens atteinte pour votre formule : passez à une formule supérieure pour importer ce bien.`,
          "IMPORT_ROW_PLAN_LIMIT",
          { max: options.maximumBiens ?? 0 }
        ),
        donnees,
      };
    }
    dejaVus.add(cle);
    places--;
    return { ligne, statut: "OK", messages: [], details: [], donnees };
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
    const messages = new MessagesLigne();
    const firstName = lire(valeurs, COLONNES_LOCATAIRES, "firstName");
    const lastName = lire(valeurs, COLONNES_LOCATAIRES, "lastName");
    const telephoneBrut = lire(valeurs, COLONNES_LOCATAIRES, "phone");
    const email = lire(valeurs, COLONNES_LOCATAIRES, "email").toLowerCase();
    const civiliteBrute = lire(valeurs, COLONNES_LOCATAIRES, "civility");

    if (!firstName) messages.push("Prénom manquant.", "IMPORT_ROW_FIRSTNAME_MISSING");
    else if (firstName.length > 100) messages.push("Prénom trop long (100 caractères maximum).", "IMPORT_ROW_FIRSTNAME_LONG");
    if (!lastName) messages.push("Nom manquant.", "IMPORT_ROW_LASTNAME_MISSING");
    else if (lastName.length > 100) messages.push("Nom trop long (100 caractères maximum).", "IMPORT_ROW_LASTNAME_LONG");
    // Même règle qu'à la création : adresse valide ; les doubles points ou espaces la rendent illisible pour l'envoi.
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) messages.push(email ? `Adresse email invalide : « ${email} ».` : "Adresse email manquante.", email ? "IMPORT_ROW_EMAIL_INVALID" : "IMPORT_ROW_EMAIL_MISSING", email ? { value: email } : undefined);

    const phone = telephoneBrut ? versE164(telephoneBrut) : null;
    if (!phone) messages.push(telephoneBrut ? MESSAGE_TELEPHONE_INVALIDE : "Numéro de téléphone manquant.", telephoneBrut ? "PHONE_INVALID" : "IMPORT_ROW_PHONE_MISSING");

    let civility: DonneesLocataire["civility"] = null;
    if (civiliteBrute) {
      const cle = civiliteBrute.replace(/\./g, "").toUpperCase();
      civility = CIVILITES_ACCEPTEES[cle] ?? null;
      if (!civility && !estCiviliteConnue(cle)) messages.push(`Civilité inconnue : « ${civiliteBrute} » (M ou Mme).`, "IMPORT_ROW_CIVILITY_UNKNOWN", { value: civiliteBrute });
    }

    const donnees: DonneesLocataire = { civility, firstName, lastName, phone: phone ?? telephoneBrut, email };
    if (messages.length > 0) return { ligne, statut: "ERREUR", ...messages.enBloc(), donnees };

    if (dejaVus.has(email)) {
      return { ligne, statut: "DOUBLON", ...unMessage("Un locataire avec cet email existe déjà (ou figure plus haut dans le fichier).", "IMPORT_ROW_TENANT_DUPLICATE"), donnees };
    }
    dejaVus.add(email);
    return { ligne, statut: "OK", messages: [], details: [], donnees };
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


// --- Contrats ------------------------------------------------------------------------------------------------------

export interface DonneesContrat {
  property: string;
  propertyId: string | null;
  tenantEmail: string;
  tenantId: string | null;
  rent: number | null;
  deposit: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  paymentDay: number | null;
  leaseType: (typeof TYPES_BAIL)[number];
  applicableLaw: string | null;
  status: "ACTIVE" | "ENDED" | "TERMINATED";
  /** Premier mois facturé par la plateforme (AAAA-MM-JJ) ; le passé reste hors facturation. */
  billingFrom: string | null;
  /** Mois de la toute première facture qui sera créée (MM/AAAA), pour l'aperçu. */
  premiereFacture: string | null;
}

const TYPES_BAIL_ACCEPTES: Record<string, (typeof TYPES_BAIL)[number]> = {
  HABITATION: "HABITATION", HABITATIONNEL: "HABITATION", LOGEMENT: "HABITATION", NU: "HABITATION",
  MEUBLE: "MEUBLE", MEUBLEE: "MEUBLE", HABITATIONMEUBLEE: "MEUBLE", HABITATIONMEUBLE: "MEUBLE",
  COMMERCIAL: "COMMERCIAL", COMMERCE: "COMMERCIAL",
  PROFESSIONNEL: "PROFESSIONNEL", PROFESSIONNELLE: "PROFESSIONNEL", BUREAU: "PROFESSIONNEL",
};

const STATUTS_CONTRAT: Record<string, DonneesContrat["status"]> = {
  ACTIVE: "ACTIVE", ACTIF: "ACTIVE", ENCOURS: "ACTIVE", EN_COURS: "ACTIVE",
  ENDED: "ENDED", TERMINE: "ENDED", ECHU: "ENDED", FINI: "ENDED",
  TERMINATED: "TERMINATED", RESILIE: "TERMINATED",
};

const sansAccents = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[\s'’-]+/g, "");
const jour = (d: Date) => d.toISOString().slice(0, 10);

export async function analyserContrats(managerId: string, csv: CsvLu, maintenant: Date = new Date()): Promise<Analyse<DonneesContrat>> {
  verifierEntetes(csv, COLONNES_CONTRATS, COLONNES_OBLIGATOIRES.contracts);

  const [biens, locataires, contratsExistants] = await Promise.all([
    db.select({ id: properties.id, title: properties.title, address: properties.address, currency: properties.currency }).from(properties).where(eq(properties.managerId, managerId)),
    db.select({ id: tenants.id, email: tenants.email }).from(tenants).where(eq(tenants.managerId, managerId)),
    db
      .select({ propertyId: contracts.propertyId, tenantId: contracts.tenantId, startDate: contracts.startDate, endDate: contracts.endDate, status: contracts.status })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(properties.managerId, managerId)),
  ]);
  const locataireParEmail = new Map<string, string>(locataires.map((t: { id: string; email: string }) => [t.email.toLowerCase(), t.id]));

  // Par défaut on ne facture que l'avenir : l'historique des loyers reste dans l'ancien outil. Le mois en cours
  // n'est facturé que si son échéance n'est pas déjà passée — sinon sa facture naîtrait « en retard » et le
  // locataire, peut-être à jour dans l'ancien outil, recevrait une relance. Le gestionnaire peut toujours
  // l'inclure avec la colonne « facturation_depuis ».
  const premierDuMois = (decalage: number) => new Date(Date.UTC(maintenant.getFullYear(), maintenant.getMonth() + decalage, 1));

  const vus: Array<{ propertyId: string; tenantId: string; start: Date; end: Date; actif: boolean }> = contratsExistants.map(
    (c: { propertyId: string; tenantId: string; startDate: Date; endDate: Date; status: string }) => ({
      propertyId: c.propertyId, tenantId: c.tenantId, start: new Date(c.startDate), end: new Date(c.endDate), actif: c.status === "ACTIVE",
    })
  );

  const lignes: Array<LigneAnalysee<DonneesContrat>> = csv.lignes.map(({ ligne, valeurs }) => {
    const messages = new MessagesLigne();
    const titre = lire(valeurs, COLONNES_CONTRATS, "property");
    const adresse = lire(valeurs, COLONNES_CONTRATS, "propertyAddress");
    const email = lire(valeurs, COLONNES_CONTRATS, "tenantEmail").toLowerCase();
    const loyerBrut = lire(valeurs, COLONNES_CONTRATS, "rent");
    const depotBrut = lire(valeurs, COLONNES_CONTRATS, "deposit");
    const deviseBrute = lire(valeurs, COLONNES_CONTRATS, "currency").toUpperCase();
    const debutBrut = lire(valeurs, COLONNES_CONTRATS, "startDate");
    const finBrute = lire(valeurs, COLONNES_CONTRATS, "endDate");
    const jourBrut = lire(valeurs, COLONNES_CONTRATS, "paymentDay");
    const typeBrut = lire(valeurs, COLONNES_CONTRATS, "leaseType");
    const droit = lire(valeurs, COLONNES_CONTRATS, "applicableLaw");
    const statutBrut = lire(valeurs, COLONNES_CONTRATS, "status");
    const facturationBrute = lire(valeurs, COLONNES_CONTRATS, "billingFrom");

    // Bien : par son titre ; l'adresse (si la colonne existe) départage deux biens de même titre.
    let bien: (typeof biens)[number] | undefined;
    if (!titre) messages.push("Bien manquant (titre du bien).", "IMPORT_ROW_PROPERTY_MISSING");
    else {
      let candidats = biens.filter((b: { title: string }) => cleDoublon(b.title) === cleDoublon(titre));
      if (candidats.length > 1 && adresse) candidats = candidats.filter((b: { address: string }) => cleDoublon(b.address) === cleDoublon(adresse));
      if (candidats.length === 0) messages.push(`Bien introuvable : « ${titre} ». Importez d'abord vos biens, avec ce titre exact.`, "IMPORT_ROW_PROPERTY_NOT_FOUND", { title: titre });
      else if (candidats.length > 1) messages.push(`Plusieurs biens portent le titre « ${titre} » : ajoutez une colonne « adresse_bien » pour les distinguer.`, "IMPORT_ROW_PROPERTY_AMBIGUOUS", { title: titre });
      else bien = candidats[0];
    }

    // Locataire : par son email, clé unique dans l'agence.
    let tenantId: string | undefined;
    if (!email) messages.push("Email du locataire manquant.", "IMPORT_ROW_TENANT_EMAIL_MISSING");
    else {
      tenantId = locataireParEmail.get(email);
      if (!tenantId) messages.push(`Locataire introuvable : « ${email} ». Importez d'abord vos locataires, avec cet email.`, "IMPORT_ROW_TENANT_NOT_FOUND", { email });
    }

    const rent = loyerBrut ? lireNombre(loyerBrut) : null;
    if (rent === null || rent <= 0 || rent > MONTANT_MAXIMUM) messages.push(loyerBrut ? `Loyer invalide : « ${loyerBrut} ».` : "Loyer manquant.", loyerBrut ? "IMPORT_ROW_RENT_INVALID" : "IMPORT_ROW_RENT_MISSING", loyerBrut ? { value: loyerBrut } : undefined);
    const deposit = depotBrut ? lireNombre(depotBrut) : null;
    if (deposit === null || deposit < 0 || deposit > MONTANT_MAXIMUM) messages.push(depotBrut ? `Dépôt de garantie invalide : « ${depotBrut} ».` : "Dépôt de garantie manquant (indiquez 0 s'il n'y en a pas).", depotBrut ? "IMPORT_ROW_DEPOSIT_INVALID" : "IMPORT_ROW_DEPOSIT_MISSING", depotBrut ? { value: depotBrut } : undefined);

    let currency = bien?.currency || "EUR";
    if (deviseBrute) {
      if (DEVISES[deviseBrute]) currency = deviseBrute;
      else messages.push(`Devise inconnue : « ${deviseBrute} ».`, "IMPORT_ROW_CURRENCY_UNKNOWN", { value: deviseBrute });
    }

    // Une date hors des années plausibles est traitée comme illisible (voir dateDeBailPlausible).
    const datePlausible = (brut: string) => {
      const d = lireDate(brut);
      return d && dateDeBailPlausible(d) ? d : null;
    };
    const debut = debutBrut ? datePlausible(debutBrut) : null;
    if (!debut) messages.push(debutBrut ? `Date de début invalide : « ${debutBrut} » (jj/mm/aaaa).` : "Date de début manquante.", debutBrut ? "IMPORT_ROW_START_INVALID" : "IMPORT_ROW_START_MISSING", debutBrut ? { value: debutBrut } : undefined);
    const fin = finBrute ? datePlausible(finBrute) : null;
    if (!fin) messages.push(finBrute ? `Date de fin invalide : « ${finBrute} » (jj/mm/aaaa).` : "Date de fin manquante.", finBrute ? "IMPORT_ROW_END_INVALID" : "IMPORT_ROW_END_MISSING", finBrute ? { value: finBrute } : undefined);
    if (debut && fin && fin <= debut) messages.push("La date de fin doit être postérieure à la date de début.", "IMPORT_ROW_END_BEFORE_START");

    let paymentDay: number | null = null;
    if (jourBrut) {
      const n = lireNombre(jourBrut);
      if (n !== null && Number.isInteger(n) && n >= 1 && n <= 31) paymentDay = n;
      else messages.push(`Jour d'échéance invalide : « ${jourBrut} » (1 à 31).`, "IMPORT_ROW_DUE_DAY_INVALID", { value: jourBrut });
    }

    let leaseType: DonneesContrat["leaseType"] = "HABITATION";
    if (typeBrut) {
      const connu = TYPES_BAIL_ACCEPTES[sansAccents(typeBrut)];
      if (connu) leaseType = connu;
      else messages.push(`Type de bail inconnu : « ${typeBrut} » (habitation, meublé, commercial ou professionnel).`, "IMPORT_ROW_LEASE_TYPE_UNKNOWN", { value: typeBrut });
    }

    if (droit.length > 300) messages.push("Le droit applicable ne peut pas dépasser 300 caractères.", "IMPORT_ROW_LAW_LONG");

    let status: DonneesContrat["status"] = "ACTIVE";
    if (statutBrut) {
      const connu = STATUTS_CONTRAT[sansAccents(statutBrut)];
      if (connu) status = connu;
      else messages.push(`Statut inconnu : « ${statutBrut} » (actif, terminé ou résilié).`, "IMPORT_ROW_CONTRACT_STATUS_UNKNOWN", { value: statutBrut });
    }

    const echeanceCourante = echeanceDuMois(
      jourEcheanceDuContrat({ paymentDay, startDate: debut ?? maintenant }),
      maintenant.getFullYear(),
      maintenant.getMonth() + 1
    );
    let facturation = echeanceCourante < debutDeLaJournee(maintenant) ? premierDuMois(1) : premierDuMois(0);
    if (facturationBrute) {
      const d = datePlausible(facturationBrute);
      if (d) facturation = d;
      else messages.push(`Date « facturation depuis » invalide : « ${facturationBrute} » (jj/mm/aaaa).`, "IMPORT_ROW_BILLING_FROM_INVALID", { value: facturationBrute });
    }

    let premiereFacture: string | null = null;
    if (debut && fin) {
      const depart = facturation > debut ? facturation : debut;
      premiereFacture = depart > fin ? null : `${String(depart.getUTCMonth() + 1).padStart(2, "0")}/${depart.getUTCFullYear()}`;
    }

    const donnees: DonneesContrat = {
      property: titre, propertyId: bien?.id ?? null, tenantEmail: email, tenantId: tenantId ?? null,
      rent, deposit, currency,
      startDate: debut ? jour(debut) : null, endDate: fin ? jour(fin) : null,
      paymentDay, leaseType, applicableLaw: droit || null, status,
      billingFrom: jour(facturation), premiereFacture,
    };
    if (messages.length > 0 || !bien || !tenantId || !debut || !fin) return { ligne, statut: "ERREUR", ...messages.enBloc(), donnees };

    // Doublon : même bien, même locataire, même date de début (fichier déjà importé, ou bail déjà saisi).
    if (vus.some((c) => c.propertyId === bien!.id && c.tenantId === tenantId && c.start.getTime() === debut.getTime())) {
      return {
        ligne,
        statut: "DOUBLON",
        ...unMessage("Un contrat de ce locataire sur ce bien, avec la même date de début, existe déjà (ou figure plus haut dans le fichier).", "IMPORT_ROW_CONTRACT_DUPLICATE"),
        donnees,
      };
    }
    // Deux baux actifs ne peuvent pas se chevaucher sur un même bien.
    if (status === "ACTIVE" && vus.some((c) => c.actif && c.propertyId === bien!.id && c.start < fin && c.end > debut)) {
      return {
        ligne,
        statut: "ERREUR",
        ...unMessage("Ce bien a déjà un contrat actif sur cette période (déjà enregistré, ou plus haut dans le fichier).", "IMPORT_ROW_CONTRACT_OVERLAP"),
        donnees,
      };
    }
    vus.push({ propertyId: bien.id, tenantId, start: debut, end: fin, actif: status === "ACTIVE" });
    return { ligne, statut: "OK", messages: [], details: [], donnees };
  });

  return { type: "contracts", delimiteur: csv.delimiteur, lignes, resume: resumer(lignes) };
}

/**
 * Crée les contrats valides, et leurs factures À PARTIR DE « facturation depuis » seulement.
 * Une transaction : tout est écrit, ou rien. Le chevauchement est revérifié sous le verrou du
 * bien (comme à la création à la main) : une ligne devenue conflictuelle entre l'aperçu et
 * l'écriture est ignorée, pas fatale. Renvoie le nombre de contrats écrits.
 */
export async function importerContrats(managerId: string, analyse: Analyse<DonneesContrat>): Promise<number> {
  const valides = analyse.lignes.filter((l) => l.statut === "OK");
  if (valides.length === 0) return 0;

  // Les ids viennent de l'analyse rejouée côté serveur ; on revérifie quand même qu'ils sont à l'agence.
  const biensAgence = new Set(
    (await db.select({ id: properties.id }).from(properties).where(and(eq(properties.managerId, managerId), inArray(properties.id, valides.map((l) => l.donnees.propertyId!))))).map((b: { id: string }) => b.id)
  );

  let ecrits = 0;
  await db.transaction(async (tx) => {
    for (const { donnees: d } of valides) {
      if (!biensAgence.has(d.propertyId!)) continue;
      const debut = new Date(d.startDate!);
      const fin = new Date(d.endDate!);
      if (d.status === "ACTIVE") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.propertyId!}))`);
        const actifs = await tx.select().from(contracts).where(and(eq(contracts.propertyId, d.propertyId!), eq(contracts.status, "ACTIVE")));
        if (actifs.some((c: typeof contracts.$inferSelect) => new Date(c.startDate) < fin && new Date(c.endDate) > debut)) continue;
      }
      const [cree] = await tx
        .insert(contracts)
        .values({
          propertyId: d.propertyId!, tenantId: d.tenantId!, rent: d.rent!, deposit: d.deposit!, currency: d.currency,
          startDate: debut, endDate: fin, status: d.status, paymentDay: d.paymentDay, leaseType: d.leaseType,
          applicableLaw: d.applicableLaw, billingFrom: new Date(d.billingFrom!),
        })
        .returning();
      if (d.status === "ACTIVE") await tx.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, d.propertyId!));
      await generateInvoicesForContract(cree, tx);
      ecrits++;
    }
  });
  return ecrits;
}
