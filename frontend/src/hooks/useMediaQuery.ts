import { useEffect, useState } from "react";

/** Vrai tant que la requête de média correspond (ex. `(max-width: 639px)` : écran de téléphone). Faux hors navigateur. */
export function useMediaQuery(requete: string): boolean {
  const lire = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(requete).matches;
  const [correspond, setCorrespond] = useState(lire);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const liste = window.matchMedia(requete);
    const surChangement = () => setCorrespond(liste.matches);
    surChangement();
    liste.addEventListener("change", surChangement);
    return () => liste.removeEventListener("change", surChangement);
  }, [requete]);

  return correspond;
}
