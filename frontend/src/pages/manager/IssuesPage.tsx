import { useEffect, useState } from "react";
import { api, apiErrorMessage, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import type { IssueReport, IssueStatus } from "../../types";

const statusOptions: IssueStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];

export default function IssuesPage() {
  const [issues, setIssues] = useState<IssueReport[]>([]);
  const [filter, setFilter] = useState<IssueStatus | "ALL">("ALL");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  function load() {
    api.get<IssueReport[]>("/issues").then((res) => setIssues(res.data));
  }

  useEffect(load, []);

  async function updateStatus(issue: IssueReport, status: IssueStatus) {
    try {
      await api.put(`/issues/${issue.id}/status`, { status, managerNote: notes[issue.id] ?? issue.managerNote ?? undefined });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  const filtered = filter === "ALL" ? issues : issues.filter((i) => i.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Signalements d'incidents</h2>
          <p className="text-sm text-slate-500 mt-1">Problèmes signalés par les locataires, avec photo</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as IssueStatus | "ALL")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="ALL">Tous les statuts</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((issue) => (
          <div key={issue.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <button onClick={() => setLightbox(fileUrl(issue.photoUrl))} className="block w-full h-48 bg-slate-100">
              <img src={fileUrl(issue.photoUrl) ?? undefined} alt={issue.title} className="w-full h-full object-cover" />
            </button>
            <div className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-slate-900">{issue.title}</h4>
                <Badge status={issue.status} />
              </div>
              <p className="text-sm text-slate-600">{issue.description}</p>
              <p className="text-xs text-slate-400">
                {issue.tenant?.firstName} {issue.tenant?.lastName} · {issue.contract?.property?.title} ·{" "}
                {new Date(issue.createdAt).toLocaleDateString("fr-FR")}
              </p>
              <textarea
                placeholder="Note interne (optionnel)"
                defaultValue={issue.managerNote ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [issue.id]: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                rows={2}
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {statusOptions.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(issue, s)}
                    disabled={issue.status === s}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      issue.status === s ? "bg-slate-100 text-slate-400 border-slate-200" : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Badge status={s} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-slate-400 text-sm col-span-2 text-center py-8">Aucun signalement pour ce filtre</p>}
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 cursor-zoom-out">
          <img src={lightbox} alt="Photo agrandie" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
