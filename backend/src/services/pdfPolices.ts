/**
 * Polices standard de pdfkit, déclarées EXPLICITEMENT pour l'hébergeur.
 *
 * pdfkit 0.20 charge ses polices (Helvetica…) par un `require` créé à l'exécution sur un chemin interne (`#standard-fonts/Helvetica`).
 * Le traceur de fichiers de Vercel, qui décide de ce que contient chaque fonction, ne suit pas ce chemin : le paquet pdfkit était
 * embarqué SANS ses polices, et la génération d'une quittance échouait en production avec
 * « Cannot find module …/pdfkit/js/standard-fonts/Helvetica.cjs » (vu le 14 novembre).
 *
 * Ces importations ne servent à rien à l'exécution (les modules sont déjà chargés par pdfkit) : elles donnent au traceur des
 * références statiques, par les chemins publics que pdfkit exporte. Le test `pdfPolices.test.ts` exige qu'une police utilisée dans
 * le code figure ici.
 */
import "pdfkit/standard-fonts/Helvetica";
import "pdfkit/standard-fonts/HelveticaBold";
import "pdfkit/standard-fonts/HelveticaOblique";
import "pdfkit/standard-fonts/HelveticaBoldOblique";
