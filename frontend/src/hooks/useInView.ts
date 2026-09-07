import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Petit hook partagé : renvoie une ref à poser sur l'élément à surveiller et
 * un booléen qui passe à true (une seule fois) dès que l'élément entre dans
 * le viewport. Utilisé par <Reveal> et par les maquettes qui animent leur
 * propre contenu interne (barres de graphique, tracé de signature...).
 */
export function useInView<T extends HTMLElement>(threshold = 0.2): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView];
}
