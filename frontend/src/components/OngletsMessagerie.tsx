import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

const ONGLETS = [
  { cle: "tenants", vers: "/messages" },
  { cle: "owners", vers: "/messages/proprietaires" },
] as const;

/**
 * Bascule entre les deux messageries du gestionnaire : celle des locataires (un fil par bail) et celle des propriétaires
 * (un fil par propriétaire). Deux adresses distinctes plutôt qu'un état interne : le lien d'une notification ou d'un
 * favori ouvre directement la bonne.
 */
export default function OngletsMessagerie() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("manager.messages.tabs.label")} className="flex w-fit border border-ink-900">
      {ONGLETS.map((onglet) => (
        <NavLink
          key={onglet.cle}
          to={onglet.vers}
          end
          className={({ isActive }) =>
            `border-r border-ink-900 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 ${
              isActive ? "bg-ink-900 text-white" : "bg-white text-ink-900 hover:bg-slate-100"
            }`
          }
        >
          {t(`manager.messages.tabs.${onglet.cle}`)}
        </NavLink>
      ))}
    </nav>
  );
}
