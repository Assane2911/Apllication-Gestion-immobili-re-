import { useEffect, useRef } from "react";

const FOCALISABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SAISIES = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

/** Fenêtres ouvertes, de la plus ancienne à la plus récente : seule la dernière réagit au clavier. */
const pile: symbol[] = [];

function elementsFocalisables(conteneur: HTMLElement): HTMLElement[] {
  return Array.from(conteneur.querySelectorAll<HTMLElement>(FOCALISABLES));
}

/**
 * Comportement clavier et accessibilité commun aux fenêtres modales : rôle `dialog` nommé par son titre, focus placé
 * dans la fenêtre à l'ouverture (sur l'élément marqué `data-autofocus`, sinon le premier champ de saisie, sinon le
 * premier élément actif) puis rendu à
 * l'élément qui l'avait ouverte, Tab/Maj+Tab qui restent dans la fenêtre, Échap qui la ferme.
 *
 * `fermable` à `false` (enregistrement en cours) bloque Échap, comme le clic sur le fond. Avec plusieurs fenêtres
 * empilées, seule celle du dessus obéit au clavier.
 *
 * Usage : `<div {...useDialogue({ onClose, titreId: "x" })}>` avec un titre `id="x"` (ou `libelle` quand il n'y a pas de
 * titre visible). Pour une fenêtre rendue conditionnellement dans un composant, utiliser `<Dialogue>`.
 */
export function useDialogue({ onClose, titreId, libelle, fermable = true }: { onClose: () => void; titreId?: string; libelle?: string; fermable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const fermableRef = useRef(fermable);
  onCloseRef.current = onClose;
  fermableRef.current = fermable;

  useEffect(() => {
    const conteneur = ref.current;
    if (!conteneur) return;
    const identifiant = Symbol("dialogue");
    const precedent = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pile.push(identifiant);

    const choisi = conteneur.querySelector<HTMLElement>("[data-autofocus]") ?? conteneur.querySelector<HTMLElement>(SAISIES);
    (choisi ?? elementsFocalisables(conteneur)[0] ?? conteneur).focus();

    const surTouche = (e: KeyboardEvent) => {
      if (pile[pile.length - 1] !== identifiant) return;
      if (e.key === "Escape") {
        if (!fermableRef.current) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const elements = elementsFocalisables(conteneur);
      if (elements.length === 0) {
        e.preventDefault();
        conteneur.focus();
        return;
      }
      const premier = elements[0];
      const dernier = elements[elements.length - 1];
      const actif = document.activeElement;
      if (e.shiftKey && (actif === premier || actif === conteneur || !conteneur.contains(actif))) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && (actif === dernier || !conteneur.contains(actif))) {
        e.preventDefault();
        premier.focus();
      }
    };
    document.addEventListener("keydown", surTouche);

    return () => {
      document.removeEventListener("keydown", surTouche);
      const rang = pile.indexOf(identifiant);
      if (rang !== -1) pile.splice(rang, 1);
      if (precedent && document.contains(precedent)) precedent.focus();
    };
  }, []);

  return { ref, role: "dialog" as const, "aria-modal": true as const, "aria-labelledby": libelle ? undefined : titreId, "aria-label": libelle, tabIndex: -1 };
}
