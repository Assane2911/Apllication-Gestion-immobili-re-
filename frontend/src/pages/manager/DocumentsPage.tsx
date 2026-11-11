import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import StoredDocumentModal from "../../components/StoredDocumentModal";
import type { CategorieDocument, PaginatedResponse, Property, StoredDocument, Tenant } from "../../types";
import { CATEGORIES_DOCUMENT, etatDocument, syntheseDocuments, tailleLisible, type EtatDocument } from "../../utils/documents";
import { formaterJour } from "../../utils/jourCivil";
import { correspond } from "../../utils/recherche";

const PAGE_SIZE = 100;
// Pour les listes de choix du formulaire : large, non paginée (même convention que les autres pages).
const CHOIX_PAGE_SIZE = 100;
const SEUIL_OUTILS = 4;

const BOUTON_BORD = "inline-flex shrink-0 cursor-pointer items-center border px-2.5 py-1.5 text-xs font-semibold transition-colors";
const ACTION = `${BOUTON_BORD} border-slate-400 bg-white text-slate-800 hover:border-ink-900 hover:bg-slate-100`;
const ACTION_ENCRE = `${BOUTON_BORD} border-ink-900 bg-white text-ink-900 hover:bg-slate-100`;
const CHAMP_COMPACT = "border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900";
const FILET: Record<EtatDocument, string> = {
  expired: "border-l-orange-700",
  soon: "border-l-orange-300",
  valid: "border-l-ink-900",
  none: "border-l-slate-300",
};

type Filtre = "all" | "expired" | "soon";

/**
 * Documents rangés par bien et par locataire : diagnostics, attestations d'assurance, pièces d'identité, justificatifs.
 * Chaque document peut porter une date d'expiration ; ceux qui expirent bientôt ou ont expiré sont signalés ici et
 * dans l'agenda. Le fichier est privé : il s'ouvre par un lien temporaire.
 */
export default function DocumentsPage() {
  const { t, i18n } = useTranslation();
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("all");
  const [categorie, setCategorie] = useState<"all" | CategorieDocument>("all");
  const [bienFiltre, setBienFiltre] = useState("");
  const [modale, setModale] = useState<{ document?: StoredDocument } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const charger = useCallback(
    (signal?: AbortSignal) => {
      Promise.all([
        api.get<PaginatedResponse<StoredDocument>>("/stored-documents", { params: { page, pageSize: PAGE_SIZE }, signal }),
        api.get<PaginatedResponse<Property>>("/properties", { params: { pageSize: CHOIX_PAGE_SIZE }, signal }),
        api.get<PaginatedResponse<Tenant>>("/tenants", { params: { pageSize: CHOIX_PAGE_SIZE }, signal }),
      ])
        .then(([docs, biens, locataires]) => {
          setDocuments(liste<StoredDocument>(docs.data, "items"));
          setTotal(docs.data.total);
          setTotalPages(docs.data.totalPages);
          setProperties(liste<Property>(biens.data, "items"));
          setTenants(liste<Tenant>(locataires.data, "items").filter((l) => !l.anonymizedAt));
          setLoadError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (isRequestCancelled(err)) return;
          setLoadError(apiErrorMessage(err));
          setLoading(false);
        });
    },
    [page]
  );

  useEffect(() => {
    const controller = new AbortController();
    charger(controller.signal);
    return () => controller.abort();
  }, [charger]);

  async function ouvrir(doc: StoredDocument) {
    setActionError(null);
    try {
      // Le fichier vit dans le stockage PRIVÉ : un lien temporaire est généré à la demande, jamais un lien permanent.
      const { data } = await api.get<{ url: string }>(`/stored-documents/${doc.id}/link`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function supprimer(doc: StoredDocument) {
    if (!confirm(t("manager.documents.confirmDelete", { title: doc.title }))) return;
    setActionError(null);
    try {
      await api.delete(`/stored-documents/${doc.id}`);
      charger();
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  const synthese = syntheseDocuments(documents);
  const visibles = documents.filter((d) => {
    const etat = etatDocument(d);
    if (filtre === "expired" && etat !== "expired") return false;
    if (filtre === "soon" && etat !== "soon") return false;
    if (categorie !== "all" && d.category !== categorie) return false;
    if (bienFiltre && d.propertyId !== bienFiltre) return false;
    return correspond(recherche, d.title, d.fileName, d.propertyTitle ?? "", d.tenantName ?? "");
  });

  const libelleEtat = (doc: StoredDocument) => {
    const etat = etatDocument(doc);
    if (etat === "none" || !doc.expiresAt) return null;
    const date = formaterJour(doc.expiresAt, i18n.language);
    if (etat === "expired") return { texte: t("manager.documents.state.expired", { date }), classe: "font-semibold text-orange-800" };
    if (etat === "soon") return { texte: t("manager.documents.state.soon", { date }), classe: "font-semibold text-orange-800" };
    return { texte: t("manager.documents.state.valid", { date }), classe: "text-slate-600" };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.documents.title")}</h2>
          <p className="mt-1 text-xs text-slate-600">{t("manager.documents.subtitle")}</p>
        </div>
        <button
          onClick={() => setModale({})}
          className="cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
        >
          {t("manager.documents.addBtn")}
        </button>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => charger()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {actionError}
        </p>
      )}

      {!loading && documents.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.documents.summary.label")}
          cases={[
            { libelle: t("manager.documents.summary.total"), valeur: total, aide: t("manager.documents.summary.totalHint") },
            { libelle: t("manager.documents.summary.expired"), valeur: synthese.expires, aide: t("manager.documents.summary.expiredHint"), ton: synthese.expires > 0 ? "alerte" : "normal" },
            { libelle: t("manager.documents.summary.soon"), valeur: synthese.bientot, aide: t("manager.documents.summary.soonHint"), ton: synthese.bientot > 0 ? "alerte" : "normal" },
            { libelle: t("manager.documents.summary.noDate"), valeur: synthese.sansDate, aide: t("manager.documents.summary.noDateHint") },
          ]}
        />
      )}

      {!loading && documents.length >= SEUIL_OUTILS && (
        <BarreListe
          idPrefixe="documents"
          recherche={recherche}
          onRecherche={setRecherche}
          placeholderRecherche={t("manager.documents.search")}
          libelleFiltres={t("manager.documents.filtersLabel")}
          filtres={[
            { cle: "all", libelle: t("manager.liste.all"), compte: documents.length },
            { cle: "expired", libelle: t("manager.documents.filters.expired"), compte: synthese.expires },
            { cle: "soon", libelle: t("manager.documents.filters.soon"), compte: synthese.bientot },
          ]}
          filtreActif={filtre}
          onFiltre={(cle) => setFiltre(cle as Filtre)}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="documents-categorie" className="sr-only">
                {t("manager.documents.form.category")}
              </label>
              <select id="documents-categorie" value={categorie} onChange={(e) => setCategorie(e.target.value as "all" | CategorieDocument)} className={CHAMP_COMPACT}>
                <option value="all">{t("manager.documents.allCategories")}</option>
                {CATEGORIES_DOCUMENT.map((c) => (
                  <option key={c} value={c}>
                    {t(`manager.documents.categories.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="documents-bien" className="sr-only">
                {t("manager.documents.form.property")}
              </label>
              <select id="documents-bien" value={bienFiltre} onChange={(e) => setBienFiltre(e.target.value)} className={CHAMP_COMPACT}>
                <option value="">{t("manager.documents.allProperties")}</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </BarreListe>
      )}

      {loading && <p className="text-sm text-slate-600">{t("manager.documents.loading")}</p>}

      {!loading && !loadError && documents.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title={t("manager.documents.emptyTitle")}
          description={t("manager.documents.emptyDesc")}
          action={{ label: t("manager.documents.addBtn"), onClick: () => setModale({}) }}
        />
      )}

      {!loading && documents.length > 0 && visibles.length === 0 && <p className="text-sm text-slate-600">{t("manager.documents.noMatch")}</p>}

      {!loading && visibles.length > 0 && (
        <ul className="space-y-2">
          {visibles.map((d) => {
            const etat = libelleEtat(d);
            return (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-l-4 border-slate-300 bg-white p-3 ${FILET[etatDocument(d)]}`}>
                <div className="min-w-[min(100%,16rem)] flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t(`manager.documents.categories.${d.category}`)}</span>
                    <span className="break-words font-semibold text-slate-900">{d.title}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {[d.propertyTitle, d.tenantName].filter(Boolean).join(" — ")}
                    {(d.propertyTitle || d.tenantName) && " · "}
                    <span className="break-all">{d.fileName}</span> · {tailleLisible(d.sizeBytes, i18n.language)}
                  </p>
                  {etat && <p className={`mt-0.5 text-xs ${etat.classe}`}>{etat.texte}</p>}
                  {d.notes && <p className="mt-0.5 break-words text-xs text-slate-600">{d.notes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => void ouvrir(d)} className={ACTION_ENCRE}>
                    {t("manager.documents.open")}
                  </button>
                  <button onClick={() => setModale({ document: d })} className={ACTION}>
                    {t("common.actions.edit")}
                  </button>
                  <button onClick={() => void supprimer(d)} className="cursor-pointer border-b border-rose-700/40 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-700">
                    {t("common.actions.delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {modale && (
        <StoredDocumentModal
          document={modale.document}
          properties={properties}
          tenants={tenants}
          initialPropertyId={bienFiltre || undefined}
          onSaved={() => {
            setModale(null);
            charger();
          }}
          onClose={() => setModale(null)}
        />
      )}
    </div>
  );
}
