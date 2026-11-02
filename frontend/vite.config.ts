import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
