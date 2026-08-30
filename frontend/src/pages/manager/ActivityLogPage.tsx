import { Building2, Clock, FileText, Receipt, Wrench, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import { TableRowSkeleton } from "../../components/Skeleton";
import type { ActivityLogEntry } from "../../types";

const entityTypes = ["ALL", "property", "tenant", "contract", "invoice", "issue"] as const;

const iconByEntityType: Record<string, typeof Building2> = {
  property: Building2,
  tenant: Users,
  contract: FileText,
  invoice: Receipt,
  issue: Wrench,
};

export default function ActivityLogPage() {
  const { t, i18n } = useTranslation();
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState("ALL");

  function formatDateTime(d: string) {
    return new Date(d).toLocaleString(i18n.language, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function load(type: string) {
    setLoading(true);
    api
      .get<ActivityLogEntry[]>("/activity-log", {
        params: type !== "ALL" ? { entityType: type } : {},
      })
      .then((res) => setLogs(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => load(entityType), [entityType]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.activityLog.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t("manager.activityLog.subtitle")}
          </p>
        </div>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
        >
          {entityTypes.map((opt) => (
            <option key={opt} value={opt}>
              {t(`manager.activityLog.filters.${opt === "ALL" ? "all" : opt}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.activityLog.table.when")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.activityLog.table.who")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.activityLog.table.category")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.activityLog.table.detail")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <TableRowSkeleton key={i} columns={4} />)
            ) : (
              logs.map((log) => {
                const Icon = iconByEntityType[log.entityType] ?? Clock;
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 text-xs">{log.actorLabel}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-full">
                        <Icon size={12} />
                        {log.entityLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{log.details}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {!loading && logs.length === 0 && (
          <EmptyState
            icon={Clock}
            title={t("manager.activityLog.emptyTitle")}
            description={t("manager.activityLog.emptyDesc")}
          />
        )}
      </div>
    </div>
  );
}
