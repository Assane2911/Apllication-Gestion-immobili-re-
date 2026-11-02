/**
 * Classes communes des formulaires en fenêtre modale (charte Plan D : angles droits, traits nets, libellés en police
 * technique, encre et orange). Les pages de réglages portent les mêmes valeurs ; les centraliser ici évite qu'une
 * fenêtre dérive de l'autre.
 */
export const CHAMP = "w-full border border-slate-400 bg-white px-3.5 py-2 text-sm text-slate-900";
export const ETIQUETTE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
export const AIDE = "mt-1 text-xs text-slate-600";

export const BOUTON_PLEIN =
  "cursor-pointer border border-ink-900 bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60";
export const BOUTON_TRAIT =
  "cursor-pointer border border-slate-400 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60";
export const BOUTON_DANGER =
  "cursor-pointer border border-rose-700 bg-rose-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60";
export const BOUTON_ANNULER =
  "cursor-pointer border-b border-ink-900/40 px-1 py-1 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 disabled:opacity-60";

/** Avis à lire avant de valider : filet orange à gauche. */
export const AVIS = "border border-orange-700/40 bg-orange-50 px-3 py-2 text-xs text-orange-900 shadow-[inset_3px_0_0_var(--color-orange-700)]";
/** Information neutre : filet encre à gauche. */
export const INFO = "border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800 shadow-[inset_3px_0_0_var(--color-ink-900)]";
export const ERREUR = "border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 shadow-[inset_3px_0_0_var(--color-rose-600)]";
