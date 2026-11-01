import { Heart, SearchX } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../api/client";
import CarteAnnonce from "../components/CarteAnnonce";
import PiedVitrine from "../components/PiedVitrine";
import { useFavorisVitrine } from "../hooks/useFavorisVitrine";
import { resumeAnnonce } from "../utils/favorisVitrine";
import Seo from "../components/Seo";
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
  const [total, setTotal] = useState<number | null>(null);
  // « Toutes » ou « Mes favoris » : les favoris vivent dans le navigateur du visiteur, pas sur le serveur.
  const [vue, setVue] = useState<"toutes" | "favoris">("toutes");
  const { favoris, basculer, estFavori } = useFavorisVitrine();

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
        setTotal(typeof res.data.total === "number" ? res.data.total : null);
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

  function reinitialiser() {
    setCountryFilter("ALL");
    setTypeFilter("ALL");
    setPage(1);
  }

  const filtresActifs = countryFilter !== "ALL" || typeFilter !== "ALL";
  const champ = "border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20";

  return (
    <div className="min-h-screen">
      <Seo title={t("seo.vitrine.title")} description={t("seo.vitrine.description")} canonical="/vitrine" />
      <VitrineHeader />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <div className="border border-slate-300 bg-white">
          <div aria-hidden="true" className="bande-motif h-2" />
          <div className="flex flex-wrap items-end justify-between gap-4 p-6 sm:p-8">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("vitrine.kicker")}</p>
              <h1 className="mt-1 text-2xl font-extrabold text-ink-900 sm:text-3xl">{t("vitrine.title")}</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">{t("vitrine.subtitle")}</p>
            </div>
            {vue === "toutes" && total !== null && !loadError && (
              <p className="border border-ink-900 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t("vitrine.count", { count: total })}</p>
            )}
          </div>
        </div>

        {/* Toutes les annonces, ou celles que le visiteur a mises de côté. */}
        <div role="group" aria-label={t("vitrine.favorites.viewLabel")} className="flex border border-slate-400 bg-white sm:inline-flex">
          {(
            [
              ["toutes", t("vitrine.favorites.all")],
              ["favoris", `${t("vitrine.favorites.tab")} · ${favoris.length}`],
            ] as const
          ).map(([cle, libelle]) => (
            <button
              key={cle}
              type="button"
              aria-pressed={vue === cle}
              onClick={() => setVue(cle)}
              className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                vue === cle ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              {libelle}
            </button>
          ))}
        </div>

        {vue === "toutes" ? (
          <>
            <div className="space-y-3">
              {/* Le type d'annonce, en onglets : un clic, sans ouvrir de menu. */}
              <div role="group" aria-label={t("vitrine.filterByType")} className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex">
                {(["ALL", ...LISTING_TYPES] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={typeFilter === type}
                    onClick={() => handleTypeChange(type)}
                    className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                      typeFilter === type ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    {type === "ALL" ? t("vitrine.allTypes") : t(`manager.listings.types.${type}`)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select aria-label={t("vitrine.filterByCountry")} value={countryFilter} onChange={(e) => handleCountryChange(e.target.value)} className={champ}>
                  <option value="ALL">{t("vitrine.allCountries")}</option>
                  {countries.map((code) => (
                    <option key={code} value={code}>{countryLabel(code, i18n.language)}</option>
                  ))}
                </select>
                {filtresActifs && (
                  <button
                    type="button"
                    onClick={reinitialiser}
                    className="cursor-pointer border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
                  >
                    {t("vitrine.resetFilters")}
                  </button>
                )}
              </div>
            </div>

            {loadError && (
              <div className="flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                <span>{loadError}</span>
                <button onClick={() => load()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
                  {t("common.actions.retry")}
                </button>
              </div>
            )}

            {!loading && listings.length === 0 && !loadError && (
              <div className="border border-dashed border-slate-400 bg-white px-6 py-14 text-center">
                <SearchX size={28} aria-hidden="true" className="mx-auto mb-3 text-slate-500" />
                <p className="text-sm text-slate-600">{t("vitrine.empty")}</p>
                {filtresActifs && (
                  <button
                    type="button"
                    onClick={reinitialiser}
                    className="mt-4 cursor-pointer border border-ink-900 px-4 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
                  >
                    {t("vitrine.resetFilters")}
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => (
                <CarteAnnonce key={listing.id} annonce={resumeAnnonce(listing)} favori={estFavori(listing.id)} onBasculerFavori={basculer} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="cursor-pointer border border-slate-400 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:cursor-default disabled:opacity-40 disabled:hover:border-slate-400"
                >
                  {t("common.pagination.previous")}
                </button>
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-700">{t("common.pagination.pageOf", { page, totalPages })}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="cursor-pointer border border-slate-400 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:cursor-default disabled:opacity-40 disabled:hover:border-slate-400"
                >
                  {t("common.pagination.next")}
                </button>
              </div>
            )}
          </>
        ) : favoris.length === 0 ? (
          <div className="border border-dashed border-slate-400 bg-white px-6 py-14 text-center">
            <Heart size={28} aria-hidden="true" className="mx-auto mb-3 text-slate-500" />
            <p className="mx-auto max-w-md text-sm text-slate-600">{t("vitrine.favorites.empty")}</p>
          </div>
        ) : (
          <>
            <p className="max-w-2xl text-xs text-slate-600">{t("vitrine.favorites.note")}</p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {favoris.map((annonce) => (
                <CarteAnnonce key={annonce.id} annonce={annonce} favori onBasculerFavori={basculer} />
              ))}
            </div>
          </>
        )}
      </main>

      <PiedVitrine />
    </div>
  );
}
