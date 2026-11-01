import { Building2, Download, LayoutGrid, MapPin, Pencil, Table2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, fileUrl, isRequestCancelled, liste, MAX_UPLOAD_SIZE_MB } from "../../api/client";
import { preparerFichier } from "../../utils/fichiers";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import PlanLogement from "../../components/PlanLogement";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import SectionReglage from "../../components/SectionReglage";
import { PropertyCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { Owner, PaginatedResponse, Property, PropertyStatus } from "../../types";
import Bulle from "../../components/Bulle";
import { correspond } from "../../utils/recherche";
import { csvBiens, loyerAuM2, nomProprietaire, syntheseBiens, trierBiens, type CritereTriBien } from "../../utils/syntheseParc";
import { dateDuJourPourFichier, telechargerCsv } from "../../utils/telechargement";
import { formatByCurrency } from "../../utils/currencyFormat";

const emptyForm = { title: "", address: "", surface: "", rent: "", status: "AVAILABLE" as PropertyStatus, description: "", ownerId: "" };
const PAGE_SIZE = 20;
// Pour le sélecteur "propriétaire" du formulaire : on récupère la liste complète en une
// page (max autorisé par l'API) plutôt que de paginer un simple menu déroulant.
const OWNERS_PAGE_SIZE = 100;
// Sous ce nombre de biens, la recherche et les filtres n'apportent rien : la barre d'outils reste cachée.
const SEUIL_OUTILS = 4;
const CLE_VUE = "immoplatform.biens.vue";
type Vue = "cartes" | "tableau";

function vueMemorisee(): Vue {
  try {
    return localStorage.getItem(CLE_VUE) === "tableau" ? "tableau" : "cartes";
  } catch {
    return "cartes";
  }
}

const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900";

export default function PropertiesPage() {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [properties, setProperties] = useState<Property[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<"all" | PropertyStatus>("all");
  const [tri, setTri] = useState<CritereTriBien>("recent");
  const [vue, setVue] = useState<Vue>(vueMemorisee);

  function changerVue(v: Vue) {
    setVue(v);
    try {
      localStorage.setItem(CLE_VUE, v);
    } catch {
      // Stockage indisponible : la vue vaut pour cette visite seulement.
    }
  }

  // Aperçu de l'image choisie, avant l'envoi. Absent là où le navigateur ne sait pas fabriquer l'adresse.
  const apercu = useMemo(() => {
    if (!image || typeof URL.createObjectURL !== "function") return null;
    return URL.createObjectURL(image);
  }, [image]);
  useEffect(() => {
    if (!apercu) return;
    return () => URL.revokeObjectURL(apercu);
  }, [apercu]);

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<Property>>("/properties", { params: { page, pageSize: PAGE_SIZE }, signal })
      .then((res) => {
        setProperties(liste<Property>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [page]);

  useEffect(() => {
    api
      .get<PaginatedResponse<Owner>>("/owners", { params: { page: 1, pageSize: OWNERS_PAGE_SIZE } })
      .then((res) => setOwners(liste<Owner>(res.data, "items")))
      .catch(() => setOwners([]));
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setImage(null);
    setShowForm(true);
  }

  function openEdit(p: Property) {
    setEditing(p);
    setForm({
      title: p.title,
      address: p.address,
      surface: String(p.surface),
      rent: String(p.rent),
      status: p.status,
      description: p.description ?? "",
      ownerId: p.ownerId ?? "",
    });
    setImage(null);
    setShowForm(true);
  }

  // Une photo de téléphone en pleine résolution dépasse la limite d'envoi du serveur : elle est réduite ici
  // (voir utils/fichiers.ts), ou refusée tout de suite avec un message clair si elle reste trop lourde.
  async function choisirImage(e: React.ChangeEvent<HTMLInputElement>) {
    const brut = e.target.files?.[0] ?? null;
    const prete = brut ? await preparerFichier(brut) : null;
    if (brut && !prete) {
      e.target.value = "";
      setImage(null);
      setError(t("common.errors.fileTooLarge", { maxMb: MAX_UPLOAD_SIZE_MB }));
      return;
    }
    setError(null);
    setImage(prete);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("title", form.title);
      data.append("address", form.address);
      data.append("surface", form.surface);
      data.append("rent", form.rent);
      data.append("status", form.status);
      if (form.description) data.append("description", form.description);
      // Une chaîne vide n'est pas envoyée : le backend traite l'absence du champ
      // comme "ne pas modifier l'association" (voir property.controller.ts),
      // là où une chaîne vide échouerait la validation ownerId.min(1).
      if (form.ownerId) data.append("ownerId", form.ownerId);
      if (image) data.append("image", image);

      if (editing) {
        await api.put(`/properties/${editing.id}`, data, { timeout: DELAI_UPLOAD_MS });
      } else {
        await api.post("/properties", data, { timeout: DELAI_UPLOAD_MS });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: Property) {
    if (!confirm(t("manager.properties.confirmDelete", { title: p.title }))) return;
    try {
      await api.delete(`/properties/${p.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  const nomsProprietaires = new Map(owners.map((o) => [o.id, nomProprietaire(o)]));
  const synthese = syntheseBiens(properties);
  const afficherOutils = properties.length >= SEUIL_OUTILS;
  const visibles = trierBiens(
    properties.filter((p) => (filtre === "all" || p.status === filtre) && correspond(recherche, p.title, p.address, (p.ownerId && nomsProprietaires.get(p.ownerId)) || "")),
    tri
  );
  const filtresActifs = recherche.trim() !== "" || filtre !== "all";
  const loyerM2Formate = (p: Property) => {
    const m2 = loyerAuM2(p.rent, p.surface);
    return m2 === null ? null : formatMoney(m2, p.currency);
  };

  function exporterCsv() {
    telechargerCsv(
      `biens-${dateDuJourPourFichier()}.csv`,
      csvBiens(
        visibles,
        nomsProprietaires,
        {
          title: t("manager.properties.fields.title"),
          address: t("manager.properties.fields.address"),
          surface: t("manager.properties.fields.surface"),
          rent: t("manager.properties.fields.rent"),
          currency: t("manager.properties.csvCurrency"),
          rentPerM2: t("manager.properties.csvRentPerM2"),
          status: t("manager.properties.fields.status"),
          owner: t("manager.properties.fields.owner"),
        },
        (st) => t(`common.status.${st}`)
      )
    );
  }

  const actionsLigne = (p: Property) => (
    <>
      <Bulle texte={t("manager.tips.propertyEdit")} className="block">
        <button onClick={() => openEdit(p)} className="flex w-full cursor-pointer items-center justify-center gap-1.5 py-2.5 text-slate-700 transition-colors hover:bg-slate-100 hover:text-ink-900">
          <Pencil size={13} aria-hidden="true" />
          {t("common.actions.edit")}
        </button>
      </Bulle>
      <Bulle texte={t("manager.tips.propertyDelete")} className="block">
        <button onClick={() => handleDelete(p)} className="flex w-full cursor-pointer items-center justify-center gap-1.5 py-2.5 text-rose-700 transition-colors hover:bg-rose-50">
          <Trash2 size={13} aria-hidden="true" />
          {t("common.actions.delete")}
        </button>
      </Bulle>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.properties.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.properties.count", { count: Math.max(total, properties.length) })}</p>
        </div>
        <Bulle texte={t("manager.tips.propertyCreate")}>
          <button onClick={openCreate} className={BOUTON_PLEIN}>
            {t("manager.properties.addBtn")}
          </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showForm && (
        <SectionReglage id="fiche-bien" numero="01" titre={editing ? t("manager.properties.formTitleEdit") : t("manager.properties.formTitleNew")}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="property-title" className={LIBELLE}>{t("manager.properties.fields.title")}</label>
              <input id="property-title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="property-address" className={LIBELLE}>{t("manager.properties.fields.address")}</label>
              <input id="property-address" required maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="property-surface" className={LIBELLE}>{t("manager.properties.fields.surface")}</label>
              <input id="property-surface" required type="number" step="0.1" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="property-rent" className={LIBELLE}>{t("manager.properties.fields.rent")}</label>
              <input id="property-rent" required type="number" step="0.01" value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} className={CHAMP} />
              {Number(form.surface) > 0 && Number(form.rent) > 0 && (
                <p className="mt-1 font-mono text-[11px] text-slate-600">{t("manager.properties.form.rentPerM2Hint", { amount: formatMoney(Number(form.rent) / Number(form.surface)) })}</p>
              )}
            </div>
            <div>
              <label htmlFor="property-status" className={LIBELLE}>{t("manager.properties.fields.status")}</label>
              <select id="property-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PropertyStatus })} className={CHAMP}>
                <option value="AVAILABLE">{t("common.status.AVAILABLE")}</option>
                <option value="OCCUPIED">{t("common.status.OCCUPIED")}</option>
                <option value="MAINTENANCE">{t("common.status.MAINTENANCE")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="property-owner" className={LIBELLE}>{t("manager.properties.fields.owner")}</label>
              <select id="property-owner" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className={CHAMP}>
                <option value="">{t("manager.properties.fields.noOwner")}</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.firstName} {owner.lastName}
                    {owner.companyName ? ` (${owner.companyName})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="property-image" className={LIBELLE}>{t("manager.properties.fields.image")}</label>
              <input id="property-image" type="file" accept="image/*" onChange={(e) => void choisirImage(e)} className="w-full text-sm text-slate-700" />
            </div>
            {(apercu || editing?.imageUrl) && (
              <figure className="flex items-end gap-3">
                <img src={apercu ?? fileUrl(editing?.imageUrl) ?? undefined} alt="" className="h-20 w-28 border border-slate-300 object-cover" />
                <figcaption className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
                  {apercu ? t("manager.properties.form.imagePreview") : t("manager.properties.form.currentImage")}
                </figcaption>
              </figure>
            )}
            <div className="md:col-span-2">
              <label htmlFor="property-description" className={LIBELLE}>{t("manager.properties.fields.description")}</label>
              <textarea id="property-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={CHAMP} rows={3} />
            </div>
            {error && <p role="alert" className="text-sm text-red-600 md:col-span-2">{error}</p>}
            <div className="flex gap-2 md:col-span-2">
              <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="cursor-pointer px-4 py-2 text-sm text-slate-600 hover:text-ink-900">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </SectionReglage>
      )}

      {!loading && properties.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.properties.summary.label")}
          cases={[
            {
              libelle: t("manager.properties.summary.occupancy"),
              valeur: `${synthese.tauxOccupation} %`,
              aide: t("manager.properties.summary.occupancyHint", { count: synthese.parStatut.OCCUPIED }),
            },
            {
              libelle: t("manager.properties.summary.rentRoll"),
              valeur: formatByCurrency(Object.fromEntries(synthese.parDevise.map((d) => [d.currency, d.loyerLoue])), formatMoney),
              aide: t("manager.properties.perMonth"),
            },
            {
              libelle: t("manager.properties.summary.vacant"),
              valeur: formatByCurrency(Object.fromEntries(synthese.parDevise.map((d) => [d.currency, d.manqueAGagner])), formatMoney),
              aide: t("manager.properties.summary.vacantHint", { count: synthese.parStatut.AVAILABLE }),
              ton: synthese.parStatut.AVAILABLE > 0 ? "alerte" : "normal",
            },
            {
              libelle: t("manager.properties.summary.rentPerM2"),
              valeur: synthese.parDevise.some((d) => d.loyerM2Moyen !== null)
                ? synthese.parDevise
                    .filter((d) => d.loyerM2Moyen !== null)
                    .map((d) => formatMoney(d.loyerM2Moyen, d.currency))
                    .join(" + ")
                : "—",
              aide: "/ m²",
            },
          ]}
        />
      )}

      {!loading && afficherOutils && (
        <BarreListe
          idPrefixe="biens"
          recherche={recherche}
          onRecherche={setRecherche}
          placeholderRecherche={t("manager.properties.search")}
          libelleFiltres={t("manager.properties.filtersLabel")}
          filtres={[
            { cle: "all", libelle: t("manager.liste.all"), compte: properties.length },
            ...(["AVAILABLE", "OCCUPIED", "MAINTENANCE"] as const).map((st) => ({ cle: st, libelle: t(`common.status.${st}`), compte: synthese.parStatut[st] })),
          ]}
          filtreActif={filtre}
          onFiltre={(cle) => setFiltre(cle as "all" | PropertyStatus)}
          tri={{
            libelle: t("manager.properties.sort.label"),
            valeur: tri,
            onChange: (v) => setTri(v as CritereTriBien),
            options: (["recent", "rentDesc", "rentAsc", "surfaceDesc", "title"] as const).map((cle) => ({
              valeur: { recent: "recent", rentDesc: "loyerDesc", rentAsc: "loyerAsc", surfaceDesc: "surfaceDesc", title: "titre" }[cle],
              libelle: t(`manager.properties.sort.${cle}`),
            })),
          }}
        >
          <div role="group" aria-label={t("manager.liste.view.label")} className="inline-flex border border-slate-400">
            {(["cartes", "tableau"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vue === v}
                onClick={() => changerVue(v)}
                className={`flex cursor-pointer items-center gap-1.5 border-r border-slate-400 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 ${
                  vue === v ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100"
                }`}
              >
                {v === "cartes" ? <LayoutGrid size={13} aria-hidden="true" /> : <Table2 size={13} aria-hidden="true" />}
                {t(v === "cartes" ? "manager.liste.view.cards" : "manager.liste.view.table")}
              </button>
            ))}
          </div>
          <button type="button" onClick={exporterCsv} className={BOUTON_TRAIT}>
            <Download size={13} aria-hidden="true" />
            {t("manager.liste.exportCsv")}
          </button>
        </BarreListe>
      )}

      {!loading && afficherOutils && (
        <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
          {t(totalPages > 1 ? "manager.liste.shownOnPage" : "manager.liste.shown", { shown: visibles.length, total: properties.length })}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <PropertyCardSkeleton key={i} />
          ))}
        </div>
      ) : properties.length === 0 && !showForm ? (
        <EmptyState
          icon={Building2}
          title={t("manager.properties.emptyTitle")}
          description={t("manager.properties.emptyDesc")}
          action={{ label: t("manager.properties.addBtn"), onClick: openCreate }}
        />
      ) : visibles.length === 0 && properties.length > 0 ? (
        <div className="border border-slate-300 bg-white p-8 text-center shadow-[inset_4px_0_0_var(--color-ink-900)]">
          <p className="text-sm text-slate-700">{t("manager.liste.noResult")}</p>
          {filtresActifs && (
            <button
              type="button"
              onClick={() => {
                setRecherche("");
                setFiltre("all");
              }}
              className={`${BOUTON_TRAIT} mt-4`}
            >
              {t("manager.liste.resetFilters")}
            </button>
          )}
        </div>
      ) : vue === "tableau" && afficherOutils ? (
        <div className="relative overflow-x-auto border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">{t("manager.properties.table.title")}</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">{t("manager.properties.table.surface")}</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">{t("manager.properties.table.rent")}</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">{t("manager.properties.table.perM2")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t("manager.properties.table.status")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t("manager.properties.table.owner")}</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">{t("common.actions.column")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibles.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <p className="font-semibold text-slate-900">{p.title}</p>
                    <p className="text-xs text-slate-600">{p.address}</p>
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums">{p.surface} m²</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink-900">{formatMoney(p.rent, p.currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{loyerM2Formate(p) ?? "—"}</td>
                  <td className="px-4 py-3"><Badge status={p.status} /></td>
                  <td className="px-4 py-3 text-xs text-slate-700">{(p.ownerId && nomsProprietaires.get(p.ownerId)) || <span className="text-slate-500">{t("manager.properties.noOwnerShort")}</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-4 text-xs font-semibold">
                      <button onClick={() => openEdit(p)} className="cursor-pointer border-b border-ink-900/40 text-ink-900 hover:border-orange-700 hover:text-orange-700">{t("common.actions.edit")}</button>
                      <button onClick={() => handleDelete(p)} className="cursor-pointer border-b border-rose-700/40 text-rose-700 hover:border-rose-700">{t("common.actions.delete")}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((p, rang) => (
            <article key={p.id} className="group flex flex-col justify-between overflow-hidden border border-slate-300 bg-white transition-colors duration-200 hover:border-ink-900">
              <div>
                <div className="relative h-44 overflow-hidden border-b border-slate-300 bg-slate-100">
                  {p.imageUrl ? (
                    <img
                      src={fileUrl(p.imageUrl) ?? undefined}
                      alt={p.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
                    />
                  ) : (
                    <PlanLogement id={p.id} className="h-full w-full" />
                  )}
                  <div className="absolute right-3 top-3 z-10">
                    <Badge status={p.status} />
                  </div>
                  {/* Numéro de fiche, comme l'étiquette d'une planche de plan. */}
                  <span aria-hidden="true" className="absolute bottom-0 left-0 z-10 bg-ink-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white">
                    {String((page - 1) * PAGE_SIZE + rang + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="p-4 sm:p-5">
                  <h3 className="text-base font-bold leading-snug text-slate-900">{p.title}</h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                    <MapPin size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                    <span className="line-clamp-1">{p.address}</span>
                  </p>
                  {/* Fiche technique : deux cases, libellé en police technique, valeur aux chiffres alignés. */}
                  <dl className="mt-4 grid grid-cols-2 divide-x divide-slate-300 border border-slate-300">
                    <div className="px-3 py-2">
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.properties.fields.surface")}</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{p.surface} m²</dd>
                    </div>
                    <div className="px-3 py-2">
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.properties.fields.rent")}</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                        {formatMoney(p.rent, p.currency)} <span className="text-xs font-normal text-slate-600">{t("manager.properties.perMonth")}</span>
                      </dd>
                      {loyerM2Formate(p) && <dd className="font-mono text-[10px] tabular-nums text-slate-600">{t("manager.properties.perM2", { amount: loyerM2Formate(p) })}</dd>}
                    </div>
                  </dl>
                  <p className="mt-3 font-mono text-[11px] text-slate-600">
                    {p.ownerId && nomsProprietaires.get(p.ownerId) ? t("manager.properties.ownerLine", { name: nomsProprietaires.get(p.ownerId) }) : t("manager.properties.noOwnerShort")}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-300 border-t border-slate-300 text-xs font-semibold">{actionsLigne(p)}</div>
            </article>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
