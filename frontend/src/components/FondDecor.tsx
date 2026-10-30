/**
 * Fond de l'application, dessiné (aucune photo : pas de droit d'auteur, aucun poids d'image) : la lumière du jour
 * qui entre par de grandes fenêtres, légèrement floue, comme une photo d'intérieur. Fixé derrière la page : il reste en place quand le contenu défile. Purement décoratif.
 */
export default function FondDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-linear-to-b from-slate-200 via-slate-100 to-white dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="absolute -top-40 -right-24 h-152 w-152 rounded-full bg-sky-200/60 blur-3xl dark:bg-brand-900/30" />
      <div className="absolute top-1/3 -left-32 h-112 w-md rounded-full bg-brand-200/50 blur-3xl dark:bg-indigo-900/30" />
      <svg className="absolute inset-0 h-full w-full opacity-60 blur-[3px] dark:opacity-15" viewBox="0 0 1200 760" preserveAspectRatio="xMaxYMid slice">
        <defs>
          <linearGradient id="accueil-vitre" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#bae6fd" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="accueil-rayon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* La grande fenêtre de droite : quatre vitres derrière un cadre clair */}
        <g transform="translate(700 40)">
          <rect width="440" height="640" rx="10" fill="#e2e8f0" />
          {[0, 1].flatMap((colonne) =>
            [0, 1].map((ligne) => (
              <rect key={`${colonne}-${ligne}`} x={16 + colonne * 214} y={16 + ligne * 312} width="196" height="296" rx="4" fill="url(#accueil-vitre)" stroke="#94a3b8" strokeOpacity="0.5" />
            )),
          )}
        </g>
        {/* Un encadrement de porte à gauche, dans l'ombre */}
        <g transform="translate(60 120)">
          <rect width="170" height="560" rx="6" fill="#cbd5e1" fillOpacity="0.7" />
          <rect x="18" y="18" width="134" height="524" rx="3" fill="#e2e8f0" />
          <rect x="112" y="280" width="26" height="8" rx="4" fill="#64748b" fillOpacity="0.6" />
        </g>
        {/* Le rayon de lumière qui traverse la pièce */}
        <polygon points="520,0 760,0 380,760 140,760" fill="url(#accueil-rayon)" />
      </svg>
    </div>
  );
}
