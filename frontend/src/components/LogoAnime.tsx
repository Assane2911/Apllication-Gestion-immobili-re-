import { useId } from "react";

/**
 * Le logo de l'application (la maison dont le « P » forme le mur et la cheminée), dessiné en vectoriel pour se
 * tracer à l'écran pendant un chargement : le toit et le « P » d'un seul trait, puis la barre de gauche qui monte,
 * puis la cheminée qui apparaît. Les formes sont celles de `public/app-icon.png` ; chaque partie est révélée par un
 * masque dont le trait se prolonge (voir `.logo-anime-*` dans index.css). Sans animation (mouvement réduit), le logo
 * s'affiche complet et fixe.
 */
export default function LogoAnime({ taille = 112, className = "" }: { taille?: number; className?: string }) {
  // useId donne « :r0: » : les deux-points gênent dans `url(#…)`, on les retire.
  const base = useId().replace(/:/g, "");
  const degradeBleu = `${base}-bleu`;
  const degradeViolet = `${base}-violet`;
  const masquePrincipal = `${base}-masque-principal`;
  const masqueBarre = `${base}-masque-barre`;

  return (
    <svg
      viewBox="165 215 705 705"
      width={taille}
      height={taille}
      aria-hidden="true"
      focusable="false"
      className={`logo-anime-ensemble ${className}`}
    >
      <defs>
        <linearGradient id={degradeBleu} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14bff0" />
          <stop offset="1" stopColor="#1e7fe8" />
        </linearGradient>
        <linearGradient id={degradeViolet} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8456e8" />
          <stop offset="1" stopColor="#6b3fd4" />
        </linearGradient>
        {/* Le trait de ce masque se prolonge de l'extrémité du toit jusqu'au pied du « P » : la forme dessous apparaît à mesure. */}
        <mask id={masquePrincipal} maskUnits="userSpaceOnUse" x="165" y="215" width="705" height="705">
          <path
            className="logo-anime-trait-principal"
            pathLength="1"
            d="M205 535 L518 305 L790 500 L790 585 A100 100 0 0 1 690 685 L485 685 L485 900"
            fill="none"
            stroke="#fff"
            strokeWidth="170"
            strokeLinejoin="miter"
          />
        </mask>
        <mask id={masqueBarre} maskUnits="userSpaceOnUse" x="165" y="215" width="705" height="705">
          <path className="logo-anime-trait-barre" pathLength="1" d="M349 900 L349 505" fill="none" stroke="#fff" strokeWidth="130" />
        </mask>
      </defs>

      {/* Cheminée : posée sous le toit, qui la recouvre en bas à gauche. */}
      <rect className="logo-anime-cheminee" x="653" y="248" width="190" height="222" rx="9" fill={`url(#${degradeViolet})`} />

      {/* Toit, mur et boucle du « P » : une seule forme. */}
      <g mask={`url(#${masquePrincipal})`} className="logo-anime-principal">
        <path
          fill={`url(#${degradeBleu})`}
          d="M185 490 Q185 481 193 475 L505 245 Q518 237 531 245 L843 470 L843 580 C843 670 770 738 690 738 L538 738 L538 885 Q538 893 530 893 L440 893 Q432 893 432 885 L432 632 L665 632 C705 632 740 600 740 560 C740 530 727 508 712 497 L518 365 L238 575 L193 575 Q185 575 185 567 Z"
        />
      </g>

      {/* Petite barre de gauche, qui monte du bas. */}
      <g mask={`url(#${masqueBarre})`} className="logo-anime-barre">
        <path
          fill={`url(#${degradeBleu})`}
          d="M300 575 L385 513 Q398 508 398 520 L398 885 Q398 893 390 893 L308 893 Q300 893 300 885 Z"
        />
      </g>
    </svg>
  );
}
