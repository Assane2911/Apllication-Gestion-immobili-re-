import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage, fileUrl, isRequestCancelled } from "../api/client";
import VitrineHeader from "../components/VitrineHeader";
import type { Listing, LeadRequestType } from "../types";
import { countryLabel } from "../utils/countries";

const emptyLeadForm = {
  prospectName: "",
  prospectEmail: "",
  prospectPhone: "",
  requestType: "VISIT" as LeadRequestType,
  preferredDate: "",
  message: "",
};

/**
 * Fiche individuelle d'une annonce de la vitrine publique, sur sa propre URL
 * (`/vitrine/annonces/:id`) — avant cette page, le détail d'une annonce ne
 * s'ouvrait que dans une modale JS, sans URL propre : invisible pour Google
 * et impossible à partager directement.
 */
export default function VitrineListingPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadSuccess, setLeadSuccess] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setNotFound(false);
    api
      .get<Listing>(`/listings/public/${id}`, { signal: controller.signal })
      .then((res) => {
        setListing(res.data);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (!listing) return;
    const previousTitle = document.title;
    document.title = `${listing.title} — ${listing.location} | ${t("vitrine.brand")}`;

    const meta = document.createElement("meta");
    meta.name = "description";
    meta.content = listing.description.slice(0, 160);
    document.head.appendChild(meta);

    return () => {
      document.title = previousTitle;
      meta.remove();
    };
  }, [listing, t]);

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!listing) return;
    setLeadSubmitting(true);
    setLeadError(null);
    try {
      await api.post(`/listings/public/${listing.id}/leads`, {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <VitrineHeader />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-16 flex justify-center">
          <span className="w-8 h-8 border-[3px] border-slate-200 dark:border-slate-700 border-t-brand-500 rounded-full animate-spin" />
        </main>
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <VitrineHeader />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("vitrine.notFound")}</p>
          <Link to="/vitrine" className="text-sm font-semibold text-brand-600 dark:text-brand-400 hover:underline">
            {t("vitrine.notFoundCta")}
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <VitrineHeader />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <Link to="/vitrine" className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
          {t("vitrine.backToListings")}
        </Link>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="relative h-56 bg-slate-100 dark:bg-slate-800">
            {listing.imageUrl ? (
              <img src={fileUrl(listing.imageUrl) ?? undefined} alt={listing.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                <Building2 size={48} strokeWidth={1.5} aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="p-6 space-y-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{listing.title}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {listing.location}
                {listing.country ? ` · ${countryLabel(listing.country, i18n.language)}` : ""}
              </p>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{listing.description}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {t(`manager.listings.types.${listing.type}`)}
              </span>
              {listing.surface != null && (
                <span className="font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {listing.surface} m²
                </span>
              )}
              {listing.rooms != null && (
                <span className="font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {t("vitrine.roomsCount", { count: listing.rooms })}
                </span>
              )}
              <span className="ml-auto font-bold text-lg text-slate-900 dark:text-slate-100">
                {new Intl.NumberFormat("fr-FR").format(listing.price)} {listing.currency}
                {listing.pricePeriod === "MONTH" && (
                  <span className="text-xs font-normal text-slate-600 dark:text-slate-400"> {t("manager.listings.perMonth")}</span>
                )}
              </span>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              {leadSuccess ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium text-center py-4">{t("vitrine.leadForm.success")}</p>
              ) : (
                <form onSubmit={handleLeadSubmit} className="space-y-3">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("vitrine.leadForm.title")}</h2>
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
      </main>
    </div>
  );
}
