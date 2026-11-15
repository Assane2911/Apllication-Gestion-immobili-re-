/**
 * Découpage du site en fichiers (`build.rollupOptions.output.manualChunks`, voir vite.config.ts), isolé ici pour pouvoir être testé.
 *
 * Les BIBLIOTHÈQUES de base (React, routage, requêtes, traduction, suivi d'erreurs) dans un fichier `vendor` à part. Sans cela, elles partageaient
 * le fichier principal avec le code de l'application : chaque déploiement en changeait le nom, et un visiteur de retour retéléchargeait ~210 Ko
 * compressés alors que ces bibliothèques n'avaient pas bougé. Liste de paquets EXACTE (jamais « tout node_modules ») : recharts reste dans son
 * propre fichier chargé à la demande, avec ses dépendances, et l'ancien découpage qui avait fusionné React et react-redux dans un fichier chargé
 * sur toutes les pages ne se reproduit pas.
 */
const BIBLIOTHEQUES_DE_BASE =
  /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|axios|i18next|react-i18next|i18next-browser-languagedetector|html-parse-stringify|void-elements|@sentry[^/]*)\//

export function decouperEnFichiers(id: string): string | undefined {
  return BIBLIOTHEQUES_DE_BASE.test(id) ? 'vendor' : undefined
}
