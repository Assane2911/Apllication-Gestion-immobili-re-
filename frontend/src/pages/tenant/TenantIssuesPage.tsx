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
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Pour ajouter une photo à un incident existant
  const [addingPhotoToId, setAddingPhotoToId] = useState<string | null>(null);
  const [extraPhoto, setExtraPhoto] = useState<File | null>(null);
  const [extraPreview, setExtraPreview] = useState<string | null>(null);
  const [savingExtra, setSavingExtra] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);

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

  function handleExtraPhoto(file: File | null) {
    setExtraPhoto(file);
    setExtraPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) {
      setError("Merci de prendre ou joindre une photo du problème");
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

  async function handleAddExtraPhoto(issueId: string) {
    if (!extraPhoto) return;
    setSavingExtra(true);
    try {
      const data = new FormData();
      data.append("photo", extraPhoto);
      await api.post(`/issues/${issueId}/photo`, data);
      setAddingPhotoToId(null);
      setExtraPhoto(null);
      setExtraPreview(null);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setSavingExtra(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Signaler un incident avec photos</h2>
        <p className="text-sm text-slate-500 mt-1">
          Photographiez l'incident pour transmettre immédiatement les images à l'agence
        </p>
      </div>

      {/* Formulaire de signalement */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h3 className="font-bold text-slate-900 text-base">Nouveau signalement</h3>

        {contracts.length > 1 && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Logement concerné</label>
            <select
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.property?.title} ({c.property?.address})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Titre de l'incident *</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Fuite d'eau sous le lavabo, serrure bloquée..."
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Description détaillée *</label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Expliquez ce qui s'est passé, l'urgence et la localisation précise dans le logement..."
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Zone de prise de photo */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-slate-800 mb-2">
            📷 Photographier l'incident (Requis)
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
              className="text-xs file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-brand-600 file:text-white hover:file:bg-brand-700 cursor-pointer"
            />
            <span className="text-[11px] text-slate-500">
              💡 Sur smartphone, votre appareil photo s'ouvre directement pour capturer l'incident.
            </span>
          </div>

          {preview && (
            <div className="mt-3 relative inline-block">
              <img
                src={preview}
                alt="Aperçu photo"
                className="h-44 rounded-xl object-cover border border-slate-300 shadow-sm cursor-pointer"
                onClick={() => setLightbox(preview)}
              />
              <span className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded backdrop-blur-sm">
                Photo prête à l'envoi
              </span>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

        <button
          type="submit"
          disabled={saving || !contractId}
          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-colors cursor-pointer"
        >
          {saving ? "Envoi du signalement..." : "📤 Transmettre le signalement à l'agence"}
        </button>
      </form>

      {/* Historique des signalements */}
      <div>
        <h3 className="font-semibold text-slate-900 text-lg mb-3">Mes signalements & Photos</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {issues.map((issue) => {
            const allPhotos = getAllPhotos(issue);
            return (
              <div key={issue.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
                <div>
                  {/* Galerie photos */}
                  <div className="relative">
                    <div className="flex gap-2 overflow-x-auto p-3 bg-slate-900">
                      {allPhotos.map((url, idx) => (
                        <div
                          key={idx}
                          onClick={() => setLightbox(fileUrl(url))}
                          className="relative h-40 w-48 shrink-0 rounded-xl overflow-hidden cursor-zoom-in border border-slate-700 bg-slate-800"
                        >
                          <img
                            src={fileUrl(url) ?? undefined}
                            alt={`Photo incident ${idx + 1}`}
                            className="w-full h-full object-cover hover:scale-105 transition-transform"
                          />
                          <span className="absolute top-2 left-2 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">
                            Photo {idx + 1}/{allPhotos.length}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-slate-900 text-base">{issue.title}</h4>
                      <Badge status={issue.status} />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{issue.description}</p>

                    {issue.managerNote && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 mt-2">
                        <strong className="block mb-0.5 font-semibold">Réponse de l'agence :</strong>
                        {issue.managerNote}
                      </div>
                    )}

                    <p className="text-[11px] text-slate-400 pt-1">
                      Signalé le {new Date(issue.createdAt).toLocaleDateString("fr-FR")} à{" "}
                      {new Date(issue.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>

                {/* Ajout d'une photo supplémentaire */}
                <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                  {addingPhotoToId === issue.id ? (
                    <div className="space-y-3 bg-white p-3 rounded-xl border border-slate-200">
                      <p className="text-xs font-semibold text-slate-800">Prendre une photo supplémentaire :</p>
                      <input
                        ref={extraFileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleExtraPhoto(e.target.files?.[0] ?? null)}
                        className="text-xs file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-slate-900 file:text-white cursor-pointer"
                      />
                      {extraPreview && (
                        <img src={extraPreview} alt="Aperçu" className="h-28 rounded-lg object-cover" />
                      )}
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setAddingPhotoToId(null);
                            setExtraPhoto(null);
                            setExtraPreview(null);
                          }}
                          className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddExtraPhoto(issue.id)}
                          disabled={savingExtra || !extraPhoto}
                          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm"
                        >
                          {savingExtra ? "Envoi..." : "Valider l'ajout de photo"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingPhotoToId(issue.id)}
                      className="w-full bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>📷</span> Ajouter une photo à cet incident
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {issues.length === 0 && (
            <p className="text-slate-400 text-sm col-span-2 text-center py-12 bg-white rounded-2xl border border-slate-200">
              Aucun incident signalé. Tous vos équipements sont opérationnels !
            </p>
          )}
        </div>
      </div>

      {/* Lightbox / Zoom Agrandisseur */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50 cursor-zoom-out backdrop-blur-sm"
        >
          <img src={lightbox} alt="Photo agrandie" className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl border border-slate-700" />
        </div>
      )}
    </div>
  );
}
