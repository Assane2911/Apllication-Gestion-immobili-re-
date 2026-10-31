/**
 * Marque d'ImmoPlatform Pro (une maison qui abrite un P), dessinée en SVG : elle prend la couleur du thème au lieu de
 * rester une pastille sombre sur un fond clair. Trait indigo et cheminée terre cuite en clair ; trait sable et cheminée
 * ocre en sombre. `sur="sombre"` force la version claire, pour les surfaces toujours sombres (menu latéral, bandeaux).
 * Le fichier `app-icon.png` reste, lui, l'icône de l'application (favicon, écran d'accueil du téléphone).
 */
export default function Logo({ taille = 36, sur = "auto", className = "" }: { taille?: number; sur?: "auto" | "sombre"; className?: string }) {
  const trait = sur === "sombre" ? "stroke-slate-100" : "stroke-ink-900 dark:stroke-slate-100";
  const cheminee = sur === "sombre" ? "fill-ocre" : "fill-brand-600 dark:fill-ocre";
  return (
    <svg
      role="img"
      aria-label="Logo"
      width={taille}
      height={taille}
      viewBox="0 0 64 64"
      fill="none"
      className={`shrink-0 ${className}`}
    >
      <rect x="41" y="9" width="11" height="12" rx="1.5" className={cheminee} />
      <g className={trait} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 31 32 13 53 29" />
        <path d="M23 34v21" />
        <path d="M32 55V37h11a8.5 8.5 0 0 1 0 17H32" />
      </g>
    </svg>
  );
}
