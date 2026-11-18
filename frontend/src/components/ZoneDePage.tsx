import type { ReactNode } from "react";

/**
 * Zone où s'affiche la page d'un espace connecté, posée AU-DESSUS du cartouche de feuille (voir CartouchePlan).
 *
 * Sa hauteur minimale est celle de l'écran : le cartouche commence donc toujours sous la ligne de flottaison. Sans elle, le
 * cartouche s'affichait en plein écran tant que la page chargeait (liste vide, roue), puis était repoussé hors de l'écran à
 * l'arrivée des données : un décalage de mise en page (CLS) de 0,2 à 0,7 selon la page (seuil « bon » : 0,1), mesuré sur 25 des
 * 38 pages connectées. Un élément décoratif ne doit pas bouger sous les yeux de l'utilisateur.
 */
export default function ZoneDePage({ children }: { children: ReactNode }) {
  return <div className="min-h-svh">{children}</div>;
}
