import { CreditCard, Download, Landmark, Megaphone, ScrollText, UserCog, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import BoutonExportCsv from "../../components/BoutonExportCsv";
import EmptyState from "../../components/EmptyState";
import FriseJournal from "../../components/FriseJournal";
import Pagination from "../../components/Pagination";

const ACTIONS = [
  "subscription.bank_transfer.confirm",
  "subscription.bank_transfer.reject",
  "platform.bank_details.update",
  "manager.suspend",
  "manager.reactivate",
  "manager.delete",
  "subscription.grant_days",
  "subscription.change_plan",
  "subscription.grant_unlimited",
  "subscription.revoke_unlimited",
  "listing.hide",
  "listing.restore",
  "listing.feature",
  "listing.unfeature",
  "export.managers",
  "export.audit",
] as const;

/** Pictogramme d'une action d'après sa famille (le mot avant le premier point). */
const ICONE_PAR_FAMILLE: Record<string, LucideIcon> = {
  subscription: CreditCard,
  platform: Landmark,
  manager: UserCog,
  listing: Megaphone,
  export: Download,
};

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
  const { t } = useTranslation();
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
        <h2 className="text-xl font-bold text-slate-900">{t("admin.audit.title")}</h2>
        <p className="mt-1 text-xs text-slate-600">{t("admin.audit.subtitle")}</p>
        {donnees && !erreur && (
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("admin.audit.count", { count: donnees.total })}</p>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          aria-label={t("admin.audit.filterLabel")}
          className="border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">{t("admin.audit.allActions")}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`admin.audit.actions.${a}`)}
            </option>
          ))}
        </select>
        <BoutonExportCsv chemin="/admin/exports/audit-logs.csv" params={action ? { action } : undefined} prefixeFichier="journal-audit" />
      </div>

      {erreur && (
        <div className="border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t("admin.audit.errorTitle")}</p>
          <p role="alert" className="text-xs text-red-700 mt-0.5">{erreur}</p>
        </div>
      )}

      {chargement && !donnees && <p className="text-xs text-slate-600">{t("admin.audit.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState icon={ScrollText} title={t("admin.audit.emptyTitle")} description={t("admin.audit.emptyDescription")} />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <FriseJournal
            entrees={donnees.items.map((e) => ({
              id: e.id,
              date: e.createdAt,
              icone: ICONE_PAR_FAMILLE[e.action.split(".")[0]] ?? ScrollText,
              titre: libelleAction(e.action),
              detail: e.details ?? undefined,
              auteur: e.adminEmail,
              cible: e.targetUserId ? (
                <Link
                  to={`/admin/gestionnaires/${e.targetUserId}`}
                  className="border-b border-ink-900/40 font-medium text-ink-900 hover:border-orange-700 hover:text-orange-700"
                >
                  {e.targetLabel ?? e.targetUserId}
                </Link>
              ) : undefined,
            }))}
          />

          <Pagination page={donnees.page} totalPages={donnees.totalPages} total={donnees.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
