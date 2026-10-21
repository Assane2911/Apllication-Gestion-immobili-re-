/**
 * Ce qui recouvre la page et que le bouton retour d'Android doit refermer AVANT de quitter la page : le menu ouvert
 * sur téléphone, une fenêtre modale. Sans cela, un appui sur « retour » changeait de page en laissant la fenêtre
 * ouverte, ou quittait l'application.
 *
 * Les couches s'empilent dans l'ordre d'ouverture, et l'appui s'adresse à la dernière, comme Échap pour les fenêtres
 * (voir useDialogue). Une couche renvoyée par `enregistrerCoucheRetour` se retire en appelant la fonction rendue.
 */
type Couche = () => void;

const couches: Couche[] = [];

/**
 * Déclare une couche ouverte. `fermer` est appelée quand l'utilisateur appuie sur « retour » ; elle décide seule de
 * ce qu'elle fait (une fenêtre qui enregistre ne se ferme pas, mais l'appui est tout de même absorbé).
 */
export function enregistrerCoucheRetour(fermer: Couche): () => void {
  couches.push(fermer);
  return () => {
    const rang = couches.lastIndexOf(fermer);
    if (rang !== -1) couches.splice(rang, 1);
  };
}

/** Confie l'appui à la couche la plus récente. Renvoie `false` s'il n'y en a aucune : la navigation reprend la main. */
export function traiterRetourSurCouche(): boolean {
  const derniere = couches[couches.length - 1];
  if (!derniere) return false;
  derniere();
  return true;
}
