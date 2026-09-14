import { Copy } from "lucide-react";
import { useState } from "react";

interface BankDetailsProps {
  info: { iban: string | null; bic: string | null } | null;
  title: string;
  ibanLabel: string;
  bicLabel: string;
  missingMessage: string;
  copyLabel: string;
  copiedLabel: string;
}

/**
 * Coordonnées bancaires affichées à qui doit faire un virement : celles d'une
 * agence pour son locataire (TenantInvoicesPage.tsx), ou celles de la
 * plateforme pour un gestionnaire qui règle son abonnement (SubscriptionPage.tsx).
 * Sans elles, déclarer un virement ne dit nulle part vers quel compte
 * l'envoyer — la déclaration masquerait alors l'absence réelle de paiement
 * plutôt que de la résoudre. Les libellés sont des props plutôt que des clés
 * i18n : les deux pages qui l'utilisent n'ont ni le même espace de noms de
 * traduction, ni le même vocabulaire (« agence » vs « plateforme »).
 */
export default function BankDetails({ info, title, ibanLabel, bicLabel, missingMessage, copyLabel, copiedLabel }: BankDetailsProps) {
  const [copied, setCopied] = useState<"iban" | "bic" | null>(null);

  if (!info || (!info.iban && !info.bic)) {
    return (
      <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
        {missingMessage}
      </p>
    );
  }

  async function copier(champ: "iban" | "bic", valeur: string) {
    try {
      await navigator.clipboard.writeText(valeur);
      setCopied(champ);
      setTimeout(() => setCopied((c) => (c === champ ? null : c)), 1500);
    } catch {
      // Environnement sans presse-papiers (permission refusée, contexte non
      // sécurisé) : la valeur reste affichée et copiable à la main, ce n'est
      // pas une raison de faire échouer l'affichage des coordonnées.
    }
  }

  function ligne(champ: "iban" | "bic", label: string, valeur: string) {
    return (
      <div className="flex items-center justify-between gap-2 mt-1.5 first:mt-0">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</p>
          <p className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">{valeur}</p>
        </div>
        <button
          type="button"
          onClick={() => copier(champ, valeur)}
          className="shrink-0 text-[10px] font-semibold text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-brand-50 dark:hover:bg-brand-500/10 cursor-pointer"
        >
          <Copy size={11} />
          {copied === champ ? copiedLabel : copyLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5">
      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">{title}</p>
      {info.iban && ligne("iban", ibanLabel, info.iban)}
      {info.bic && ligne("bic", bicLabel, info.bic)}
    </div>
  );
}
