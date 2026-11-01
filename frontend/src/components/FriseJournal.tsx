import { Clock, User, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { debutDeJour, libelleDuJour } from "../utils/libelleDuJour";

export interface EntreeFrise {
  id: string;
  /** Date ISO de l'action. */
  date: string;
  icone?: LucideIcon;
  /** Ce qui s'est passé, en une phrase. */
  titre: ReactNode;
  /** Précision sous le titre (texte enregistré au moment de l'action). */
  detail?: ReactNode;
  /** Qui l'a fait. */
  auteur: ReactNode;
  /** Ce sur quoi l'action a porté (un lien, par exemple). */
  cible?: ReactNode;
  /** Petite étiquette de catégorie, à droite. */
  etiquette?: string;
}

/**
 * Journal présenté en frise : un titre par jour (« Aujourd'hui », « Hier », « mercredi 28 octobre ») avec le nombre
 * d'actions, puis un rail vertical qui relie les actions de la journée, chacune dans une fiche avec son pictogramme,
 * son auteur, son étiquette et son heure. Partagé par les journaux de l'espace gestionnaire et de l'administration.
 * Les entrées sont attendues de la plus récente à la plus ancienne.
 */
export default function FriseJournal({ entrees }: { entrees: EntreeFrise[] }) {
  const { i18n } = useTranslation();
  const heure = (d: string) => new Date(d).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });

  const jours = useMemo(() => {
    const groupes: { cle: number; libelle: string; entrees: EntreeFrise[] }[] = [];
    for (const entree of entrees) {
      const cle = debutDeJour(new Date(entree.date));
      const dernier = groupes[groupes.length - 1];
      if (dernier && dernier.cle === cle) dernier.entrees.push(entree);
      else groupes.push({ cle, libelle: libelleDuJour(entree.date, i18n.language), entrees: [entree] });
    }
    return groupes;
  }, [entrees, i18n.language]);

  return (
    <div className="space-y-8">
      {jours.map((jour) => (
        <section key={jour.cle} aria-label={jour.libelle}>
          <h3 className="mb-4 flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">
            {jour.libelle}
            <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
            <span className="font-normal text-slate-600">{String(jour.entrees.length).padStart(2, "0")}</span>
          </h3>
          <ol className="ml-3 border-l border-slate-400">
            {jour.entrees.map((entree) => {
              const Icone = entree.icone ?? Clock;
              return (
                <li key={entree.id} className="relative pb-3 pl-7 last:pb-0">
                  <span aria-hidden="true" className="absolute -left-3.25 top-3 flex h-6 w-6 items-center justify-center border border-ink-900 bg-white text-ink-900">
                    <Icone size={13} />
                  </span>
                  <div className="flex flex-col gap-2 border border-slate-300 bg-white px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug text-slate-900">{entree.titre}</p>
                      {entree.detail && <p className="mt-1 text-xs leading-relaxed text-slate-700 wrap-break-word">{entree.detail}</p>}
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <User size={12} aria-hidden="true" className="shrink-0 text-orange-700" />
                          {entree.auteur}
                        </span>
                        {entree.cible}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      {entree.etiquette && (
                        <span className="border border-slate-400 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-700">
                          {entree.etiquette}
                        </span>
                      )}
                      <time dateTime={entree.date} className="font-mono text-xs tabular-nums text-slate-700">
                        {heure(entree.date)}
                      </time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
