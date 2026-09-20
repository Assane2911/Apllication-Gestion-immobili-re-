import { Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, fileUrl, liste } from "../../api/client";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { PropertyCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { Listing, ListingStatus, ListingType, PaginatedResponse, PricePeriod } from "../../types";
import { SUPPORTED_COUNTRY_CODES, countryLabel } from "../../utils/countries";

const LISTING_TYPES: ListingType[] = ["RENT", "SALE", "PROMOTION", "LAND", "OTHER"];
const PRICE_PERIODS: PricePeriod[] = ["MONTH", "ONE_TIME"];
const LISTING_STATUSES: ListingStatus[] = ["PUBLISHED", "DRAFT", "ARCHIVED"];

const emptyForm = {
  type: "RENT" as ListingType,
  title: "",
  description: "",
  price: "",
  currency: "EUR",
  pricePeriod: "MONTH" as PricePeriod,
  surface: "",
  rooms: "",
  location: "",
  country: "",
  contactPhone: "",
  contactWhatsapp: "",
  contactEmail: "",
  status: "PUBLISHED" as ListingStatus,
  featured: false,
};
const PAGE_SIZE = 20;

export default function ListingsPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
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
      .get<PaginatedResponse<Listing>>("/listings", { params: { page, pageSize: PAGE_SIZE } })
      .then((res) => {
        setListings(liste<Listing>(res.data, "items"));
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

  function openEdit(listing: Listing) {
    setEditing(listing);
    setForm({
      type: listing.type,
      title: listing.title,
      description: listing.description,
      price: String(listing.price),
      currency: listing.currency,
      pricePeriod: listing.pricePeriod,
      surface: listing.surface != null ? String(listing.surface) : "",
      rooms: listing.rooms != null ? String(listing.rooms) : "",
      location: listing.location,
      country: listing.country ?? "",
      contactPhone: listing.contactPhone ?? "",
      contactWhatsapp: listing.contactWhatsapp ?? "",
      contactEmail: listing.contactEmail ?? "",
      status: listing.status,
      featured: listing.featured,
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
      data.append("type", form.type);
      data.append("title", form.title);
      data.append("description", form.description);
      data.append("price", form.price);
      data.append("currency", form.currency);
      data.append("pricePeriod", form.pricePeriod);
      data.append("location", form.location);
      data.append("status", form.status);
      data.append("featured", String(form.featured));
      if (form.surface) data.append("surface", form.surface);
      if (form.rooms) data.append("rooms", form.rooms);
      // Une chaîne vide n'est pas envoyée : le backend traite l'absence du
      // champ comme "ne pas modifier" (updateListing utilise .partial()),
      // là où une chaîne vide échouerait par exemple la validation email.
      if (form.country) data.append("country", form.country);
      if (form.contactPhone) data.append("contactPhone", form.contactPhone);
      if (form.contactWhatsapp) data.append("contactWhatsapp", form.contactWhatsapp);
      if (form.contactEmail) data.append("contactEmail", form.contactEmail);
      if (image) data.append("image", image);

      if (editing) {
        await api.put(`/listings/${editing.id}`, data);
      } else {
        await api.post("/listings", data);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(listing: Listing) {
    if (!confirm(t("manager.listings.confirmDelete", { title: listing.title }))) return;
    try {
      await api.delete(`/listings/${listing.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.listings.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.listings.count", { count: listings.length })}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/leads" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
            {t("manager.listings.viewLeads")}
          </Link>
          <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {t("manager.listings.addBtn")}
          </button>
        </div>
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
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">
            {editing ? t("manager.listings.formTitleEdit") : t("manager.listings.formTitleNew")}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="listing-title" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.title")}</label>
              <input id="listing-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.type")}</label>
              <select id="listing-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ListingType })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                {LISTING_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`manager.listings.types.${type}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-price" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.price")}</label>
              <input id="listing-price" required type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-currency" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.currency")}</label>
              <input id="listing-currency" required value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-pricePeriod" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.pricePeriod")}</label>
              <select id="listing-pricePeriod" value={form.pricePeriod} onChange={(e) => setForm({ ...form, pricePeriod: e.target.value as PricePeriod })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                {PRICE_PERIODS.map((period) => (
                  <option key={period} value={period}>{t(`manager.listings.pricePeriods.${period}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-surface" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.surface")}</label>
              <input id="listing-surface" type="number" step="0.1" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-rooms" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.rooms")}</label>
              <input id="listing-rooms" type="number" step="1" min="1" value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-location" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.location")}</label>
              <input id="listing-location" required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-country" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.country")}</label>
              <select id="listing-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{t("manager.listings.fields.noCountry")}</option>
                {SUPPORTED_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>{countryLabel(code, i18n.language)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-status" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.status")}</label>
              <select id="listing-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ListingStatus })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                {LISTING_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(`common.status.${status}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-contactPhone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.contactPhone")}</label>
              <input id="listing-contactPhone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-contactWhatsapp" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.contactWhatsapp")}</label>
              <input id="listing-contactWhatsapp" value={form.contactWhatsapp} onChange={(e) => setForm({ ...form, contactWhatsapp: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-contactEmail" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.contactEmail")}</label>
              <input id="listing-contactEmail" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="listing-image" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.image")}</label>
              <input id="listing-image" type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="w-full text-sm text-slate-700 dark:text-slate-300" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input id="listing-featured" type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="rounded border-slate-300 dark:border-slate-700" />
              <label htmlFor="listing-featured" className="text-sm font-medium text-slate-700 dark:text-slate-300">{t("manager.listings.fields.featured")}</label>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="listing-description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.listings.fields.description")}</label>
              <textarea id="listing-description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" rows={3} />
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
      ) : listings.length === 0 && !showForm ? (
        <EmptyState
          icon={Megaphone}
          title={t("manager.listings.emptyTitle")}
          description={t("manager.listings.emptyDesc")}
          action={{ label: t("manager.listings.addBtn"), onClick: openCreate }}
        />
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {listings.map((listing) => (
          <div
            key={listing.id}
            className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs hover:shadow-md dark:hover:shadow-slate-950/50 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 overflow-hidden flex flex-col justify-between"
          >
            <div>
              <div className="relative h-40 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                {listing.imageUrl ? (
                  <img
                    src={fileUrl(listing.imageUrl) ?? undefined}
                    alt={listing.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-4xl">
                    🏘️
                  </div>
                )}
                <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5">
                  <Badge status={listing.status} />
                  {listing.featured && (
                    <span className="text-[10px] font-bold text-white bg-amber-500 px-2 py-0.5 rounded-full shadow-sm">
                      {t("manager.listings.featuredBadge")}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4 sm:p-5">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-snug group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                  {listing.title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                  {listing.location}
                  {listing.country ? ` · ${countryLabel(listing.country, i18n.language)}` : ""}
                </p>
                <div className="flex items-center justify-between text-xs sm:text-sm mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-md">
                    {t(`manager.listings.types.${listing.type}`)}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {formatMoney(listing.price, listing.currency)}{" "}
                    {listing.pricePeriod === "MONTH" && (
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t("manager.listings.perMonth")}</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-5 pb-4 pt-1 flex items-center justify-end gap-2 border-t border-slate-50 dark:border-slate-800/40">
              <button
                onClick={() => openEdit(listing)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {t("common.actions.edit")}
              </button>
              <button
                onClick={() => handleDelete(listing)}
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
