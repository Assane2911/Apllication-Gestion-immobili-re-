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

export default function PlanLogement({ id, className = "" }: { id: string; className?: string }) {
  const rang = [...id].reduce((somme, c) => somme + c.charCodeAt(0), 0) % PLANS.length;
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
