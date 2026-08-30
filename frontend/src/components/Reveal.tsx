import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

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

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Délai avant l'animation, en millisecondes (pour un effet en cascade sur une grille). */
  delay?: number;
  as?: "div" | "span";
}

/**
 * Anime son contenu en fondu + léger décalage vertical dès qu'il entre dans le
 * viewport (Intersection Observer, une seule fois). Respecte
 * prefers-reduced-motion via les variantes motion-reduce: de Tailwind.
 */
export default function Reveal({ children, className = "", delay = 0, as = "div" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const Tag = as;
  return (
    <Tag
      ref={ref as any}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
