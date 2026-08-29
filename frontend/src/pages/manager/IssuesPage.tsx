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
      await api.put(`/issues/${issue.id}/status`, {
        status,
        managerNote: notes[issue.id] ?? issue.managerNote ?? undefined,
      });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  function getAllPhotos(issue: IssueReport): string[] {
    const list = [issue.photoUrl];
    if (issue.additionalPhotos) {
      try {
        const extra = JSON.parse(issue.additionalPhotos);
        if (Array.isArray(extra)) {
          list.push(...extra);
        }
      } catch {}
    }
    return list;
  }

  const filtered = filter === "ALL" ? issues : issues.filter((i) => i.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Signalements d'incidents & Photos</h2>
          <p className="text-sm text-slate-500 mt-1">
            Inspection visuelle des incidents photographiés par les locataires
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as IssueStatus | "ALL")}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white shadow-sm"
        >
          <option value="ALL">Tous les statuts</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map((issue) => {
          const allPhotos = getAllPhotos(issue);
          return (
            <div key={issue.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
              <div>
                {/* Galerie photos */}
                <div className="bg-slate-900 p-3 flex gap-2 overflow-x-auto">
                  {allPhotos.map((url, idx) => (
                    <div
                      key={idx}
                      onClick={() => setLightbox(fileUrl(url))}
                      className="relative h-44 w-52 shrink-0 rounded-xl overflow-hidden cursor-zoom-in border border-slate-700 bg-slate-800"
                    >
                      <img
                        src={fileUrl(url) ?? undefined}
                        alt={`Photo incident ${idx + 1}`}
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                      />
                      <span className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded backdrop-blur-sm">
                        Photo {idx + 1}/{allPhotos.length}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-slate-900 text-base">{issue.title}</h4>
                    <Badge status={issue.status} />
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">{issue.description}</p>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div>
                      <span className="font-semibold text-slate-700">
                        {issue.tenant?.firstName} {issue.tenant?.lastName}
                      </span>{" "}
                      • {issue.tenant?.phone}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(issue.createdAt).toLocaleDateString("fr-FR")}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 font-medium">
                    Bien concerné : <span className="text-slate-800">{issue.contract?.property?.title}</span>
                  </p>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Note de traitement / Réponse au locataire :
                    </label>
                    <textarea
                      placeholder="Ex: Plombier mandaté, intervention prévue mardi à 14h..."
                      defaultValue={issue.managerNote ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [issue.id]: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:ring-2 focus:ring-brand-500"
                      rows={2}
                    />
                  </div>
                </div>
              </div>

              {/* Boutons de changement de statut */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Changer le statut :</span>
                <div className="flex flex-wrap gap-1.5">
                  {statusOptions.map((s) => (
                    <button
                      key={s}
                      onClick={() => updateStatus(issue, s)}
                      disabled={issue.status === s}
                      className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                        issue.status === s
                          ? "bg-slate-200 text-slate-400 border-slate-300 cursor-default"
                          : "border-slate-300 text-slate-700 hover:bg-white hover:border-slate-400 cursor-pointer"
                      }`}
                    >
                      <Badge status={s} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="text-slate-400 text-sm col-span-2 text-center py-16 bg-white rounded-2xl border border-slate-200">
            Aucun incident pour ce filtre
          </p>
        )}
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50 cursor-zoom-out backdrop-blur-sm"
        >
          <img
            src={lightbox}
            alt="Photo agrandie"
            className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl border border-slate-700"
          />
        </div>
      )}
    </div>
  );
}
