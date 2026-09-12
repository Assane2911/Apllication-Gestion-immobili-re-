import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { PropertyCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { PaginatedResponse, Property, PropertyStatus } from "../../types";

const emptyForm = { title: "", address: "", surface: "", rent: "", status: "AVAILABLE" as PropertyStatus, description: "" };
const PAGE_SIZE = 20;

export default function PropertiesPage() {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [properties, setProperties] = useState<Property[]>([]);
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

  function load() {
    api
      .get<PaginatedResponse<Property>>("/properties", { params: { page, pageSize: PAGE_SIZE } })
      .then((res) => {
        setProperties(res.data.items);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);

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
    });
    setImage(null);
    setShowForm(true);
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
      if (image) data.append("image", image);

      if (editing) {
        await api.put(`/properties/${editing.id}`, data);
      } else {
        await api.post("/properties", data);
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.properties.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.properties.count", { count: properties.length })}</p>
        </div>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {t("manager.properties.addBtn")}
        </button>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={load} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">{editing ? t("manager.properties.formTitleEdit") : t("manager.properties.formTitleNew")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="property-title" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.title")}</label>
              <input id="property-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-address" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.address")}</label>
              <input id="property-address" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-surface" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.surface")}</label>
              <input id="property-surface" required type="number" step="0.1" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-rent" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.rent")}</label>
              <input id="property-rent" required type="number" step="0.01" value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="property-status" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.status")}</label>
              <select id="property-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PropertyStatus })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="AVAILABLE">{t("common.status.AVAILABLE")}</option>
                <option value="OCCUPIED">{t("common.status.OCCUPIED")}</option>
                <option value="MAINTENANCE">{t("common.status.MAINTENANCE")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="property-image" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.image")}</label>
              <input id="property-image" type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="w-full text-sm text-slate-700 dark:text-slate-300" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="property-description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.properties.fields.description")}</label>
              <textarea id="property-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" rows={3} />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 dark:text-slate-400 px-4 py-2">
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
        {properties.map((p) => (
          <div
            key={p.id}
            className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs hover:shadow-md dark:hover:shadow-slate-950/50 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 overflow-hidden flex flex-col justify-between"
          >
            <div>
              <div className="relative h-40 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                {p.imageUrl ? (
                  <img
                    src={fileUrl(p.imageUrl) ?? undefined}
                    alt={p.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-4xl">
                    🏠
                  </div>
                )}
                <div className="absolute top-3 right-3 z-10">
                  <Badge status={p.status} />
                </div>
              </div>
              <div className="p-4 sm:p-5">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-snug group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                  {p.title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{p.address}</p>
                <div className="flex items-center justify-between text-xs sm:text-sm mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-md">
                    {p.surface} m²
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {formatMoney(p.rent, p.currency)} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t("manager.properties.perMonth")}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-5 pb-4 pt-1 flex items-center justify-end gap-2 border-t border-slate-50 dark:border-slate-800/40">
              <button
                onClick={() => openEdit(p)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {t("common.actions.edit")}
              </button>
              <button
                onClick={() => handleDelete(p)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                {t("common.actions.delete")}
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
