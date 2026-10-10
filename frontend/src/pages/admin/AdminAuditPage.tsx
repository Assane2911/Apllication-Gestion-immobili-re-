import { ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";

const ACTIONS = [
  "subscription.bank_transfer.confirm",
  "subscription.bank_transfer.reject",
  "platform.bank_details.update",
  "manager.suspend",
  "manager.reactivate",
  "subscription.grant_days",
  "subscription.change_plan",
] as const;

interface AuditEntry {
  id: string;
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  targetLabel: string | null;
  details: string | null;
  createdAt: string;
}

interface Page {
  items: AuditEntry[];
  page: number;
  totalPages: number;
  total: number;
}

/**
 * Journal d'audit de l'administration : qui a confirmé un virement, rejeté une
 * demande ou modifié les coordonnées bancaires de la plateforme, et quand. Une
 * LECTURE seule — une trace qu'on pourrait modifier n'en serait pas une.
 *
 * Le détail est affiché tel qu'enregistré (en français) : c'est le texte écrit
 * au moment de l'action, pas une interface à traduire. Le type d'action, lui,
 * est traduit ; une action inconnue (version plus récente du serveur) reste
 * lisible sous sa clé brute.
 */
export default function AdminAuditPage() {
  const { t, i18n } = useTranslation();
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<Page>("/admin/audit-logs", { params: { page, ...(action && { action }) } })
      .then((res) => {
        if (vivant) setDonnees(res.data);
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [page, action]);

  const libelleAction = (valeur: string) =>
    (ACTIONS as readonly string[]).includes(valeur) ? t(`admin.audit.actions.${valeur}`) : valeur;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t("admin.audit.title")}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("admin.audit.subtitle")}</p>
      </div>

      <select
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        aria-label={t("admin.audit.filterLabel")}
        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
      >
        <option value="">{t("admin.audit.allActions")}</option>
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {t(`admin.audit.actions.${a}`)}
          </option>
        ))}
      </select>

      {erreur && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{t("admin.audit.errorTitle")}</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{erreur}</p>
        </div>
      )}

      {chargement && !donnees && <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.audit.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState icon={ScrollText} title={t("admin.audit.emptyTitle")} description={t("admin.audit.emptyDescription")} />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3 font-semibold">{t("admin.audit.table.date")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.audit.table.admin")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.audit.table.action")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.audit.table.target")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.audit.table.details")}</th>
                </tr>
              </thead>
              <tbody className="text-slate-800 dark:text-slate-200">
                {donnees.items.map((e) => (
                  <tr key={e.id} className="border-b last:border-b-0 border-slate-100 dark:border-slate-800/60 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(e.createdAt).toLocaleString(i18n.language)}</td>
                    <td className="px-4 py-3">{e.adminEmail}</td>
                    <td className="px-4 py-3 font-semibold">{libelleAction(e.action)}</td>
                    <td className="px-4 py-3">
                      {e.targetUserId ? (
                        <Link
                          to={`/admin/gestionnaires/${e.targetUserId}`}
                          className="text-brand-700 dark:text-brand-400 hover:underline"
                        >
                          {e.targetLabel ?? e.targetUserId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 break-words min-w-[12rem]">{e.details ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={donnees.page} totalPages={donnees.totalPages} total={donnees.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
