import { cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";

interface Props {
  /** Ce que la bulle explique. Une phrase courte : elle se lit en passant. */
  texte: string;
  /** L'élément survolé. Un seul, qui recevra `aria-describedby`. */
  children: ReactElement;
  /** Côté d'apparition. « droite » pour un menu latéral, « haut » pour un bouton dans un tableau. */
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
 * Elle ne capte jamais le pointeur (`pointer-events-none`). Une bulle qui
 * s'interpose entre le curseur et le bouton qu'elle décrit rend ce bouton
 * difficile à cliquer, et le défaut est d'autant plus déroutant qu'il vient de
 * l'aide elle-même.
 */
export default function Bulle({ texte, children, position = "haut", className = "inline-flex" }: Props) {
  const id = useId();
  const ancre = useRef<HTMLSpanElement>(null);
  const [coordonnees, setCoordonnees] = useState<{ top: number; left: number } | null>(null);

  const montrer = useCallback(() => {
    // On mesure l'ÉLÉMENT DÉCRIT, pas l'enveloppe. Deux raisons : l'enveloppe
    // peut être `display: contents` — nécessaire pour s'insérer dans une
    // grille ou un flex sans en perturber la mise en page — et elle n'a alors
    // aucune boîte, donc un rectangle de zéros ; et même sans cela, c'est bien
    // le bouton que la bulle doit désigner.
    const cible = ancre.current?.firstElementChild ?? ancre.current;
    const rect = cible?.getBoundingClientRect();
    if (!rect) return;
    setCoordonnees(
      position === "droite"
        ? { top: rect.top + rect.height / 2, left: rect.right + 10 }
        : { top: rect.top - 10, left: rect.left + rect.width / 2 }
    );
  }, [position]);

  const cacher = useCallback(() => setCoordonnees(null), []);

  useEffect(() => {
    if (!coordonnees) return;
    // `capture` : le défilement d'un conteneur interne ne remonte pas jusqu'à
    // la fenêtre, et c'est justement dans un conteneur qui défile — la barre
    // de navigation — que la bulle se décalerait sans qu'on le voie.
    window.addEventListener("scroll", cacher, true);
    return () => window.removeEventListener("scroll", cacher, true);
  }, [coordonnees, cacher]);

  return (
    <span
      ref={ancre}
      className={className}
      onMouseEnter={montrer}
      onMouseLeave={cacher}
      onFocus={montrer}
      onBlur={cacher}
      onKeyDown={(e) => {
        if (e.key === "Escape") cacher();
      }}
    >
      {cloneElement(children, { "aria-describedby": coordonnees ? id : undefined } as Partial<unknown>)}
      {coordonnees && (
        <span
          role="tooltip"
          id={id}
          style={{
            top: coordonnees.top,
            left: coordonnees.left,
            transform: position === "droite" ? "translateY(-50%)" : "translate(-50%, -100%)",
          }}
          className="fixed z-50 pointer-events-none max-w-xs rounded-lg bg-slate-900 dark:bg-slate-700 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg ring-1 ring-black/10"
        >
          {texte}
        </span>
      )}
    </span>
  );
}
