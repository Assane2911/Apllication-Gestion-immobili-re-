import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { HistoriqueContext } from "./historique";

/**
 * Suit les pages visitées pour savoir s'il existe une page « après » celle-ci. Le navigateur ne le dit pas : on ne
 * sait que reculer ou avancer, sans savoir s'il reste quelque chose devant. Sans cette information, le bouton
 * « Suivant » de l'écran de chargement resterait actif alors qu'il ne mène nulle part.
 *
 * Chaque page porte une clé unique (`location.key`). Une nouvelle page (PUSH) efface tout ce qui se trouvait
 * devant, comme le fait un navigateur ; un remplacement (REPLACE) change la page courante sans créer d'étape ; un
 * retour ou un avance (POP) déplace simplement la position. Une page inconnue (rechargement en cours de route)
 * repart de zéro : on ne prétend pas savoir ce qu'on ignore.
 *
 * À placer à l'intérieur du routeur.
 */
export default function HistoriqueProvider({ children }: { children: ReactNode }) {
  const { key } = useLocation();
  const type = useNavigationType();
  const suivi = useRef({ pile: [key], position: 0, cle: key });

  // Mise à jour une seule fois par page : un second rendu avec la même clé (mode strict) ne change rien.
  if (suivi.current.cle !== key) {
    const s = suivi.current;
    if (type === "PUSH") {
      s.pile = [...s.pile.slice(0, s.position + 1), key];
      s.position += 1;
    } else if (type === "REPLACE") {
      s.pile = s.pile.slice();
      s.pile[s.position] = key;
    } else {
      const trouvee = s.pile.indexOf(key);
      if (trouvee >= 0) {
        s.position = trouvee;
      } else {
        s.pile = [key];
        s.position = 0;
      }
    }
    s.cle = key;
  }

  const valeur = useMemo(
    () => ({ peutReculer: suivi.current.position > 0, peutAvancer: suivi.current.position < suivi.current.pile.length - 1 }),
    // `key` change à chaque page : c'est lui qui déclenche le recalcul, la pile étant dans une référence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  return <HistoriqueContext.Provider value={valeur}>{children}</HistoriqueContext.Provider>;
}
