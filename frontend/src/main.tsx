import './instrument'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { i18nPret } from './i18n'
import App from './App.tsx'

// La langue mémorisée du visiteur (autre que le français) se charge avant le premier affichage.
i18nPret.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
