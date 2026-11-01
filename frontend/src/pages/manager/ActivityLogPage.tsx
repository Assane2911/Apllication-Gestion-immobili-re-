import { Banknote, Building2, Clock, FileText, LayoutGrid, Receipt, Settings, ShieldCheck, Wrench, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import FriseJournal from "../../components/FriseJournal";
import Pagination from "../../components/Pagination";
import { Skeleton } from "../../components/Skeleton";
import type { ActivityLogEntry, PaginatedResponse } from "../../types";

const PAGE_SIZE = 20;

const entityTypes = ["ALL", "property", "tenant", "contract", "invoice", "issue", "expense", "agency", "insurance"] as const;

const iconByEntityType: Record<string, typeof Building2> = {
  property: Building2,
  tenant: Users,
  contract: FileText,
  invoice: Receipt,
  issue: Wrench,
  expense: Banknote,
  agency: Settings,
  insurance: ShieldCheck,
};

export default function ActivityLogPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState("ALL");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  function load(type: string, pageToLoad: number, signal?: AbortSignal) {
    setLoading(true);
    api
      .get<PaginatedResponse<ActivityLogEntry>>("/activity-log", {
        params: { page: pageToLoad, pageSize: PAGE_SIZE, ...(type !== "ALL" ? { entityType: type } : {}) },
        signal,
      })
      .then((res) => {
        setLogs(liste<ActivityLogEntry>(res.data, "items"));
        setTotal(res.data.total ?? 0);
        setTotalPages(res.data.totalPages ?? 1);
        setLoadError(null);
        setLoading(false);
      })
      // Sans ce .catch(), un échec réseau laissait logs à [] : l'utilisateur
      // voyait juste "aucune activité" sans savoir que le chargement avait
      // échoué (seule page manager dans ce cas — voir IssuesPage.tsx pour le
      // même schéma bandeau d'erreur + retry appliqué ici).
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  // Sans AbortController, changer vite de filtre (ALL -> tenant -> contract)
  // pouvait afficher les entrées d'un mauvais filtre si une réponse arrivait
  // après une autre plus récente — même schéma que MessagesPage.tsx.
  useEffect(() => {
    const controller = new AbortController();
    load(entityType, page, controller.signal);
    return () => controller.abort();
  }, [entityType, page]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.activityLog.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.activityLog.subtitle")}</p>
        {!loading && !loadError && (
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.activityLog.count", { count: total })}</p>
        )}
      </div>

      {/* Filtre par catégorie : une réglette d'onglets avec le pictogramme de chaque catégorie. */}
      <div role="group" aria-label={t("manager.activityLog.filterByType")} className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex">
        {entityTypes.map((opt) => {
          const Icone = opt === "ALL" ? LayoutGrid : iconByEntityType[opt];
          const actif = entityType === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={actif}
              onClick={() => {
                setEntityType(opt);
                setPage(1);
              }}
              className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap border-r border-slate-400 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                actif ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              <Icone size={12} aria-hidden="true" />
              {t(`manager.activityLog.filters.${opt === "ALL" ? "all" : opt}`)}
            </button>
          );
        })}
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={() => load(entityType, page)} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border border-slate-300 bg-white p-4">
              <Skeleton className="h-6 w-6" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <FriseJournal
            entrees={logs.map((log) => ({
              id: log.id,
              date: log.createdAt,
              icone: iconByEntityType[log.entityType] ?? Clock,
              titre: log.details || log.entityLabel,
              auteur: log.actorLabel,
              etiquette: log.entityLabel,
            }))}
          />

          {!loadError && logs.length === 0 && (
            <div className="border border-slate-300 bg-white">
              <EmptyState
                icon={Clock}
                title={t("manager.activityLog.emptyTitle")}
                description={t("manager.activityLog.emptyDesc")}
              />
            </div>
          )}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
