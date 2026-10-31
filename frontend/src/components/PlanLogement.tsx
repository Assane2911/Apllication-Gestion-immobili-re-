/**
 * Petit plan de logement, dessiné, qui tient la place d'une photo absente : une des quatre dispositions est choisie à
 * partir d'un identifiant, pour que chaque bien garde toujours le même plan. Décoratif (aucun texte).
 */
const PLANS = [
  "M2 2H110V82H2Z M2 42H56 M56 2V82 M56 56H110",
  "M2 2H110V82H2Z M40 2V52 M40 52H110 M72 52V82",
  "M2 2H110V82H2Z M68 2V40 M68 40H110",
  "M2 2H110V82H2Z M2 28H110 M34 28V82 M72 28V82",
] as const;

function rangDuPlan(id: string): number {
  return [...id].reduce((somme, c) => somme + c.charCodeAt(0), 0) % PLANS.length;
}

/** Miniature du plan d'un bien, à poser devant son nom dans les tableaux et les cartes. Décorative. */
export function PlanMiniature({ id, className = "" }: { id: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="26"
      height="20"
      viewBox="0 0 112 84"
      fill="none"
      className={`inline-block shrink-0 text-ink-900 ${className}`}
    >
      <path d={PLANS[rangDuPlan(id)]} stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
    </svg>
  );
}

/** Nom d'un bien précédé de son petit plan ; ne rend rien si le bien n'a pas de nom. */
export function NomDuBien({ titre, id, className = "" }: { titre?: string | null; id?: string | null; className?: string }) {
  if (!titre) return null;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <PlanMiniature id={id || titre} />
      <span className="min-w-0">{titre}</span>
    </span>
  );
}

export default function PlanLogement({ id, className = "" }: { id: string; className?: string }) {
  const rang = rangDuPlan(id);
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center text-ink-900 ${className}`}
      style={{
        backgroundImage: "linear-gradient(rgb(15 61 94 / 0.08) 1px, transparent 1px), linear-gradient(90deg, rgb(15 61 94 / 0.08) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}
    >
      <svg width="112" height="84" viewBox="0 0 112 84" fill="none">
        <path d={PLANS[rang]} stroke="currentColor" strokeWidth="2" />
        <path d="M20 2V0M76 82V84" stroke="#d9480f" strokeWidth="3" />
      </svg>
    </div>
  );
}
