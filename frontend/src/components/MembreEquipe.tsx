import { useTranslation } from "react-i18next";
import type { TeamMember, TeamRole } from "../types";

const ROLES_EQUIPE: TeamRole[] = ["FULL", "AGENT", "ACCOUNTANT", "READ_ONLY"];

/**
 * Une ligne de la liste des collaborateurs : statut (actif, invitation envoyée ou expirée), rôle, révocation, et —
 * pour une invitation pas encore acceptée — le renvoi du lien (voir POST /team/:id/resend).
 */
export default function MembreEquipe({
  member,
  onChangeRole,
  onRemove,
  onResend,
}: {
  member: TeamMember;
  onChangeRole: (member: TeamMember, role: TeamRole) => void;
  onRemove: (member: TeamMember) => void;
  onResend: (member: TeamMember) => void;
}) {
  const { t } = useTranslation();
  const enAttente = member.status === "PENDING";

  return (
    <li className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{member.email}</p>
        <p
          className={`text-xs ${
            member.expired ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-slate-600 dark:text-slate-400"
          }`}
        >
          {!enAttente
            ? t("manager.agencySettings.team.statusActive")
            : member.expired
              ? t("manager.agencySettings.team.statusExpired")
              : t("manager.agencySettings.team.statusPending")}
        </p>
      </div>
      <select
        aria-label={t("manager.agencySettings.team.roleAria", { email: member.email })}
        value={member.role}
        onChange={(e) => onChangeRole(member, e.target.value as TeamRole)}
        className="text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-2 py-1.5"
      >
        {ROLES_EQUIPE.map((r) => (
          <option key={r} value={r}>
            {t(`manager.agencySettings.team.roles.${r}.label`)}
          </option>
        ))}
      </select>
      {enAttente && (
        <button
          type="button"
          onClick={() => onResend(member)}
          aria-label={t("manager.agencySettings.team.resendAria", { email: member.email })}
          className="text-brand-700 dark:text-brand-400 hover:underline text-xs font-semibold"
        >
          {t("manager.agencySettings.team.resendButton")}
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(member)}
        className="text-red-600 dark:text-red-400 hover:underline text-xs font-semibold"
      >
        {t("manager.agencySettings.team.removeButton")}
      </button>
    </li>
  );
}
