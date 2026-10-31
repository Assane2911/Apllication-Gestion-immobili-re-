import './instrument'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Polices servies par nous : les charger depuis les serveurs de Google enverrait l'adresse IP de chaque visiteur à
// Google avant tout consentement (voir src/rgpd/polices.test.ts). Titres et texte : Archivo ; libellés techniques : DM Mono (index.css).
import '@fontsource/archivo/400.css'
import '@fontsource/archivo/500.css'
import '@fontsource/archivo/600.css'
import '@fontsource/archivo/700.css'
import '@fontsource/archivo/800.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
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
