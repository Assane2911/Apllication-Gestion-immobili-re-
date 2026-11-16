import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import fr from "./locales/zones/fr/base";

export const SUPPORTED_LANGUAGES = [
  { code: "fr", label: "Français", flag: "🇫🇷", dir: "ltr" as const },
  { code: "en", label: "English", flag: "🇬🇧", dir: "ltr" as const },
  { code: "pt", label: "Português", flag: "🇵🇹", dir: "ltr" as const },
  { code: "es", label: "Español", flag: "🇪🇸", dir: "ltr" as const },
];

// Aucune langue prise en charge n'est actuellement RTL ; l'ensemble reste
// vide mais l'infrastructure (dir + lang sur <html>) est conservée telle
// quelle pour pouvoir réintroduire une langue RTL plus tard sans refonte.
const RTL_LANGUAGES = new Set<string>([]);

/** Applique le sens de lecture (RTL le cas échéant) et l'attribut lang sur <html>. */
export function applyDocumentDirection(lng: string) {
  const dir = RTL_LANGUAGES.has(lng) ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
}

/**
 * Les textes sont découpés en « zones » (dossier locales/zones/<langue>/) :
 *  - `base` : ce que toute page affiche (connexion, menus, boutons, formulaires communs) ;
 *  - `landing`, `manager`, `admin`, `tenant` : les pages de chaque espace ;
 *  - `partage` : ce que plusieurs espaces réutilisent (états des lieux, comptes rendus, annonces, abonnement, agenda, tableau de
 *    bord, espace propriétaire).
 *
 * Seule la base française est dans le fichier principal (≈ un tiers des textes français). Les autres zones se chargent EN
 * MÊME TEMPS que la page qui s'en sert (voir utils/lazyAvecZones.ts) : le navigateur les télécharge en parallèle du fichier de la
 * page, sans attente supplémentaire. Les autres langues se chargent à la demande, zone par zone, pour la langue du visiteur.
 *
 * Quelle zone pour quelle page : déclaré dans App.tsx, et vérifié par zones.test.ts, qui lit le code pour s'assurer qu'aucune page
 * n'affiche une clé d'une zone qu'elle ne charge pas (le visiteur lirait « manager.tips.x » au lieu du texte).
 */
export const ZONES = ["landing", "manager", "admin", "tenant", "partage"] as const;
export type Zone = (typeof ZONES)[number];
type Chargeur = () => Promise<{ default: object }>;

const CHARGEURS: Record<string, Partial<Record<Zone | "base", Chargeur>>> = {
  fr: {
    landing: () => import("./locales/zones/fr/landing"),
    manager: () => import("./locales/zones/fr/manager"),
    admin: () => import("./locales/zones/fr/admin"),
    tenant: () => import("./locales/zones/fr/tenant"),
    partage: () => import("./locales/zones/fr/partage"),
  },
  en: {
    base: () => import("./locales/zones/en/base"),
    landing: () => import("./locales/zones/en/landing"),
    manager: () => import("./locales/zones/en/manager"),
    admin: () => import("./locales/zones/en/admin"),
    tenant: () => import("./locales/zones/en/tenant"),
    partage: () => import("./locales/zones/en/partage"),
  },
  es: {
    base: () => import("./locales/zones/es/base"),
    landing: () => import("./locales/zones/es/landing"),
    manager: () => import("./locales/zones/es/manager"),
    admin: () => import("./locales/zones/es/admin"),
    tenant: () => import("./locales/zones/es/tenant"),
    partage: () => import("./locales/zones/es/partage"),
  },
  pt: {
    base: () => import("./locales/zones/pt/base"),
    landing: () => import("./locales/zones/pt/landing"),
    manager: () => import("./locales/zones/pt/manager"),
    admin: () => import("./locales/zones/pt/admin"),
    tenant: () => import("./locales/zones/pt/tenant"),
    partage: () => import("./locales/zones/pt/partage"),
  },
};

/**
 * Copie des textes avant de les confier à i18next : il fusionne les zones DANS ses propres objets (et garderait des références à ceux
 * du module), ce qui modifierait les fichiers de zones eux-mêmes. Les textes ne sont que des chaînes : une copie JSON suffit.
 */
function copie<T extends object>(textes: T): T {
  return JSON.parse(JSON.stringify(textes)) as T;
}

/** Zones déjà ajoutées à i18next, « langue:zone ». La base française est là dès le départ. */
const chargees = new Set<string>(["fr:base"]);
/** Zones dont une page a eu besoin : toute langue choisie ensuite les reçoit, pour que la page déjà affichée ne perde aucun texte. */
const demandees = new Set<Zone>();

async function chargerZone(code: string, zone: Zone | "base"): Promise<void> {
  const cle = `${code}:${zone}`;
  if (chargees.has(cle)) return;
  const chargeur = CHARGEURS[code]?.[zone];
  if (!chargeur) return;
  const module = await chargeur();
  i18n.addResourceBundle(code, "translation", copie(module.default), true, true);
  chargees.add(cle);
}

/** Charge les textes d'une langue prise en charge (base et zones déjà demandées), une seule fois. Sans effet pour une langue inconnue. */
export async function chargerLangue(code: string): Promise<void> {
  if (!CHARGEURS[code]) return;
  await Promise.all([chargerZone(code, "base"), ...[...demandees].map((zone) => chargerZone(code, zone))]);
}

/**
 * Charge les zones de textes dont une page a besoin, pour la langue affichée. À appeler AVANT d'afficher la page (voir
 * lazyAvecZones) : une zone absente afficherait la clé brute.
 */
export async function chargerZones(zones: readonly Zone[]): Promise<void> {
  for (const zone of zones) demandees.add(zone);
  const code = i18n.language;
  await Promise.all(zones.map((zone) => chargerZone(code, zone)));
}

/** Toutes les zones, pour la langue affichée et pour toute langue choisie ensuite : tests et outils qui ont besoin de la langue entière. */
export const demanderToutesLesZones = () => chargerZones(ZONES);

/** Change la langue de l'interface, après avoir chargé ses textes (jamais de clés brutes ni de français par erreur). */
export async function changerLangue(code: string): Promise<void> {
  if (!SUPPORTED_LANGUAGES.some((l) => l.code === code)) return;
  await chargerLangue(code);
  await i18n.changeLanguage(code);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: copie(fr) },
    },
    fallbackLng: "fr",
    supportedLngs: ["fr", "en", "pt", "es"],
    // Le français est la langue par défaut de l'application ; on ne détecte
    // que le choix déjà mémorisé par l'utilisateur (pas la langue du
    // navigateur), pour éviter toute surprise au premier chargement.
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "app_language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

applyDocumentDirection(i18n.resolvedLanguage || i18n.language || "fr");

i18n.on("languageChanged", (lng) => {
  applyDocumentDirection(lng);
});

/**
 * Résolue quand la langue mémorisée du visiteur est chargée : l'application ne s'affiche qu'ensuite, pour ne pas
 * montrer un instant du français à un visiteur qui avait choisi une autre langue.
 */
export const i18nPret: Promise<void> = (async () => {
  // `language` (la langue demandée) et non `resolvedLanguage` : tant que ses textes ne sont pas chargés, celle-ci vaut « fr ».
  const code = i18n.language;
  if (code && code !== "fr") await changerLangue(code);
})().catch(() => undefined);

export default i18n;
