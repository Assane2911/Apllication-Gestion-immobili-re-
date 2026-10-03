import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, fileUrl, isRequestCancelled, liste } from "../api/client";
import VitrineHeader from "../components/VitrineHeader";
import type { Listing, ListingType, PaginatedResponse } from "../types";
import { countryLabel } from "../utils/countries";

const LISTING_TYPES: ListingType[] = ["RENT", "SALE", "PROMOTION", "LAND", "OTHER"];
const PAGE_SIZE = 12;

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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <VitrineHeader />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100">{t("vitrine.title")}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">{t("vitrine.subtitle")}</p>
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
          <p className="text-center py-16 text-sm text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
            {t("vitrine.empty")}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {listings.map((listing) => (
            <Link
              key={listing.id}
              to={`/vitrine/annonces/${listing.id}`}
              className="group text-left bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 overflow-hidden cursor-pointer block"
            >
              <div className="relative h-40 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                {listing.imageUrl ? (
                  <img src={fileUrl(listing.imageUrl) ?? undefined} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                    <Building2 size={40} strokeWidth={1.5} aria-hidden="true" />
                  </div>
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
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-1">
                  {listing.location}
                  {listing.country ? ` · ${countryLabel(listing.country, i18n.language)}` : ""}
                </p>
                <div className="flex items-center justify-between text-xs mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-md">
                    {t(`manager.listings.types.${listing.type}`)}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {new Intl.NumberFormat("fr-FR").format(listing.price)} {listing.currency}
                  </span>
                </div>
              </div>
            </Link>
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
            <span className="text-xs text-slate-600 dark:text-slate-400 px-1">{t("common.pagination.pageOf", { page, totalPages })}</span>
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
    </div>
  );
}
