import type { ReactNode } from "react";

/**
 * Une section d'une page de réglages : un bandeau d'en-tête avec le numéro de la rubrique (repère du sommaire) et son
 * titre en police technique, puis le contenu. `danger` teinte le bandeau en rouge pour la zone de suppression.
 * L'ancre `id` est la cible du sommaire ; `scroll-mt` garde le bandeau visible une fois la page défilée jusqu'à lui.
 */
export default function SectionReglage({
  id,
  idTitre,
  numero,
  titre,
  danger = false,
  children,
}: {
  id: string;
  idTitre?: string;
  numero: string;
  titre: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  const titreId = idTitre ?? `${id}-titre`;
  return (
    <section id={id} aria-labelledby={titreId} className={`scroll-mt-6 border bg-white ${danger ? "border-rose-300" : "border-slate-300"}`}>
      <header className={`flex items-baseline gap-3 border-b px-5 py-3 ${danger ? "border-rose-300 bg-rose-50" : "border-slate-300 bg-slate-50"}`}>
        <span aria-hidden="true" className={`font-mono text-[11px] font-semibold ${danger ? "text-rose-700" : "text-orange-700"}`}>
          {numero}
        </span>
        <h3 id={titreId} className={`font-mono text-xs font-semibold uppercase tracking-wider ${danger ? "text-rose-800" : "text-ink-900"}`}>
          {titre}
        </h3>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
