import { Send } from "lucide-react";

const LONGUEUR_MAX = 5000;

interface Props {
  valeur: string;
  onChange: (valeur: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  envoi: boolean;
  libelleChamp: string;
  libelleEnvoyer: string;
  libelleEnvoi: string;
  indice: string;
}

/**
 * Saisie d'un message : zone de deux lignes, compteur de caractères, bouton d'envoi. Entrée envoie, Maj+Entrée passe à la
 * ligne (sauf pendant une composition au clavier virtuel). Commune aux messageries du gestionnaire et du locataire.
 */
export default function ZoneDeSaisie({ valeur, onChange, onSubmit, envoi, libelleChamp, libelleEnvoyer, libelleEnvoi, indice }: Props) {
  return (
    <form onSubmit={onSubmit} className="border-t border-slate-300 bg-white p-4">
      <textarea
        rows={2}
        aria-label={libelleChamp}
        placeholder={libelleChamp}
        value={valeur}
        maxLength={LONGUEUR_MAX}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!envoi && valeur.trim()) e.currentTarget.form?.requestSubmit();
          }
        }}
        className="block w-full resize-none border border-slate-400 bg-white px-4 py-2.5 text-xs text-slate-900"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="hidden font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:block">{indice}</p>
        <div className="ml-auto flex items-center gap-3">
          <span className={`font-mono text-[10px] tabular-nums ${valeur.length > LONGUEUR_MAX - 500 ? "text-rose-700" : "text-slate-500"}`}>
            {valeur.length} / {LONGUEUR_MAX}
          </span>
          <button
            type="submit"
            disabled={envoi || !valeur.trim()}
            className="inline-flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-ink-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            <Send size={13} aria-hidden="true" />
            {envoi ? libelleEnvoi : libelleEnvoyer}
          </button>
        </div>
      </div>
    </form>
  );
}
