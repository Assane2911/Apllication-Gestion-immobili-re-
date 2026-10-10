import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { STATUS_CLASSES, SUSPENDED_CLASS, type ManagerPlan, type ManagerStatus } from "./managerStatus";

interface ManagerRow {
  id: string;
  email: string;
  agencyName: string | null;
  plan: ManagerPlan;
  status: ManagerStatus;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  suspendedAt: string | null;
  propertiesCount: number;
  tenantsCount: number;
  createdAt: string;
}

interface Page {
  items: ManagerRow[];
  page: number;
  totalPages: number;
  total: number;
}

/**
 * Liste des gestionnaires (comptes agence) : recherche par email ou nom
 * d'agence, filtres formule / statut. Le statut affiché est celui CALCULÉ par
 * le serveur (un essai échu apparaît « Expiré » même si la base dit encore
 * « Essai »).
 */
export default function AdminManagersPage() {
  const { t, i18n } = useTranslation();
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [plan, setPlan] = useState("");
  const [statut, setStatut] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  // Anti-rebond : on n'interroge le serveur qu'une fois la frappe terminée.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      setRecherche(saisie.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<Page>("/admin/managers", {
        params: { page, ...(recherche && { search: recherche }), ...(plan && { plan }), ...(statut && { status: statut }) },
      })
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
  }, [page, recherche, plan, statut]);

  const champ =
    "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100";

  function echeance(m: ManagerRow) {
    const date = m.status === "TRIAL" ? m.trialEndsAt : m.subscriptionEndsAt ?? m.trialEndsAt;
    return date ? new Date(date).toLocaleDateString(i18n.language) : "—";
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t("admin.managers.title")}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("admin.managers.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={t("admin.managers.searchPlaceholder")}
          aria-label={t("admin.managers.searchLabel")}
          maxLength={100}
          className={`${champ} flex-1 min-w-[14rem]`}
        />
        <select
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            setPage(1);
          }}
          aria-label={t("admin.managers.planFilter")}
          className={champ}
        >
          <option value="">{t("admin.managers.allPlans")}</option>
          {(["STARTER", "PRO", "ENTERPRISE"] as const).map((p) => (
            <option key={p} value={p}>
              {t(`admin.managers.plans.${p}`)}
            </option>
          ))}
        </select>
        <select
          value={statut}
          onChange={(e) => {
            setStatut(e.target.value);
            setPage(1);
          }}
          aria-label={t("admin.managers.statusFilter")}
          className={champ}
        >
          <option value="">{t("admin.managers.allStatuses")}</option>
          {(["TRIAL", "ACTIVE", "CANCELLED", "EXPIRED", "SUSPENDED"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`admin.managers.statuses.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {erreur && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{t("admin.managers.errorTitle")}</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{erreur}</p>
        </div>
      )}

      {chargement && !donnees && <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.managers.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState icon={Users} title={t("admin.managers.emptyTitle")} description={t("admin.managers.emptyDescription")} />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-3 font-semibold">{t("admin.managers.table.manager")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.managers.table.plan")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.managers.table.status")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.managers.table.deadline")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.managers.table.usage")}</th>
                  <th className="px-4 py-3 font-semibold">{t("admin.managers.table.signup")}</th>
                </tr>
              </thead>
              <tbody className="text-slate-800 dark:text-slate-200">
                {donnees.items.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0 border-slate-100 dark:border-slate-800/60">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/gestionnaires/${m.id}`}
                        className="font-semibold text-brand-700 dark:text-brand-400 hover:underline"
                      >
                        {m.agencyName ?? t("admin.managers.noAgencyName")}
                      </Link>
                      <p className="text-slate-600 dark:text-slate-400">{m.email}</p>
                    </td>
                    <td className="px-4 py-3">{t(`admin.managers.plans.${m.plan}`)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 font-semibold ${STATUS_CLASSES[m.status]}`}>
                        {t(`admin.managers.statuses.${m.status}`)}
                      </span>
                      {m.suspendedAt && (
                        <span className={`ml-1 inline-block rounded-full px-2 py-0.5 font-semibold ${SUSPENDED_CLASS}`}>
                          {t("admin.managers.statuses.SUSPENDED")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{echeance(m)}</td>
                    <td className="px-4 py-3">
                      {t("admin.managers.usage", { properties: m.propertiesCount, tenants: m.tenantsCount })}
                    </td>
                    <td className="px-4 py-3">{new Date(m.createdAt).toLocaleDateString(i18n.language)}</td>
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
