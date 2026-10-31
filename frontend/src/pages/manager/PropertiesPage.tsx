import { Building2, MapPin, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, fileUrl, isRequestCancelled, liste, MAX_UPLOAD_SIZE_MB } from "../../api/client";
import { preparerFichier } from "../../utils/fichiers";
import PlanLogement from "../../components/PlanLogement";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { PropertyCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { Owner, PaginatedResponse, Property, PropertyStatus } from "../../types";
import Bulle from "../../components/Bulle";

const emptyForm = { title: "", address: "", surface: "", rent: "", status: "AVAILABLE" as PropertyStatus, description: "", ownerId: "" };
const PAGE_SIZE = 20;
// Pour le sélecteur "propriétaire" du formulaire : on récupère la liste complète en une
// page (max autorisé par l'API) plutôt que de paginer un simple menu déroulant.
const OWNERS_PAGE_SIZE = 100;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.properties.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.properties.count", { count: Math.max(total, properties.length) })}</p>
        </div>
        <Bulle texte={t("manager.tips.propertyCreate")}>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {t("manager.properties.addBtn")}
        </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={() => load()} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl border border-contour-200 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 mb-4">{editing ? t("manager.properties.formTitleEdit") : t("manager.properties.formTitleNew")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="property-title" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.title")}</label>
              <input id="property-title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-address" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.address")}</label>
              <input id="property-address" required maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-surface" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.surface")}</label>
              <input id="property-surface" required type="number" step="0.1" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-rent" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.rent")}</label>
              <input id="property-rent" required type="number" step="0.01" value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-status" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.status")}</label>
              <select id="property-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PropertyStatus })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm">
                <option value="AVAILABLE">{t("common.status.AVAILABLE")}</option>
                <option value="OCCUPIED">{t("common.status.OCCUPIED")}</option>
                <option value="MAINTENANCE">{t("common.status.MAINTENANCE")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="property-owner" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.owner")}</label>
              <select id="property-owner" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm">
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
              <label htmlFor="property-image" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.image")}</label>
              <input id="property-image" type="file" accept="image/*" onChange={(e) => void choisirImage(e)} className="w-full text-sm text-slate-700" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="property-description" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.properties.fields.description")}</label>
              <textarea id="property-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm" rows={3} />
            </div>
            {error && <p role="alert" className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-600 px-4 py-2">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {properties.map((p, rang) => (
          <article
            key={p.id}
            className="group bg-white border border-contour-200/90 hover:border-ink-900 transition-colors duration-200 overflow-hidden flex flex-col justify-between"
          >
            <div>
              <div className="relative h-44 bg-slate-100 border-b border-slate-300 overflow-hidden">
                {p.imageUrl ? (
                  <img
                    src={fileUrl(p.imageUrl) ?? undefined}
                    alt={p.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 motion-reduce:transform-none"
                  />
                ) : (
                  <PlanLogement id={p.id} className="w-full h-full" />
                )}
                <div className="absolute top-3 right-3 z-10">
                  <Badge status={p.status} />
                </div>
                {/* Numéro de fiche, comme l'étiquette d'une planche de plan. */}
                <span aria-hidden="true" className="absolute bottom-0 left-0 z-10 bg-ink-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white">
                  {String((page - 1) * PAGE_SIZE + rang + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="font-bold text-slate-900 text-base leading-snug">{p.title}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                  <MapPin size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                  <span className="line-clamp-1">{p.address}</span>
                </p>
                {/* Fiche technique : deux cases, libellé en police technique, valeur aux chiffres alignés. */}
                <dl className="mt-4 grid grid-cols-2 border border-slate-300 divide-x divide-slate-300">
                  <div className="px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.properties.fields.surface")}</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{p.surface} m²</dd>
                  </div>
                  <div className="px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.properties.fields.rent")}</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(p.rent, p.currency)} <span className="text-xs font-normal text-slate-600">{t("manager.properties.perMonth")}</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-300 border-t border-slate-300 text-xs font-semibold">
              <Bulle texte={t("manager.tips.propertyEdit")} className="block">
                <button
                  onClick={() => openEdit(p)}
                  className="flex w-full items-center justify-center gap-1.5 py-2.5 text-slate-700 hover:bg-slate-100 hover:text-ink-900 transition-colors cursor-pointer"
                >
                  <Pencil size={13} aria-hidden="true" />
                  {t("common.actions.edit")}
                </button>
              </Bulle>
              <Bulle texte={t("manager.tips.propertyDelete")} className="block">
                <button
                  onClick={() => handleDelete(p)}
                  className="flex w-full items-center justify-center gap-1.5 py-2.5 text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {t("common.actions.delete")}
                </button>
              </Bulle>
            </div>
          </article>
        ))}
      </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
