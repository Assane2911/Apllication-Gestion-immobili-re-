/** Pastille d'initiales (prénom et nom) : un carré bleu de plan, comme une étiquette de feuille. Décorative. */
export default function Initiales({ prenom, nom, className = "" }: { prenom?: string | null; nom?: string | null; className?: string }) {
  const lettres = `${(prenom ?? "").trim()[0] ?? ""}${(nom ?? "").trim()[0] ?? ""}`.toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center bg-ink-900 font-mono text-[11px] font-medium tracking-wide text-white ${className}`}
    >
      {lettres}
    </span>
  );
}
