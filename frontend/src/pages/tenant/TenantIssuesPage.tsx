import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import type { Contract, IssueReport } from "../../types";

export default function TenantIssuesPage() {
  const [issues, setIssues] = useState<IssueReport[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    api.get<IssueReport[]>("/issues/mine").then((res) => setIssues(res.data));
    api.get<Contract[]>("/contracts/mine").then((res) => {
      setContracts(res.data);
      if (res.data[0]) setContractId(res.data[0].id);
    });
  }

  useEffect(load, []);

  function handlePhoto(file: File | null) {
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) {
      setError("Merci de joindre une photo du problème");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("contractId", contractId);
      data.append("title", title);
      data.append("description", description);
      data.append("photo", photo);
      await api.post("/issues", data);
      setTitle("");
      setDescription("");
      handlePhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">Signaler un problème</h2>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        {contracts.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Logement concerné</label>
            <select value={contractId} onChange={(e) => setContractId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>{c.property?.title}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Titre du problème</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Fuite d'eau sous l'évier" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Photo du problème</label>
          <input
            ref={fileInputRef}
            required
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
          <p className="text-xs text-slate-400 mt-1">Sur mobile, l'appareil photo s'ouvre directement.</p>
          {preview && <img src={preview} alt="Aperçu" className="mt-3 h-40 rounded-lg object-cover" />}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={saving || !contractId} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {saving ? "Envoi..." : "Envoyer le signalement"}
        </button>
      </form>

      <div>
        <h3 className="font-medium text-slate-900 mb-3">Mes signalements</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {issues.map((issue) => (
            <div key={issue.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <img src={fileUrl(issue.photoUrl) ?? undefined} alt={issue.title} className="w-full h-40 object-cover" />
              <div className="p-4 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-slate-900 text-sm">{issue.title}</h4>
                  <Badge status={issue.status} />
                </div>
                <p className="text-xs text-slate-500">{issue.description}</p>
                {issue.managerNote && <p className="text-xs text-slate-400 italic">Note du gestionnaire : {issue.managerNote}</p>}
                <p className="text-xs text-slate-300">{new Date(issue.createdAt).toLocaleDateString("fr-FR")}</p>
              </div>
            </div>
          ))}
          {issues.length === 0 && <p className="text-slate-400 text-sm col-span-2 text-center py-8">Aucun signalement pour le moment</p>}
        </div>
      </div>
    </div>
  );
}
