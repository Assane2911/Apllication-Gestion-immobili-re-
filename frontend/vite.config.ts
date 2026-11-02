import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

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
  // Pas de manualChunks() manuel ici (audit sept. 2026) : un ancien découpage
  // qui isolait recharts dans son propre chunk fusionnait par erreur React,
  // ReactDOM et react-redux (dépendance interne de recharts) dans ce même
  // chunk, chargé sans condition sur TOUTES les pages (y compris connexion et
  // mentions légales) via un <link modulepreload>. Le code-splitting par
  // route existe déjà (React.lazy sur chaque page dans App.tsx) : c'est lui
  // qui isole naturellement recharts (utilisé uniquement par DashboardPage et
  // FiscalPage) dans son propre chunk asynchrone, sans qu'il faille l'aider.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
