import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decouperEnFichiers } from './decoupageBibliotheques.js'
import { construireTable, genererScript, injecterDansLeHtml, routesDepuisApp, type SortieBuild } from './prechargementDesPages.js'

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

/**
 * Annonce dès le HTML la page et les textes de l'adresse ouverte (voir prechargementDesPages.ts) : un petit script chargé sans bloquer, qui ajoute
 * les `<link rel="modulepreload">` utiles. Sans lui, la page n'est découverte qu'une fois le code principal exécuté (1,8 s au lieu de 0,3 s sur
 * une connexion lente). Les routes sont lues dans App.tsx ; si la lecture ne trouve plus rien, le build échoue plutôt que de perdre le gain en silence.
 */
function precharger() {
  let racine = process.cwd()
  return {
    name: 'precharger-les-pages',
    configResolved(config: { root: string }) {
      racine = config.root
    },
    generateBundle: {
      order: 'post' as const,
      handler(
        this: {
          emitFile: (f: { type: 'asset'; name: string; source: string }) => string
          getFileName: (reference: string) => string
          error: (message: string) => never
        },
        _options: unknown,
        bundle: Record<string, unknown>,
      ) {
        const html = bundle['index.html'] as { source?: string } | undefined
        if (!html || typeof html.source !== 'string') return
        const routes = routesDepuisApp(readFileSync(resolve(racine, 'src/App.tsx'), 'utf8'))
        const zones = [...new Set(routes.flatMap((r) => r.zones))]
        const table = construireTable(bundle as SortieBuild, routes, zones)
        if (!table.routes.some((r) => r.expression === '^/$') || !table.routes.some((r) => r.expression === '^/vitrine$')) {
          this.error("Préchargement des pages : l'accueil ou la vitrine est introuvable dans App.tsx ou dans le build (voir prechargementDesPages.ts).")
        }
        const reference = this.emitFile({ type: 'asset', name: 'precharge.js', source: genererScript(table) })
        html.source = injecterDansLeHtml(html.source, '/' + this.getFileName(reference))
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publierVersion(), precharger()],
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
