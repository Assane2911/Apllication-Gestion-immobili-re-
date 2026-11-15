import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { decouperEnFichiers } from './decoupageBibliotheques.js'

// Identifiant de CE build : l'empreinte du commit déployé (Vercel), à défaut l'heure du build. Il est inscrit dans le code
// de l'application (__BUILD_ID__) ET publié dans `version.json` : un onglet resté ouvert compare les deux pour savoir
// qu'un déploiement a eu lieu depuis (voir utils/versionPubliee.ts).
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now())

/** Publie `version.json` à la racine du site, à côté de index.html. Servi sans cache long (seul /assets/ en a un). */
function publierVersion() {
  return {
    name: 'publier-version',
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildId }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publierVersion()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  // Le code-splitting par route existe déjà (React.lazy sur chaque page dans App.tsx) : c'est lui qui isole recharts (utilisé uniquement par
  // DashboardPage et FiscalPage) dans son propre chunk asynchrone. Un ancien découpage MANUEL qui isolait recharts avait fusionné par erreur
  // React, ReactDOM et react-redux (dépendance interne de recharts) dans un chunk chargé sur TOUTES les pages : on ne découpe donc à la main
  // que les bibliothèques de base, par une liste de paquets exacte (decoupageBibliotheques.ts, testée).
  build: {
    // Bibliothèques de base dans un fichier à part, stable d'un déploiement à l'autre : voir decoupageBibliotheques.ts.
    rollupOptions: { output: { manualChunks: decouperEnFichiers } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
