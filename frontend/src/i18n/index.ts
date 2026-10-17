import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import fr from "./locales/fr";

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
 * Seul le français (langue par défaut et de repli) est embarqué dans le fichier principal : les trois autres
 * langues, ≈ 110 Ko chacune avant compression, se chargent à la demande — au démarrage pour la langue mémorisée
 * du visiteur, ou quand il en choisit une autre.
 */
const CHARGEURS_LANGUES: Record<string, () => Promise<{ default: object }>> = {
  en: () => import("./locales/en"),
  es: () => import("./locales/es"),
  pt: () => import("./locales/pt"),
};

/** Charge les textes d'une langue prise en charge, une seule fois. Sans effet pour le français ou une langue inconnue. */
export async function chargerLangue(code: string): Promise<void> {
  const chargeur = CHARGEURS_LANGUES[code];
  if (!chargeur || i18n.hasResourceBundle(code, "translation")) return;
  const module = await chargeur();
  i18n.addResourceBundle(code, "translation", module.default, true, true);
}

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
      fr: { translation: fr },
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
