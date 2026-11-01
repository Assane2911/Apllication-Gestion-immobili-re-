import { CalendarDays, Mail, PhoneCall, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Initiales from "../../components/Initiales";
import Pagination from "../../components/Pagination";
import type { Listing, LeadStatus, ListingLead, PaginatedResponse } from "../../types";
import Bulle from "../../components/Bulle";
import { formaterJour } from "../../utils/jourCivil";

const STATUS_OPTIONS: LeadStatus[] = ["NEW", "CONTACTED", "VISITED", "CONVERTED", "ARCHIVED"];
const PAGE_SIZE = 20;

/** Filet de couleur de chaque fiche : l'orange signale ce qui attend une réponse, le vert une demande aboutie. */
const FILET_STATUT: Record<LeadStatus, string> = {
  NEW: "border-l-orange-700",
  CONTACTED: "border-l-ink-900",
  VISITED: "border-l-brand-600",
  CONVERTED: "border-l-emerald-600",
  ARCHIVED: "border-l-slate-400",
};
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

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<ListingLead>>("/listings/leads", {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
          ...(listingFilter !== "ALL" ? { listingId: listingFilter } : {}),
        },
        signal,
      })
      .then((res) => {
        setLeads(liste<ListingLead>(res.data, "items"));
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
  }, [page, statusFilter, listingFilter]);

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

  async function handleDelete(lead: ListingLead) {
    if (!confirm(t("manager.listingLeads.confirmDelete", { name: lead.prospectName }))) return;
    try {
      await api.delete(`/listings/leads/${lead.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.listingLeads.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.listingLeads.subtitle")}</p>
          {!loading && !loadError && <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.listingLeads.count", { count: total })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/annonces"
            className="border-b border-ink-900/40 pb-0.5 text-sm font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
          >
            {t("manager.listingLeads.backToListings")}
          </Link>
          <select
            aria-label={t("manager.listingLeads.filterByListing")}
            value={listingFilter}
            onChange={(e) => handleListingFilterChange(e.target.value)}
            className="max-w-xs border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">{t("manager.listingLeads.allListings")}</option>
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>{listing.title}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Le parcours d'une demande, de la réception à l'aboutissement : chaque étape est aussi un filtre. */}
      <div role="group" aria-label={t("manager.listingLeads.filterByStatus")} className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex">
        {(["ALL", ...STATUS_OPTIONS] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={statusFilter === s}
            onClick={() => handleStatusFilterChange(s)}
            className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
              statusFilter === s ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
            }`}
          >
            {s === "ALL" ? t("manager.listingLeads.allStatuses") : t(`common.status.${s}`)}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {!loading && leads.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title={t("manager.listingLeads.emptyTitle")}
          description={t("manager.listingLeads.emptyDesc")}
        />
      ) : (
        <div className="space-y-5">
          {leads.map((lead) => (
            <article key={lead.id} className={`border border-l-4 border-slate-300 bg-white ${FILET_STATUT[lead.status] ?? FILET_STATUT.ARCHIVED}`}>
              <div className="lg:grid lg:grid-cols-[17rem_1fr]">
                {/* Le contact : qui demande, comment le joindre, depuis quand. */}
                <div className="border-b border-slate-300 bg-slate-50 p-5 lg:border-b-0 lg:border-r">
                  <div className="flex items-center gap-3">
                    <Initiales prenom={lead.prospectName.split(/\s+/)[0]} nom={lead.prospectName.split(/\s+/)[1]} />
                    <h3 className="min-w-0 text-base font-bold leading-snug text-slate-900">{lead.prospectName}</h3>
                  </div>
                  <ul className="mt-4 space-y-2 text-xs">
                    <li className="flex items-center gap-2">
                      <Mail size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                      <a href={`mailto:${lead.prospectEmail}`} className="min-w-0 truncate border-b border-ink-900/40 font-mono text-slate-900 hover:border-orange-700 hover:text-orange-700">
                        {lead.prospectEmail}
                      </a>
                    </li>
                    <li className="flex items-center gap-2">
                      <Phone size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                      <a href={`tel:${lead.prospectPhone.replace(/\s+/g, "")}`} className="border-b border-ink-900/40 font-mono text-slate-900 hover:border-orange-700 hover:text-orange-700">
                        {lead.prospectPhone}
                      </a>
                    </li>
                  </ul>
                  <p className="mt-4 font-mono text-[11px] tabular-nums text-slate-600">{new Date(lead.createdAt).toLocaleDateString(i18n.language)}</p>
                </div>

                <div className="flex min-w-0 flex-col">
                  <div className="flex-1 space-y-4 p-5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="border border-orange-700/50 bg-orange-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-800">
                        {t(`manager.listingLeads.requestTypes.${lead.requestType}`)}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{lead.listingTitle}</span>
                      {lead.preferredDate && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                          <CalendarDays size={13} aria-hidden="true" className="text-orange-700" />
                          {t("manager.listingLeads.preferredDate")} {formaterJour(lead.preferredDate, i18n.language)}
                        </span>
                      )}
                    </div>

                    {lead.message && (
                      <p className="border-l-2 border-orange-700 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-800">{lead.message}</p>
                    )}

                    <div>
                      <label htmlFor={`lead-notes-${lead.id}`} className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        {t("manager.listingLeads.notesLabel")}
                      </label>
                      <textarea
                        id={`lead-notes-${lead.id}`}
                        placeholder={t("manager.listingLeads.notesPlaceholder")}
                        defaultValue={lead.notes ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [lead.id]: e.target.value }))}
                        className="w-full border border-slate-400 bg-white px-3 py-2 text-xs text-slate-900"
                        rows={2}
                      />
                    </div>
                  </div>

                  {/* Avancement de la demande : cinq cases, la case courante est pleine ; suppression à part, en lien. */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-slate-50 px-5 py-3">
                    <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.listingLeads.changeStatus")}</span>
                      <div role="group" aria-label={t("manager.listingLeads.changeStatus")} className="flex w-full flex-wrap border border-slate-400 bg-white sm:w-auto sm:flex-nowrap">
                        {STATUS_OPTIONS.map((s) => (
                          <Bulle key={s} texte={t("manager.tips.leadStatus")} className="flex flex-1 border-r border-slate-400 last:border-r-0">
                            <button
                              onClick={() => updateStatus(lead, s)}
                              disabled={lead.status === s}
                              aria-pressed={lead.status === s}
                              className={`w-full whitespace-nowrap px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                                lead.status === s ? "cursor-default bg-ink-900 text-white" : "cursor-pointer text-slate-800 hover:bg-slate-100"
                              }`}
                            >
                              {t(`common.status.${s}`)}
                            </button>
                          </Bulle>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(lead)}
                      className="cursor-pointer border-b border-rose-700/40 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-700"
                    >
                      {t("common.actions.delete")}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  );
}
