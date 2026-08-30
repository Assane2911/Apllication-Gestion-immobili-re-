import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar";
import en from "./locales/en";
import fr from "./locales/fr";
import pt from "./locales/pt";

export const SUPPORTED_LANGUAGES = [
  { code: "fr", label: "Français", flag: "🇫🇷", dir: "ltr" as const },
  { code: "en", label: "English", flag: "🇬🇧", dir: "ltr" as const },
  { code: "pt", label: "Português", flag: "🇵🇹", dir: "ltr" as const },
  { code: "ar", label: "العربية", flag: "🇸🇦", dir: "rtl" as const },
];

const RTL_LANGUAGES = new Set(["ar"]);

/** Applique le sens de lecture (RTL pour l'arabe) et l'attribut lang sur <html>. */
export function applyDocumentDirection(lng: string) {
  const dir = RTL_LANGUAGES.has(lng) ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
      pt: { translation: pt },
      ar: { translation: ar },
    },
    fallbackLng: "fr",
    supportedLngs: ["fr", "en", "pt", "ar"],
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

export default i18n;
