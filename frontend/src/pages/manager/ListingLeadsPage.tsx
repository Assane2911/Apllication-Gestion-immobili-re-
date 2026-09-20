import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, liste } from "../../api/client";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import type { Listing, LeadStatus, ListingLead, PaginatedResponse } from "../../types";

const STATUS_OPTIONS: LeadStatus[] = ["NEW", "CONTACTED", "VISITED", "CONVERTED", "ARCHIVED"];
const PAGE_SIZE = 20;
// Pour le sélecteur "annonce" du filtre : liste complète en une page plutôt
// que de paginer un simple menu déroulant (même logique que le sélecteur
// propriétaire de PropertiesPage.tsx).
const LISTINGS_PAGE_SIZE = 100;

export default function ListingLeadsPage() {
  const { t, i18n } = useTranslation();
  const [leads, setLeads] = useState<ListingLead[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "ALL">("ALL");
  const [listingFilter, setListingFilter] = useState<string>("ALL");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  function load() {
    api
      .get<PaginatedResponse<ListingLead>>("/listings/leads", {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
          ...(listingFilter !== "ALL" ? { listingId: listingFilter } : {}),
        },
      })
      .then((res) => {
        setLeads(liste<ListingLead>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, statusFilter, listingFilter]);

  useEffect(() => {
    api
      .get<PaginatedResponse<Listing>>("/listings", { params: { page: 1, pageSize: LISTINGS_PAGE_SIZE } })
      .then((res) => setListings(liste<Listing>(res.data, "items")))
      .catch(() => setListings([]));
  }, []);

  function handleStatusFilterChange(value: LeadStatus | "ALL") {
    setStatusFilter(value);
    setPage(1);
  }

  function handleListingFilterChange(value: string) {
    setListingFilter(value);
    setPage(1);
  }

  async function updateStatus(lead: ListingLead, status: LeadStatus) {
    try {
      await api.patch(`/listings/leads/${lead.id}`, {
        status,
        notes: notes[lead.id] ?? lead.notes ?? undefined,
      });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.listingLeads.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.listingLeads.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/annonces" className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline mr-2">
            {t("manager.listingLeads.backToListings")}
          </Link>
          <select
            aria-label={t("manager.listingLeads.filterByListing")}
            value={listingFilter}
            onChange={(e) => handleListingFilterChange(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
          >
            <option value="ALL">{t("manager.listingLeads.allListings")}</option>
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>{listing.title}</option>
            ))}
          </select>
          <select
            aria-label={t("manager.listingLeads.filterByStatus")}
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value as LeadStatus | "ALL")}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
          >
            <option value="ALL">{t("manager.listingLeads.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{t(`common.status.${s}`)}</option>
            ))}
          </select>
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

      {!loading && leads.length === 0 ? (
        <EmptyState
          icon="📞"
          title={t("manager.listingLeads.emptyTitle")}
          description={t("manager.listingLeads.emptyDesc")}
        />
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {leads.map((lead) => (
          <div key={lead.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between">
            <div className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base">{lead.prospectName}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{lead.listingTitle}</p>
                </div>
                <Badge status={lead.status} />
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
                <p>{lead.prospectEmail}</p>
                <p>{lead.prospectPhone}</p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {t(`manager.listingLeads.requestTypes.${lead.requestType}`)}
                </span>
                {lead.preferredDate && (
                  <span className="text-slate-500 dark:text-slate-400">
                    {t("manager.listingLeads.preferredDate")} {new Date(lead.preferredDate).toLocaleDateString(i18n.language)}
                  </span>
                )}
              </div>

              {lead.message && (
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
                  {lead.message}
                </p>
              )}

              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {new Date(lead.createdAt).toLocaleDateString(i18n.language)}
              </p>

              <div>
                <label htmlFor={`lead-notes-${lead.id}`} className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {t("manager.listingLeads.notesLabel")}
                </label>
                <textarea
                  id={`lead-notes-${lead.id}`}
                  placeholder={t("manager.listingLeads.notesPlaceholder")}
                  defaultValue={lead.notes ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [lead.id]: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs focus:ring-2 focus:ring-brand-500"
                  rows={2}
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("manager.listingLeads.changeStatus")}</span>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(lead, s)}
                    disabled={lead.status === s}
                    className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                      lead.status === s
                        ? "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 border-slate-300 dark:border-slate-600 cursor-default"
                        : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 cursor-pointer"
                    }`}
                  >
                    <Badge status={s} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
