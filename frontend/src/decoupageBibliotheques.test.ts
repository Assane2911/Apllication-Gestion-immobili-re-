import { describe, expect, it } from "vitest";
import { decouperEnFichiers } from "../decoupageBibliotheques";

/**
 * Découpage du site en fichiers (decoupageBibliotheques.ts, branché sur `manualChunks` dans vite.config.ts).
 *
 * Les bibliothèques de base vivent dans un fichier `vendor` à part dont le nom ne change pas d'un déploiement à l'autre : un visiteur de retour ne
 * retélécharge pas ~120 Ko compressés quand seul le code de l'application a changé. La liste est EXACTE : recharts et react-redux restent à part.
 */
describe("découpage des bibliothèques en fichiers", () => {
  it.each([
    "/app/node_modules/react/index.js",
    "/app/node_modules/react-dom/client.js",
    "/app/node_modules/scheduler/index.js",
    "/app/node_modules/react-router/dist/index.js",
    "/app/node_modules/react-router-dom/dist/index.js",
    "/app/node_modules/axios/lib/axios.js",
    "/app/node_modules/i18next/dist/esm/i18next.js",
    "/app/node_modules/react-i18next/dist/es/index.js",
    "/app/node_modules/i18next-browser-languagedetector/dist/esm/i18nextBrowserLanguageDetector.js",
    "/app/node_modules/@sentry/core/build/esm/index.js",
  ])("%s va dans le fichier vendor", (id) => {
    expect(decouperEnFichiers(id)).toBe("vendor");
  });

  it.each([
    "/app/node_modules/recharts/es6/index.js",
    "/app/node_modules/react-redux/es/index.js",
    "/app/node_modules/d3-shape/src/index.js",
    "/app/node_modules/lucide-react/dist/esm/icons/check.js",
    "/app/node_modules/react-is/index.js",
    "/app/src/App.tsx",
    "/app/src/i18n/locales/fr.ts",
  ])("%s reste hors du fichier vendor", (id) => {
    expect(decouperEnFichiers(id)).toBeUndefined();
  });
});
