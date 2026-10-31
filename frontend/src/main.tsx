import './instrument'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Polices servies par nous : les charger depuis les serveurs de Google enverrait l'adresse IP de chaque visiteur à
// Google avant tout consentement (voir src/rgpd/polices.test.ts). Titres : Bricolage Grotesque ; libellés techniques : DM Mono ; texte : Public Sans (index.css).
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/700.css'
import '@fontsource/bricolage-grotesque/800.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/500.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/public-sans/700.css'
import './index.css'
import { i18nPret } from './i18n'
import App from './App.tsx'
import { installerRechargementAutomatique } from './utils/rechargementApresDeploiement'

// Onglet resté ouvert pendant un déploiement : les fichiers qu'il réclame n'existent plus, on recharge (une fois).
installerRechargementAutomatique()

// La langue mémorisée du visiteur (autre que le français) se charge avant le premier affichage.
i18nPret.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
