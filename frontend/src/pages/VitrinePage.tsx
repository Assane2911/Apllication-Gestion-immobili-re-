import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, fileUrl, isRequestCancelled, liste } from "../api/client";
import LanguageSwitcher from "../components/LanguageSwitcher";
import type { Listing, ListingType, LeadRequestType, PaginatedResponse } from "../types";
import { countryLabel } from "../utils/countries";

const LISTING_TYPES: ListingType[] = ["RENT", "SALE", "PROMOTION", "LAND", "OTHER"];
const PAGE_SIZE = 12;

const emptyLeadForm = {
  prospectName: "",
  prospectEmail: "",
  prospectPhone: "",
  requestType: "VISIT" as LeadRequestType,
  preferredDate: "",
  message: "",
};

export default function VitrinePage() {
  const { t, i18n } = useTranslation();
  const [listings, setListings] = useState<Listing[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<ListingType | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [selected, setSelected] = useState<Listing | null>(null);
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadSuccess, setLeadSuccess] = useState(false);

  function load(signal?: AbortSignal) {
    setLoading(true);
    api
      .get<PaginatedResponse<Listing>>("/listings/public", {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(countryFilter !== "ALL" ? { country: countryFilter } : {}),
          ...(typeFilter !== "ALL" ? { type: typeFilter } : {}),
        },
        signal,
      })
      .then((res) => {
        setListings(liste<Listing>(res.data, "items"));
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
  }, [page, countryFilter, typeFilter]);

  useEffect(() => {
    api
      .get<{ countries: string[] }>("/listings/public/countries")
      .then((res) => setCountries(res.data.countries ?? []))
      .catch(() => setCountries([]));
  }, []);

  function handleCountryChange(value: string) {
    setCountryFilter(value);
    setPage(1);
  }

  function handleTypeChange(value: ListingType | "ALL") {
    setTypeFilter(value);
    setPage(1);
  }

  function openDetail(listing: Listing) {
    setSelected(listing);
    setLeadForm(emptyLeadForm);
    setLeadError(null);
    setLeadSuccess(false);
  }

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLeadSubmitting(true);
    setLeadError(null);
    try {
      await api.post(`/listings/public/${selected.id}/leads`, {
        prospectName: leadForm.prospectName,
        prospectEmail: leadForm.prospectEmail,
        prospectPhone: leadForm.prospectPhone,
        requestType: leadForm.requestType,
        ...(leadForm.preferredDate ? { preferredDate: leadForm.preferredDate } : {}),
        ...(leadForm.message ? { message: leadForm.message } : {}),
      });
      setLeadSuccess(true);
    } catch (err) {
      setLeadError(apiErrorMessage(err));
    } finally {
      setLeadSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-16 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Link to="/landing" className="flex items-center gap-2.5 min-w-0">
            <img src="/app-icon.png" alt="Logo" className="w-8 h-8 rounded-xl shadow shrink-0" />
            <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{t("vitrine.brand")}</span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link to="/login" className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap">
              {t("vitrine.managerLogin")}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100">{t("vitrine.title")}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-2xl">{t("vitrine.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label={t("vitrine.filterByCountry")}
            value={countryFilter}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
          >
            <option value="ALL">{t("vitrine.allCountries")}</option>
            {countries.map((code) => (
              <option key={code} value={code}>{countryLabel(code, i18n.language)}</option>
            ))}
          </select>
          <select
            aria-label={t("vitrine.filterByType")}
            value={typeFilter}
            onChange={(e) => handleTypeChange(e.target.value as ListingType | "ALL")}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
          >
            <option value="ALL">{t("vitrine.allTypes")}</option>
            {LISTING_TYPES.map((type) => (
              <option key={type} value={type}>{t(`manager.listings.types.${type}`)}</option>
            ))}
          </select>
        </div>

        {loadError && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <button onClick={() => load()} className="underline font-semibold shrink-0 whitespace-nowrap">
              {t("common.actions.retry")}
            </button>
          </div>
        )}

        {!loading && listings.length === 0 && !loadError && (
          <p className="text-center py-16 text-sm text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
            {t("vitrine.empty")}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {listings.map((listing) => (
            <button
              key={listing.id}
              onClick={() => openDetail(listing)}
              className="group text-left bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 overflow-hidden cursor-pointer"
            >
              <div className="relative h-40 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                {listing.imageUrl ? (
                  <img src={fileUrl(listing.imageUrl) ?? undefined} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-4xl">🏘️</div>
                )}
                {listing.featured && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold text-white bg-amber-500 px-2 py-0.5 rounded-full shadow-sm">
                    {t("manager.listings.featuredBadge")}
                  </span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm leading-snug group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors line-clamp-1">
                  {listing.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                  {listing.location}
                  {listing.country ? ` · ${countryLabel(listing.country, i18n.language)}` : ""}
                </p>
                <div className="flex items-center justify-between text-xs mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-md">
                    {t(`manager.listings.types.${listing.type}`)}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {new Intl.NumberFormat("fr-FR").format(listing.price)} {listing.currency}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-40"
            >
              {t("common.pagination.previous")}
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400 px-1">{t("common.pagination.pageOf", { page, totalPages })}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-40"
            >
              {t("common.pagination.next")}
            </button>
          </div>
        )}
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="relative h-56 bg-slate-100 dark:bg-slate-800">
              {selected.imageUrl ? (
                <img src={fileUrl(selected.imageUrl) ?? undefined} alt={selected.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-5xl">🏘️</div>
              )}
              <button
                onClick={() => setSelected(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-900/70 text-white flex items-center justify-center text-sm hover:bg-slate-900"
                aria-label={t("common.actions.close")}
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{selected.title}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {selected.location}
                  {selected.country ? ` · ${countryLabel(selected.country, i18n.language)}` : ""}
                </p>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{selected.description}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {t(`manager.listings.types.${selected.type}`)}
                </span>
                {selected.surface != null && (
                  <span className="font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {selected.surface} m²
                  </span>
                )}
                {selected.rooms != null && (
                  <span className="font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {t("vitrine.roomsCount", { count: selected.rooms })}
                  </span>
                )}
                <span className="ml-auto font-bold text-lg text-slate-900 dark:text-slate-100">
                  {new Intl.NumberFormat("fr-FR").format(selected.price)} {selected.currency}
                  {selected.pricePeriod === "MONTH" && (
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400"> {t("manager.listings.perMonth")}</span>
                  )}
                </span>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                {leadSuccess ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium text-center py-4">{t("vitrine.leadForm.success")}</p>
                ) : (
                  <form onSubmit={handleLeadSubmit} className="space-y-3">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("vitrine.leadForm.title")}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="lead-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t("vitrine.leadForm.name")}</label>
                        <input id="lead-name" required value={leadForm.prospectName} onChange={(e) => setLeadForm({ ...leadForm, prospectName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label htmlFor="lead-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t("vitrine.leadForm.email")}</label>
                        <input id="lead-email" required type="email" value={leadForm.prospectEmail} onChange={(e) => setLeadForm({ ...leadForm, prospectEmail: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label htmlFor="lead-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t("vitrine.leadForm.phone")}</label>
                        <input id="lead-phone" required value={leadForm.prospectPhone} onChange={(e) => setLeadForm({ ...leadForm, prospectPhone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t("vitrine.leadForm.requestType")}</label>
                        <div className="flex items-center gap-4 h-[38px]">
                          <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                            <input type="radio" name="requestType" checked={leadForm.requestType === "VISIT"} onChange={() => setLeadForm({ ...leadForm, requestType: "VISIT" })} />
                            {t("manager.listingLeads.requestTypes.VISIT")}
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                            <input type="radio" name="requestType" checked={leadForm.requestType === "INFO"} onChange={() => setLeadForm({ ...leadForm, requestType: "INFO" })} />
                            {t("manager.listingLeads.requestTypes.INFO")}
                          </label>
                        </div>
                      </div>
                      {leadForm.requestType === "VISIT" && (
                        <div>
                          <label htmlFor="lead-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t("vitrine.leadForm.preferredDate")}</label>
                          <input id="lead-date" type="date" value={leadForm.preferredDate} onChange={(e) => setLeadForm({ ...leadForm, preferredDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
                        </div>
                      )}
                      <div className="sm:col-span-2">
                        <label htmlFor="lead-message" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t("vitrine.leadForm.message")}</label>
                        <textarea id="lead-message" value={leadForm.message} onChange={(e) => setLeadForm({ ...leadForm, message: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
                      </div>
                    </div>
                    {leadError && <p className="text-xs text-red-600 dark:text-red-400">{leadError}</p>}
                    <button type="submit" disabled={leadSubmitting} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                      {leadSubmitting ? t("common.actions.saving") : t("vitrine.leadForm.submit")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
