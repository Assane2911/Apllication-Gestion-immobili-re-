import { Building2, Clock, FileText, Receipt, Wrench, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import { TableRowSkeleton } from "../../components/Skeleton";
import type { ActivityLogEntry } from "../../types";

const entityTypeOptions: { value: string; label: string }[] = [
  { value: "ALL", label: "Toutes les catégories" },
  { value: "property", label: "Biens" },
  { value: "tenant", label: "Locataires" },
  { value: "contract", label: "Contrats" },
  { value: "invoice", label: "Factures" },
  { value: "issue", label: "Incidents" },
];

const iconByEntityType: Record<string, typeof Building2> = {
  property: Building2,
  tenant: Users,
  contract: FileText,
  invoice: Receipt,
  issue: Wrench,
};

function formatDateTime(d: string) {
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState("ALL");

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
          <h2 className="text-2xl font-semibold text-slate-900">Journal d'activité</h2>
          <p className="text-sm text-slate-500 mt-1">
            Historique des actions effectuées sur vos biens, locataires, contrats et paiements
          </p>
        </div>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white shadow-sm"
        >
          {entityTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Quand</th>
              <th className="px-4 py-3 font-medium">Qui</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <TableRowSkeleton key={i} columns={4} />)
            ) : (
              logs.map((log) => {
                const Icon = iconByEntityType[log.entityType] ?? Clock;
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{log.actorLabel}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Icon size={12} />
                        {log.entityLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{log.details}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {!loading && logs.length === 0 && (
          <EmptyState
            icon={Clock}
            title="Aucune activité pour l'instant"
            description="Chaque action (ajout d'un bien, renouvellement de contrat, paiement validé...) apparaîtra ici avec la date et l'auteur."
          />
        )}
      </div>
    </div>
  );
}
