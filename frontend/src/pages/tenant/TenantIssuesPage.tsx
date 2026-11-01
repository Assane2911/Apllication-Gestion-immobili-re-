import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, fileUrl, liste, MAX_UPLOAD_SIZE_MB } from "../../api/client";
import PhotoLightbox from "../../components/PhotoLightbox";
import type { Contract, IssueReport, IssueStatus } from "../../types";
import { preparerFichier } from "../../utils/fichiers";
import { getAllIssuePhotos } from "../../utils/issuePhotos";
import Bulle from "../../components/Bulle";

/** Filet de couleur de la fiche, étiquette de statut et avancement (1 à 3 segments pleins sur 3) selon l'état du signalement. */
const TEINTE_STATUT: Record<IssueStatus, { filet: string; tag: string; etape: number; barre: string }> = {
  OPEN: { filet: "border-l-rose-600", tag: "border-rose-300 bg-rose-50 text-rose-800", etape: 1, barre: "bg-rose-600" },
  IN_PROGRESS: { filet: "border-l-orange-700", tag: "border-orange-700/50 bg-orange-50 text-orange-800", etape: 2, barre: "bg-orange-700" },
  RESOLVED: { filet: "border-l-emerald-600", tag: "border-emerald-300 bg-emerald-50 text-emerald-800", etape: 3, barre: "bg-emerald-600" },
  REJECTED: { filet: "border-l-slate-400", tag: "border-slate-400 bg-slate-100 text-slate-700", etape: 3, barre: "bg-slate-400" },
};

const CHAMP = "w-full border border-slate-400 bg-white px-3.5 py-2 text-sm text-slate-900";
const ETIQUETTE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";

export default function TenantIssuesPage() {
  const { t, i18n } = useTranslation();
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    Promise.all([api.get<IssueReport[]>("/issues/mine"), api.get<Contract[]>("/contracts/mine")])
      .then(([issuesRes, contractsRes]) => {
        setIssues(liste<IssueReport>(issuesRes.data));
        setContracts(liste<Contract>(contractsRes.data));
        if (contractsRes.data[0]) setContractId(contractsRes.data[0].id);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)));
  }

  useEffect(load, []);

  // handlePhoto/handleExtraPhoto révoquent déjà l'URL blob au REMPLACEMENT
  // d'une photo par une autre, mais rien ne le faisait en quittant la page
  // avec une photo encore sélectionnée (formulaire abandonné sans envoi ni
  // effacement) : l'URL restait valide, et son blob en mémoire, jusqu'à la
  // fermeture de l'onglet.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    return () => {
      if (extraPreview) URL.revokeObjectURL(extraPreview);
    };
  }, [extraPreview]);

  // Une photo de téléphone en pleine résolution (5 à 12 Mo) dépasse la limite d'envoi du serveur (une fonction
  // Vercel, 4,5 Mo de requête au plus) : elle est d'abord réduite ici (voir utils/fichiers.ts). Si elle reste
  // trop lourde, on le dit tout de suite plutôt qu'après jusqu'à DELAI_UPLOAD_MS (60 s) d'attente sur une
  // connexion mobile lente pour un échec qu'on pouvait détecter instantanément.
  async function handlePhoto(brut: File | null) {
    const file = brut ? await preparerFichier(brut) : null;
    if (brut && !file) {
      setError(t("tenant.issues.photoTooLarge", { maxMb: MAX_UPLOAD_SIZE_MB }));
      return;
    }
    setError(null);
    setPhoto(file);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleExtraPhoto(brut: File | null) {
    const file = brut ? await preparerFichier(brut) : null;
    if (brut && !file) {
      // alert() et non setError() : ce mini-formulaire (ajout d'une photo à
      // un incident déjà existant) n'a pas de zone d'erreur dédiée — c'est le
      // même choix que handleAddExtraPhoto ci-dessous pour ses propres échecs.
      alert(t("tenant.issues.photoTooLarge", { maxMb: MAX_UPLOAD_SIZE_MB }));
      return;
    }
    setExtraPhoto(file);
    setExtraPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) {
      setError(t("tenant.issues.errorPhotoRequired"));
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
      await api.post("/issues", data, { timeout: DELAI_UPLOAD_MS });
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
      await api.post(`/issues/${issueId}/photo`, data, { timeout: DELAI_UPLOAD_MS });
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("tenant.issues.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("tenant.issues.subtitle")}</p>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {/* Formulaire de signalement */}
      <form onSubmit={handleSubmit} className="border border-slate-300 bg-white">
        <h3 className="flex items-baseline gap-3 border-b border-slate-300 bg-slate-50 px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">
          <span aria-hidden="true" className="text-[11px] text-orange-700">01</span>
          {t("tenant.issues.newReport")}
        </h3>
        <div className="space-y-4 p-5">
          {contracts.length > 1 && (
            <div>
              <label htmlFor="issue-contract" className={ETIQUETTE}>{t("tenant.issues.concernedHome")}</label>
              <select id="issue-contract" value={contractId} onChange={(e) => setContractId(e.target.value)} className={CHAMP}>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.property?.title} ({c.property?.address})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="issue-title" className={ETIQUETTE}>{t("tenant.issues.issueTitle")}</label>
            <input
              id="issue-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("tenant.issues.issueTitlePlaceholder")}
              className={CHAMP}
            />
          </div>

          <div>
            <label htmlFor="issue-description" className={ETIQUETTE}>{t("tenant.issues.description")}</label>
            <textarea
              id="issue-description"
              required
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t("tenant.issues.descriptionPlaceholder")}
              className={CHAMP}
            />
          </div>

          {/* Zone de prise de photo */}
          <div className="border-2 border-dashed border-slate-400 bg-slate-50 p-4">
            <label htmlFor="issue-photo" className={ETIQUETTE}>
              {t("tenant.issues.photoLabel")}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="issue-photo"
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
                className="cursor-pointer text-xs text-slate-700"
              />
              <span className="text-[11px] text-slate-600">{t("tenant.issues.photoHint")}</span>
            </div>

            {preview && (
              <div className="relative mt-3 inline-block">
                <img
                  src={preview}
                  alt={t("tenant.issues.photoReady")}
                  className="h-44 cursor-zoom-in border border-slate-400 object-cover"
                  onClick={() => setLightbox(preview)}
                />
                <span className="absolute bottom-0 left-0 bg-ink-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white">
                  {t("tenant.issues.photoReady")}
                </span>
              </div>
            )}
          </div>

          {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={saving || !contractId}
            className="cursor-pointer border border-ink-900 bg-ink-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {saving ? t("tenant.issues.submitting") : t("tenant.issues.submit")}
          </button>
        </div>
      </form>

      {/* Historique des signalements */}
      <div>
        <h3 className="mb-4 flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">
          <span aria-hidden="true" className="text-orange-700">02</span>
          {t("tenant.issues.historyTitle")}
          <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
        </h3>
        <div className="space-y-5">
          {issues.map((issue, rang) => {
            const allPhotos = getAllIssuePhotos(issue);
            const teinte = TEINTE_STATUT[issue.status] ?? TEINTE_STATUT.REJECTED;
            return (
              <article key={issue.id} className={`border border-l-4 border-slate-300 bg-white md:grid md:grid-cols-[16rem_1fr] ${teinte.filet}`}>
                {/* Les photos du signalement : toutes visibles, un clic les agrandit. */}
                <div className="border-b border-slate-300 bg-slate-50 p-3 md:border-b-0 md:border-r">
                  <div className="grid grid-cols-2 gap-2">
                    {allPhotos.map((url, idx) => (
                      <div
                        key={idx}
                        onClick={() => setLightbox(fileUrl(url))}
                        className={`relative aspect-4/3 cursor-zoom-in overflow-hidden border border-slate-300 bg-slate-200 ${
                          idx === 0 && allPhotos.length % 2 === 1 ? "col-span-2" : ""
                        }`}
                      >
                        <img src={fileUrl(url) ?? undefined} alt={t("tenant.issues.photoAlt", { index: idx + 1 })} className="h-full w-full object-cover" />
                        <span className="absolute bottom-0 left-0 bg-ink-900 px-1.5 py-0.5 font-mono text-[9px] text-white">
                          {idx + 1}/{allPhotos.length}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex min-w-0 flex-col">
                  <div className="flex-1 space-y-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p aria-hidden="true" className="font-mono text-[10px] uppercase tracking-wider text-orange-700">
                          {t("common.sheet")} {String(rang + 1).padStart(2, "0")}
                        </p>
                        <h4 className="mt-0.5 text-base font-bold leading-snug text-slate-900">{issue.title}</h4>
                      </div>
                      <span className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${teinte.tag}`}>
                        {t(`common.status.${issue.status}`)}
                      </span>
                    </div>

                    {/* Avancement du dossier : trois segments, remplis selon l'état (sans texte : l'état est dit par l'étiquette). */}
                    <div aria-hidden="true" className="flex gap-1">
                      {[1, 2, 3].map((n) => (
                        <span key={n} className={`h-1.5 flex-1 ${n <= teinte.etape ? teinte.barre : "bg-slate-200"}`} />
                      ))}
                    </div>

                    <p className="text-xs leading-relaxed text-slate-700">{issue.description}</p>

                    {issue.vendor && (
                      <div className="border-l-2 border-ink-900 bg-slate-50 px-3 py-2.5 text-xs text-slate-800">
                        <strong className="mb-0.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("tenant.issues.vendorAssigned")}</strong>
                        {issue.vendor.trade ? `${issue.vendor.name} — ${issue.vendor.trade}` : issue.vendor.name}
                      </div>
                    )}

                    {issue.scheduledAt && (
                      <div className="border-l-2 border-orange-700 bg-orange-50 px-3 py-2.5 text-xs text-orange-950">
                        <strong className="mb-0.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-800">{t("tenant.issues.interventionScheduled")}</strong>
                        {new Date(issue.scheduledAt).toLocaleString(i18n.language, { dateStyle: "long", timeStyle: "short" })}
                      </div>
                    )}

                    {issue.managerNote && (
                      <div className="border-l-2 border-orange-700 bg-slate-50 px-3 py-2.5 text-xs text-slate-900">
                        <strong className="mb-0.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("tenant.issues.managerResponse")}</strong>
                        {issue.managerNote}
                      </div>
                    )}

                    <p className="font-mono text-[11px] text-slate-600">
                      {t("tenant.issues.reportedOn", {
                        date: new Date(issue.createdAt).toLocaleDateString(i18n.language),
                        time: new Date(issue.createdAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
                      })}
                    </p>
                  </div>

                  {/* Ajout d'une photo supplémentaire */}
                  <div className="border-t border-slate-300 bg-slate-50 px-5 py-3">
                    {addingPhotoToId === issue.id ? (
                      <div className="space-y-3 border border-slate-300 bg-white p-3">
                        <p className="text-xs font-semibold text-slate-800">{t("tenant.issues.addPhotoTitle")}</p>
                        <input
                          aria-label={t("tenant.issues.addPhotoTitle")}
                          ref={extraFileInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleExtraPhoto(e.target.files?.[0] ?? null)}
                          className="cursor-pointer text-xs text-slate-700"
                        />
                        {extraPreview && <img src={extraPreview} alt={t("tenant.issues.photoReady")} className="h-28 border border-slate-300 object-cover" />}
                        <div className="flex items-center justify-end gap-4">
                          <button
                            type="button"
                            onClick={() => {
                              setAddingPhotoToId(null);
                              setExtraPhoto(null);
                              setExtraPreview(null);
                            }}
                            className="cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                          >
                            {t("common.actions.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddExtraPhoto(issue.id)}
                            disabled={savingExtra || !extraPhoto}
                            className="cursor-pointer border border-ink-900 bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                          >
                            {savingExtra ? t("tenant.issues.addingPhoto") : t("tenant.issues.validateAddPhoto")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Bulle texte={t("tenant.tips.addPhoto")}>
                        <button
                          onClick={() => setAddingPhotoToId(issue.id)}
                          className="inline-flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-white px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
                        >
                          <Camera size={13} aria-hidden="true" /> {t("tenant.issues.addPhoto")}
                        </button>
                      </Bulle>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {issues.length === 0 && (
            <p className="border border-slate-300 bg-white py-12 text-center text-sm text-slate-600">{t("tenant.issues.noIssues")}</p>
          )}
        </div>
      </div>

      {/* Lightbox / Zoom Agrandisseur */}
      <PhotoLightbox src={lightbox} alt={t("tenant.issues.enlargedPhotoAlt")} onClose={() => setLightbox(null)} />
    </div>
  );
}
