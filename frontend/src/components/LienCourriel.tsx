import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface LienCourrielProps {
  adresse: string;
  /** Style du lien (la couleur, le soulignement…) : le composant ne pose que la mise en ligne. */
  className?: string;
  /** Infobulle du lien (« Écrire à Awa Diop »). */
  titre?: string;
}

/**
 * Une adresse e-mail affichée avec un lien d'écriture ET un bouton « Copier ».
 *
 * Un lien « mailto: » seul ne fait rien quand le poste n'a pas de messagerie configurée (courant avec une messagerie web) : le clic
 * n'ouvre rien et n'explique rien. Le bouton marche partout, et dit s'il n'a pas pu copier (autorisation refusée, page non sécurisée)
 * au lieu de rester muet à son tour.
 */
export default function LienCourriel({ adresse, className = "", titre }: LienCourrielProps) {
  const { t } = useTranslation();
  const [etat, setEtat] = useState<"copie" | "echec" | null>(null);
  const minuterie = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(minuterie.current), []);

  async function copier() {
    try {
      await navigator.clipboard.writeText(adresse);
      setEtat("copie");
    } catch {
      setEtat("echec");
    }
    window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => setEtat(null), 2500);
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <a href={`mailto:${adresse}`} title={titre} className={`min-w-0 truncate ${className}`}>
        {adresse}
      </a>
      <button
        type="button"
        onClick={() => void copier()}
        aria-label={t("common.emailLink.copyAria", { adresse })}
        // size-6 : cible de 24 px (WCAG 2.5.8) ; -my-1 : elle déborde de 4 px de chaque côté sans agrandir la ligne ni la carte.
        className="inline-flex size-6 shrink-0 -my-1 cursor-pointer items-center justify-center text-slate-500 transition-colors hover:text-orange-700"
      >
        {etat === "copie" ? <Check size={13} aria-hidden="true" className="text-emerald-700" /> : <Copy size={13} aria-hidden="true" />}
      </button>
      <span role="status" className={etat === "echec" ? "text-xs font-semibold text-red-700" : "sr-only"}>
        {etat === "copie" ? t("common.emailLink.copied") : etat === "echec" ? t("common.emailLink.copyFailed") : ""}
      </span>
    </span>
  );
}
