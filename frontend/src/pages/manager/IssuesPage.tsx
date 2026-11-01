import { Camera, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, fileUrl, isRequestCancelled, liste } from "../../api/client";
import Pagination from "../../components/Pagination";
import PhotoLightbox from "../../components/PhotoLightbox";
import type { IssueReport, IssueStatus, PaginatedResponse, Vendor } from "../../types";
import { getAllIssuePhotos } from "../../utils/issuePhotos";
import Bulle from "../../components/Bulle";

const statusOptions: IssueStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];
const PAGE_SIZE = 20;

/** Filet de couleur de la fiche et pastille du statut : le rouge crie l'urgence, le vert referme le dossier. */
const teinteStatut: Record<IssueStatus, { filet: string; tag: string }> = {
  OPEN: { filet: "border-l-rose-600", tag: "border-rose-300 bg-rose-50 text-rose-800" },
  IN_PROGRESS: { filet: "border-l-orange-700", tag: "border-orange-700/50 bg-orange-50 text-orange-800" },
  RESOLVED: { filet: "border-l-emerald-600", tag: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  REJECTED: { filet: "border-l-slate-400", tag: "border-slate-400 bg-slate-100 text-slate-700" },
};

const CLASSE_ETIQUETTE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";

/**
 * `<input type="datetime-local">` attend "AAAA-MM-JJTHH:mm" en heure LOCALE,
 * sans fuseau — `toISOString()` donnerait l'heure UTC, décalée de l'heure
 * locale de qui saisit le rendez-vous.
 */
function versDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function IssuesPage() {
  const { t, i18n } = useTranslation();
  const [issues, setIssues] = useState<IssueReport[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [filter, setFilter] = useState<IssueStatus | "ALL">("ALL");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Photo affichée en grand pour chaque incident (la première par défaut).
  const [photoChoisie, setPhotoChoisie] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<IssueReport>>("/issues", {
        params: { page, pageSize: PAGE_SIZE, ...(filter !== "ALL" ? { status: filter } : {}) },
        signal,
      })
      .then((res) => {
        setIssues(liste<IssueReport>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [page, filter]);

  // Carnet de prestataires, chargé une seule fois : sert au sélecteur
  // d'assignation de chaque incident ci-dessous, indépendant de la pagination
  // des incidents eux-mêmes.
  useEffect(() => {
    api
      .get<Vendor[]>("/vendors")
      .then((res) => setVendors(Array.isArray(res.data) ? res.data : []))
      .catch(() => setVendors([]));
  }, []);

  function handleFilterChange(value: IssueStatus | "ALL") {
    setFilter(value);
    setPage(1);
  }

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

  /**
   * Assignation du prestataire, indépendante du statut : `vendorId` vide
   * désassigne (envoyé comme `null`, jamais `undefined` — voir
   * updateIssueSchema côté serveur, où l'absence du champ signifierait "ne
   * pas toucher à l'assignation existante").
   */
  async function assignVendor(issue: IssueReport, vendorId: string) {
    try {
      await api.put(`/issues/${issue.id}/status`, {
        status: issue.status,
        managerNote: issue.managerNote ?? undefined,
        vendorId: vendorId || null,
      });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  /**
   * `value` vide efface la planification (envoyée comme `null`) — jamais
   * `undefined`, qui signifierait côté serveur "ne pas y toucher" (voir
   * updateIssueSchema). Le serveur refuse par ailleurs toute date sans
   * prestataire déjà assigné : ce champ est désactivé dans le JSX tant
   * qu'aucun prestataire ne l'est, mais la garde reste aussi côté serveur.
   */
  async function scheduleIntervention(issue: IssueReport, value: string) {
    try {
      await api.put(`/issues/${issue.id}/status`, {
        status: issue.status,
        managerNote: issue.managerNote ?? undefined,
        scheduledAt: value ? new Date(value).toISOString() : null,
      });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.issues.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.issues.subtitle")}</p>
      </div>

      {/* Filtre : une réglette d'onglets plutôt qu'une liste déroulante, le statut courant est visible d'un coup d'œil. */}
      <div role="group" aria-label={t("manager.issues.filterByStatus")} className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex">
        {(["ALL", ...statusOptions] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filter === s}
            onClick={() => handleFilterChange(s)}
            className={`flex-1 cursor-pointer border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
              filter === s ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
            }`}
          >
            {s === "ALL" ? t("manager.issues.allStatuses") : t(`common.status.${s}`)}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={() => load()} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      <div className="space-y-5">
        {issues.map((issue, rang) => {
          const allPhotos = getAllIssuePhotos(issue);
          const rangPhoto = Math.min(photoChoisie[issue.id] ?? 0, allPhotos.length - 1);
          const teinte = teinteStatut[issue.status] ?? teinteStatut.REJECTED;
          return (
            <article
              key={issue.id}
              className={`border border-slate-300 border-l-4 bg-white lg:grid lg:grid-cols-[19rem_1fr] ${teinte.filet}`}
            >
              {/* Les photos du signalement : une grande, les autres en vignettes. */}
              <div className="border-b border-slate-300 bg-slate-50 p-3 lg:border-b-0 lg:border-r">
                <button
                  type="button"
                  onClick={() => setLightbox(fileUrl(allPhotos[rangPhoto]))}
                  aria-label={t("manager.issues.enlargedPhotoAlt")}
                  className="relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden border border-slate-300 bg-slate-200"
                >
                  <img
                    src={fileUrl(allPhotos[rangPhoto]) ?? undefined}
                    alt={t("manager.issues.photoAlt", { index: rangPhoto + 1 })}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-0 left-0 inline-flex items-center gap-1.5 bg-ink-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white">
                    <Camera size={11} aria-hidden="true" />
                    {t("manager.issues.photoCount", { current: rangPhoto + 1, total: allPhotos.length })}
                  </span>
                </button>
                {allPhotos.length > 1 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {allPhotos.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPhotoChoisie((p) => ({ ...p, [issue.id]: idx }))}
                        aria-pressed={idx === rangPhoto}
                        aria-label={t("manager.issues.photoAlt", { index: idx + 1 })}
                        className={`h-14 w-16 shrink-0 cursor-pointer overflow-hidden border-2 ${
                          idx === rangPhoto ? "border-orange-700" : "border-slate-300 hover:border-ink-900"
                        }`}
                      >
                        <img src={fileUrl(url) ?? undefined} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col">
                <div className="flex-1 space-y-4 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-orange-700">
                        {t("manager.issues.fiche.reference")} {String((page - 1) * PAGE_SIZE + rang + 1).padStart(2, "0")}
                      </p>
                      <h3 className="mt-0.5 text-base font-bold leading-snug text-slate-900">{issue.title}</h3>
                    </div>
                    <span className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${teinte.tag}`}>
                      {t(`common.status.${issue.status}`)}
                    </span>
                  </div>

                  <p className="whitespace-pre-line text-xs leading-relaxed text-slate-700">{issue.description}</p>

                  <dl className="grid grid-cols-1 divide-y divide-slate-300 border border-slate-300 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    <div className="px-3 py-2">
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.issues.fiche.reportedBy")}</dt>
                      <dd className="mt-0.5 text-xs font-semibold text-slate-900">
                        {issue.tenant?.firstName} {issue.tenant?.lastName}
                      </dd>
                      {issue.tenant?.phone && (
                        <dd className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-slate-700">
                          <Phone size={11} aria-hidden="true" className="text-orange-700" />
                          {issue.tenant.phone}
                        </dd>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.issues.fiche.property")}</dt>
                      <dd className="mt-0.5 text-xs font-semibold text-slate-900">{issue.contract?.property?.title}</dd>
                    </div>
                    <div className="px-3 py-2">
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.issues.fiche.reportedOn")}</dt>
                      <dd className="mt-0.5 text-xs font-semibold tabular-nums text-slate-900">
                        {new Date(issue.createdAt).toLocaleDateString(i18n.language)}
                      </dd>
                    </div>
                  </dl>

                  {/* Le traitement : à qui on confie l'intervention, quand, et ce qu'on répond au locataire. */}
                  <div>
                    <h4 className="mb-3 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">
                      {t("manager.issues.fiche.handling")}
                      <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`issue-vendor-${issue.id}`} className={CLASSE_ETIQUETTE}>
                          {t("manager.issues.vendorLabel")}
                        </label>
                        <Bulle texte={t("manager.tips.issueVendor")} className="block">
                          <select
                            id={`issue-vendor-${issue.id}`}
                            value={issue.vendor?.id ?? ""}
                            onChange={(e) => assignVendor(issue, e.target.value)}
                            className="w-full border border-slate-400 bg-white px-3 py-2 text-xs text-slate-900"
                          >
                            <option value="">{t("manager.issues.noVendor")}</option>
                            {vendors.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                                {v.trade ? ` (${v.trade})` : ""}
                              </option>
                            ))}
                          </select>
                        </Bulle>
                      </div>
                      <div>
                        <label htmlFor={`issue-schedule-${issue.id}`} className={CLASSE_ETIQUETTE}>
                          {t("manager.issues.scheduleLabel")}
                        </label>
                        <Bulle texte={issue.vendor ? t("manager.tips.issueSchedule") : t("manager.tips.issueScheduleNoVendor")} className="block">
                          <input
                            id={`issue-schedule-${issue.id}`}
                            type="datetime-local"
                            disabled={!issue.vendor}
                            defaultValue={versDatetimeLocal(issue.scheduledAt)}
                            onChange={(e) => scheduleIntervention(issue, e.target.value)}
                            className="w-full border border-slate-400 bg-white px-3 py-2 text-xs text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </Bulle>
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`issue-response-${issue.id}`} className={CLASSE_ETIQUETTE}>
                          {t("manager.issues.responseLabel")}
                        </label>
                        <textarea
                          id={`issue-response-${issue.id}`}
                          placeholder={t("manager.issues.responsePlaceholder")}
                          defaultValue={issue.managerNote ?? ""}
                          maxLength={2000}
                          onChange={(e) => setNotes((n) => ({ ...n, [issue.id]: e.target.value }))}
                          className="w-full border border-slate-400 bg-white px-3 py-2 text-xs text-slate-900"
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Avancement du dossier : quatre cases, la case courante est pleine. */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-slate-50 px-4 py-3 sm:px-5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.issues.changeStatus")}</span>
                  <div role="group" aria-label={t("manager.issues.changeStatus")} className="flex w-full border border-slate-400 bg-white sm:w-auto">
                    {statusOptions.map((s) => (
                      <Bulle key={s} texte={t("manager.tips.issueStatus")} className="flex flex-1 border-r border-slate-400 last:border-r-0">
                        <button
                          onClick={() => updateStatus(issue, s)}
                          disabled={issue.status === s}
                          aria-pressed={issue.status === s}
                          className={`w-full whitespace-nowrap px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                            issue.status === s ? "cursor-default bg-ink-900 text-white" : "cursor-pointer text-slate-800 hover:bg-slate-100"
                          }`}
                        >
                          {t(`common.status.${s}`)}
                        </button>
                      </Bulle>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {issues.length === 0 && (
          <p className="border border-slate-300 bg-white py-16 text-center text-sm text-slate-600">
            {t("manager.issues.noIssuesForFilter")}
          </p>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      <PhotoLightbox src={lightbox} alt={t("manager.issues.enlargedPhotoAlt")} onClose={() => setLightbox(null)} />
    </div>
  );
}
