import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // recharts n'est utilisé que par le tableau de bord gestionnaire ;
        // l'isoler dans son propre chunk évite de le livrer aux locataires
        // et aux pages qui ne l'utilisent pas.
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) {
            return 'recharts'
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
