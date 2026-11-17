import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Annonce aux lecteurs d'écran le titre de la page qui s'ouvre quand on change de page.
 *
 * Dans une application d'une seule page, le navigateur ne recharge rien : un lecteur d'écran n'annonce pas que la page a
 * changé (le focus reste sur le lien du menu), et la personne ne sait pas si son clic a eu un effet (WCAG 4.1.3, messages
 * d'état). Ici, une zone `role="status"` invisible reçoit le titre du document dès que la nouvelle page l'a posé (`Seo`), ou
 * au bout de `delaiMaxMs` si le titre est resté le même (deux pages au titre identique).
 *
 * Rien n'est annoncé au premier chargement : le lecteur d'écran lit déjà la page qui s'ouvre.
 */
export default function AnnonceChangementPage({ delaiMaxMs = 1500 }: { delaiMaxMs?: number }) {
  const { pathname } = useLocation();
  const [annonce, setAnnonce] = useState("");
  // Mémorise la page déjà vue : l'effet ne sert qu'à un VRAI changement (et pas au double montage du mode strict).
  const precedente = useRef(pathname);

  useEffect(() => {
    if (precedente.current === pathname) return;
    precedente.current = pathname;

    setAnnonce("");
    const avant = document.title;
    let annonce_faite = false;
    const annoncer = () => {
      if (annonce_faite) return;
      annonce_faite = true;
      observateur.disconnect();
      setAnnonce(document.title);
    };
    // Le titre peut être posé après un chargement différé de la page : on guette le <head> plutôt que de deviner un délai.
    const observateur = new MutationObserver(() => {
      if (document.title !== avant) annoncer();
    });
    observateur.observe(document.head, { childList: true, subtree: true, characterData: true });
    const delai = window.setTimeout(annoncer, delaiMaxMs);
    return () => {
      observateur.disconnect();
      window.clearTimeout(delai);
    };
  }, [pathname, delaiMaxMs]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {annonce}
    </div>
  );
}
