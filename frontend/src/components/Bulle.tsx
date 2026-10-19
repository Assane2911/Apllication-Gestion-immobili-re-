import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { placerBulle, type Cote, type Placement } from "../utils/placementBulle";

interface Props {
  /** Ce que la bulle explique. Une phrase courte : elle se lit en passant. */
  texte: string;
  /** L'élément survolé. Un seul, qui recevra `aria-describedby`. */
  children: ReactElement;
  /**
   * Côté d'apparition souhaité. « droite » pour un menu latéral, « haut » pour un bouton dans un tableau.
   * La bulle passe de l'autre côté si celui-ci manque de place : elle ne sort jamais de l'écran.
   */
  position?: "haut" | "droite";
  /**
   * Classes de l'enveloppe. La bulle s'insère entre un parent et son enfant :
   * sans cela, elle imposerait `inline-flex` à un élément que sa mise en page
   * voulait en bloc — une entrée de menu cesserait de s'étendre sur toute la
   * largeur.
   *
   * `"contents"` est le choix à faire dans une grille ou un conteneur flex
   * dont l'enfant doit rester un enfant DIRECT : l'enveloppe disparaît alors
   * de la mise en page. C'est pour cela que `montrer` mesure l'élément décrit
   * et non l'enveloppe, qui n'a dans ce cas aucune boîte.
   */
  className?: string;
}

/**
 * Bulle d'information au survol.
 *
 * Trois choix méritent d'être expliqués, parce qu'ils ne se devinent pas à la
 * lecture du code.
 *
 * Elle apparaît au survol ET au focus clavier. Une aide réservée à la souris
 * abandonne précisément ceux qui naviguent au clavier, souvent parce qu'ils ne
 * peuvent pas faire autrement. Échap la referme, comme toute chose qui
 * s'ouvre.
 *
 * Elle se positionne en `fixed`, à partir des coordonnées réelles de
 * l'élément. Une bulle en `absolute` serait rognée par le premier parent qui
 * défile — la barre de navigation en est un — et l'utilisateur verrait une
 * moitié de phrase sans comprendre pourquoi. Le revers est qu'un défilement la
 * laisserait derrière lui : on la referme donc au défilement plutôt que de la
 * laisser flotter à côté de son sujet.
 *
 * Elle se lit sans effort : texte de 14 px, contraste inversé (claire en thème
 * sombre, où une bulle sombre se fondrait dans la page), et une pointe qui
 * désigne l'élément décrit. Elle se replie contre les bords de la fenêtre —
 * une bulle rognée par l'écran se lit à moitié — et Échap la ferme où que se
 * trouve le focus, y compris quand elle est ouverte à la souris.
 *
 * Elle ne capte jamais le pointeur (`pointer-events-none`). Une bulle qui
 * s'interpose entre le curseur et le bouton qu'elle décrit rend ce bouton
 * difficile à cliquer, et le défaut est d'autant plus déroutant qu'il vient de
 * l'aide elle-même.
 */
export default function Bulle({ texte, children, position = "haut", className = "inline-flex" }: Props) {
  const id = useId();
  const ancre = useRef<HTMLSpanElement>(null);
  const bulle = useRef<HTMLSpanElement>(null);
  const [rectAncre, setRectAncre] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const montrer = useCallback(() => {
    // On mesure l'ÉLÉMENT DÉCRIT, pas l'enveloppe. Deux raisons : l'enveloppe
    // peut être `display: contents` — nécessaire pour s'insérer dans une
    // grille ou un flex sans en perturber la mise en page — et elle n'a alors
    // aucune boîte, donc un rectangle de zéros ; et même sans cela, c'est bien
    // le bouton que la bulle doit désigner.
    const cible = ancre.current?.firstElementChild ?? ancre.current;
    const rect = cible?.getBoundingClientRect();
    if (rect) setRectAncre(rect);
  }, []);

  const cacher = useCallback(() => {
    setRectAncre(null);
    setPlacement(null);
  }, []);

  // La taille de la bulle ne se connaît qu'une fois affichée : on la mesure
  // avant la peinture (donc sans clignotement) pour la placer dans la fenêtre.
  useLayoutEffect(() => {
    if (!rectAncre || !bulle.current) return;
    const { width, height } = bulle.current.getBoundingClientRect();
    setPlacement(placerBulle(rectAncre, { width, height }, position, { width: window.innerWidth, height: window.innerHeight }));
  }, [rectAncre, position]);

  useEffect(() => {
    if (!rectAncre) return;
    // `capture` : le défilement d'un conteneur interne ne remonte pas jusqu'à
    // la fenêtre, et c'est justement dans un conteneur qui défile — la barre
    // de navigation — que la bulle se décalerait sans qu'on le voie.
    const surEchap = (e: KeyboardEvent) => {
      if (e.key === "Escape") cacher();
    };
    window.addEventListener("scroll", cacher, true);
    window.addEventListener("resize", cacher);
    document.addEventListener("keydown", surEchap);
    return () => {
      window.removeEventListener("scroll", cacher, true);
      window.removeEventListener("resize", cacher);
      document.removeEventListener("keydown", surEchap);
    };
  }, [rectAncre, cacher]);

  const cote: Cote = placement?.cote ?? position;
  const verticale = cote === "haut" || cote === "bas";

  return (
    <span ref={ancre} className={className} onMouseEnter={montrer} onMouseLeave={cacher} onFocus={montrer} onBlur={cacher}>
      {cloneElement(children, { "aria-describedby": rectAncre ? id : undefined } as Partial<unknown>)}
      {rectAncre && (
        <span
          ref={bulle}
          role="tooltip"
          id={id}
          // Invisible le temps d'une mesure : elle est placée avant la première peinture.
          style={{ top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? "visible" : "hidden" }}
          className="fixed z-50 pointer-events-none w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-3 py-2 text-sm font-medium leading-snug shadow-xl ring-1 ring-black/10 dark:ring-white/20"
        >
          {texte}
          {placement && (
            <span
              aria-hidden="true"
              style={
                verticale
                  ? { left: placement.pointe - 5, [cote === "haut" ? "bottom" : "top"]: -4 }
                  : { top: placement.pointe - 5, [cote === "droite" ? "left" : "right"]: -4 }
              }
              className="absolute h-2.5 w-2.5 rotate-45 rounded-[2px] bg-slate-900 dark:bg-slate-100"
            />
          )}
        </span>
      )}
    </span>
  );
}
