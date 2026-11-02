import { Wrench, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { EtatMaintenance } from "../utils/maintenance";

interface Props {
  etat: EtatMaintenance;
  /** La maintenance a commencé : seul l'administrateur voit encore l'application, avec ce bandeau. */
  enCours: boolean;
}

const cleFermeture = (etat: EtatMaintenance) => `maintenance-annoncee:${etat.debut}`;

function dejaFermee(etat: EtatMaintenance): boolean {
  try {
    return sessionStorage.getItem(cleFermeture(etat)) === "1";
  } catch {
    return false;
  }
}

/**
 * Bandeau de maintenance, en bas à gauche :
 *  - avant le début (dans les 24 h) : l'annonce, avec les horaires — l'utilisateur a le temps d'enregistrer son travail. Il se ferme
 *    pour la durée de la session (et reparaît à la prochaine) ;
 *  - pendant la maintenance : rappel à l'administrateur, qui garde l'accès pendant que les autres voient l'écran de maintenance.
 */
export default function BandeauMaintenance({ etat, enCours }: Props) {
  const { t, i18n } = useTranslation();
  const [fermee, setFermee] = useState(() => !enCours && dejaFermee(etat));
  if (fermee && !enCours) return null;

  const format = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  function fermer() {
    try {
      sessionStorage.setItem(cleFermeture(etat), "1");
    } catch {
      /* la fermeture ne vaut alors que pour cet affichage */
    }
    setFermee(true);
  }

  return (
    <aside
      role="status"
      aria-label={enCours ? t("maintenance.banner.activeTitle") : t("maintenance.banner.plannedTitle")}
      className="fixed inset-x-4 bottom-24 z-[55] border border-ink-900 bg-ink-900 p-4 text-white shadow-[4px_4px_0_var(--color-orange-700)] sm:inset-x-auto sm:bottom-4 sm:left-20 sm:w-[26rem]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">
          <Wrench size={14} aria-hidden="true" className="mr-2 inline align-[-2px] text-orange-300" />
          {enCours ? t("maintenance.banner.activeTitle") : t("maintenance.banner.plannedTitle")}
        </p>
        {!enCours && (
          <button type="button" onClick={fermer} aria-label={t("maintenance.banner.dismiss")} className="-mr-1 -mt-1 cursor-pointer p-1 text-white/70 hover:text-white">
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {enCours ? (
        <>
          <p className="mt-1 text-xs text-white/80">{t("maintenance.banner.activeAdmin")}</p>
          <Link to="/admin/parametres" className="mt-3 inline-block border-b border-white/50 text-xs font-semibold text-white hover:border-white">
            {t("maintenance.banner.manage")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs font-semibold tabular-nums text-white">{t("maintenance.banner.when", { debut: format(etat.debut), fin: format(etat.fin) })}</p>
          {etat.message && <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-xs text-white/90">{etat.message}</p>}
          <p className="mt-1.5 text-xs text-white/80">{t("maintenance.banner.hint")}</p>
        </>
      )}
    </aside>
  );
}
