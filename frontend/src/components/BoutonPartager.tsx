import { Check, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Bouton « Partager ». Sur téléphone (et partout où le navigateur sait le faire), il ouvre le menu de partage du
 * système : WhatsApp, SMS, e-mail… Ailleurs, il copie le lien et le dit. Fermer le menu de partage sans rien choisir
 * n'est pas une erreur : on ne montre alors rien.
 */
export default function BoutonPartager({
  url,
  titre,
  texte,
  className = "",
}: {
  url: string;
  titre: string;
  texte?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copie, setCopie] = useState(false);
  const minuterie = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(minuterie.current), []);

  async function partager() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: titre, text: texte, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Partage refusé ou indisponible : on retombe sur la copie du lien.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopie(true);
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => setCopie(false), 2000);
    } catch {
      // Ni partage ni presse-papiers (contexte non sécurisé) : le lien reste visible et copiable à la main.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={partager}
        className={`inline-flex shrink-0 items-center gap-1.5 border-[1.5px] border-ink-900 px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-100 cursor-pointer ${className}`}
      >
        {copie ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
        {copie ? t("common.actions.linkCopied") : t("common.actions.share")}
      </button>
      <span role="status" className="sr-only">{copie ? t("common.actions.linkCopied") : ""}</span>
    </>
  );
}
