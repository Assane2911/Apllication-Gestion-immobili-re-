import { useEffect, useState } from "react";

/** Bouton « haut de page », qui n'apparaît qu'une fois l'accroche dépassée. */
export default function BoutonHautDePage({ libelle }: { libelle: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const auDefilement = () => setVisible(window.scrollY > 900);
    window.addEventListener("scroll", auDefilement, { passive: true });
    auDefilement();
    return () => window.removeEventListener("scroll", auDefilement);
  }, []);
  return (
    <a
      href="#top"
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? undefined : -1}
      aria-label={libelle}
      title={libelle}
      className={`fixed bottom-20 right-4 z-40 flex h-11 w-11 lg:bottom-6 lg:right-6 items-center justify-center border-2 border-ink-900 bg-white text-ink-900  transition-all duration-300 hover:bg-ink-900 hover:text-white motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 13V3M3 7.5 8 3l5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      </svg>
    </a>
  );
}
