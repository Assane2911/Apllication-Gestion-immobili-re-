import { Building2, Heart, Mail, MessageCircle, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage, fileUrl, isRequestCancelled, liste } from "../api/client";
import CarteAnnonce from "../components/CarteAnnonce";
import PiedVitrine from "../components/PiedVitrine";
import SectionReglage from "../components/SectionReglage";
import { useFavorisVitrine } from "../hooks/useFavorisVitrine";
import { resumeAnnonce } from "../utils/favorisVitrine";
import JsonLd from "../components/JsonLd";
import BoutonPartager from "../components/BoutonPartager";
import Seo from "../components/Seo";
import VitrineHeader from "../components/VitrineHeader";
import type { Listing, LeadRequestType, PaginatedResponse } from "../types";
import { countryLabel } from "../utils/countries";
import { buildListingJsonLd } from "../utils/structuredData";
import ChampDate from "../components/ChampDate";

const champ =
  "w-full border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20";
const etiquette = "mb-1 block font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700";

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
  const [similaires, setSimilaires] = useState<Listing[]>([]);
  const { basculer, estFavori } = useFavorisVitrine();

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


  // Les annonces voisines (même type, même pays) : un complément de la page, qui ne la fait jamais échouer.
  useEffect(() => {
    if (!listing) return;
    let vivant = true;
    Promise.resolve(
      api.get<PaginatedResponse<Listing>>("/listings/public", {
        params: { page: 1, pageSize: 4, type: listing.type, ...(listing.country ? { country: listing.country } : {}) },
      })
    )
      .then((res) => {
        if (!vivant || !res?.data) return;
        setSimilaires(liste<Listing>(res.data, "items").filter((l) => l.id !== listing.id).slice(0, 3));
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [listing]);

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
      <div className="min-h-screen">
        <VitrineHeader />
        <main className="mx-auto flex max-w-2xl justify-center px-4 py-16 sm:px-6">
          <span className="size-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-ink-900" />
        </main>
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="min-h-screen">
        <VitrineHeader />
        <main className="mx-auto max-w-2xl space-y-4 px-4 py-16 text-center sm:px-6">
          <p className="text-sm text-slate-600">{t("vitrine.notFound")}</p>
          <Link to="/vitrine" className="inline-block border border-ink-900 px-4 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white">
            {t("vitrine.notFoundCta")}
          </Link>
        </main>
      </div>
    );
  }

  const prix = new Intl.NumberFormat(i18n.language).format(listing.price);
  const prixAuM2 = listing.surface && listing.surface > 0 ? listing.price / listing.surface : null;
  const favori = estFavori(listing.id);
  const telephone = listing.contactPhone?.trim() || null;
  const whatsapp = listing.contactWhatsapp?.replace(/\D/g, "") || null;
  const courriel = listing.contactEmail?.trim() || null;
  const contactDirect = Boolean(telephone || whatsapp || courriel);
  const caracteristiques: Array<[string, string]> = [
    [t("vitrine.details.type"), t(`manager.listings.types.${listing.type}`)],
    ...(listing.surface != null ? ([[t("vitrine.details.surface"), `${listing.surface} m²`]] as Array<[string, string]>) : []),
    ...(listing.rooms != null ? ([[t("vitrine.details.rooms"), t("vitrine.roomsCount", { count: listing.rooms })]] as Array<[string, string]>) : []),
    ...(prixAuM2 !== null
      ? ([
          [
            t("vitrine.details.pricePerSqm"),
            `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: prixAuM2 >= 100 ? 0 : 2 }).format(prixAuM2)} ${listing.currency} / m²${listing.pricePeriod === "MONTH" ? ` ${t("vitrine.perMonthShort")}` : ""}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(listing.country ? ([[t("vitrine.details.country"), countryLabel(listing.country, i18n.language)]] as Array<[string, string]>) : []),
    [t("vitrine.details.published"), new Date(listing.createdAt).toLocaleDateString(i18n.language)],
  ];

  return (
    <div className="min-h-screen">
      <Seo title={`${listing.title} — ${listing.location} | ${t("vitrine.brand")}`} description={listing.description.slice(0, 160)} canonical={`/vitrine/annonces/${listing.id}`} />
      <JsonLd data={buildListingJsonLd(listing)} />
      <VitrineHeader />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <Link to="/vitrine" className="inline-block border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700">
          {t("vitrine.backToListings")}
        </Link>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-6">
            <div className="border border-slate-300 bg-white">
              <div className="relative h-64 border-b border-slate-300 bg-slate-100 sm:h-96">
                {listing.imageUrl ? (
                  <img src={fileUrl(listing.imageUrl) ?? undefined} alt={listing.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="bande-motif absolute inset-0 flex items-center justify-center opacity-25" aria-hidden="true">
                    <Building2 size={56} strokeWidth={1.5} className="text-ink-900" />
                  </div>
                )}
                {listing.featured && (
                  <span className="absolute right-3 top-3 bg-orange-700 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">{t("manager.listings.featuredBadge")}</span>
                )}
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t(`manager.listings.types.${listing.type}`)}</p>
                    <h1 className="mt-1 text-2xl font-bold text-slate-900">{listing.title}</h1>
                    <p className="mt-1 text-sm text-slate-600">
                      {listing.location}
                      {listing.country ? ` · ${countryLabel(listing.country, i18n.language)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => basculer(resumeAnnonce(listing))}
                      aria-pressed={favori}
                      className="inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:border-orange-700 hover:text-orange-700"
                    >
                      <Heart size={14} aria-hidden="true" className={favori ? "fill-orange-700 text-orange-700" : ""} />
                      {favori ? t("vitrine.favorites.saved") : t("vitrine.favorites.save")}
                    </button>
                    <BoutonPartager url={`${window.location.origin}/vitrine/annonces/${listing.id}`} titre={listing.title} texte={`${listing.title} — ${listing.location}`} />
                  </div>
                </div>
                <p className="inline-block bg-ink-900 px-4 py-2 font-mono text-xl font-bold tabular-nums text-white">
                  {prix} {listing.currency}
                  {listing.pricePeriod === "MONTH" && <span className="ml-1 text-xs font-normal text-slate-300">{t("manager.listings.perMonth")}</span>}
                </p>
              </div>
            </div>

            <SectionReglage id="caracteristiques" numero="01" titre={t("vitrine.details.title")}>
              <dl className="grid grid-cols-1 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2">
                {caracteristiques.map(([libelle, valeur]) => (
                  <div key={libelle} className="bg-white px-4 py-3">
                    <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{libelle}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-900">{valeur}</dd>
                  </div>
                ))}
              </dl>
            </SectionReglage>

            <SectionReglage id="description" numero="02" titre={t("vitrine.details.description")}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{listing.description}</p>
            </SectionReglage>

            {similaires.length > 0 && (
              <SectionReglage id="similaires" numero="03" titre={t("vitrine.similar")}>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {similaires.map((annonce) => (
                    <CarteAnnonce key={annonce.id} annonce={resumeAnnonce(annonce)} favori={estFavori(annonce.id)} onBasculerFavori={basculer} />
                  ))}
                </div>
              </SectionReglage>
            )}
          </div>

          {/* À droite, le contact : joindre l'agence directement, ou lui envoyer une demande. */}
          <aside className="space-y-4 lg:sticky lg:top-24">
            {contactDirect && (
              <div className="border border-slate-300 bg-white p-4">
                <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">{t("vitrine.directContact.title")}</p>
                <div className="grid gap-2">
                  {telephone && (
                    <a href={`tel:${telephone.replace(/\s+/g, "")}`} className="flex items-center gap-2.5 border border-ink-900 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white">
                      <Phone size={15} aria-hidden="true" />
                      {t("vitrine.directContact.call")}
                    </a>
                  )}
                  {whatsapp && (
                    <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 border border-ink-900 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white">
                      <MessageCircle size={15} aria-hidden="true" />
                      {t("vitrine.directContact.whatsapp")}
                    </a>
                  )}
                  {courriel && (
                    <a href={`mailto:${courriel}?subject=${encodeURIComponent(listing.title)}`} className="flex items-center gap-2.5 border border-ink-900 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white">
                      <Mail size={15} aria-hidden="true" />
                      {t("vitrine.directContact.email")}
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="border border-slate-300 bg-white">
              <div aria-hidden="true" className="bande-motif h-1.5" />
              <div className="p-5">
                {leadSuccess ? (
                  <p className="border border-slate-300 bg-slate-50 px-4 py-4 text-center text-sm font-medium text-ink-900 shadow-[inset_4px_0_0_var(--color-ink-900)]">{t("vitrine.leadForm.success")}</p>
                ) : (
                  <form onSubmit={handleLeadSubmit} className="space-y-3">
                    <h2 className="text-base font-bold text-slate-900">{t("vitrine.leadForm.title")}</h2>
                    <div>
                      <label htmlFor="lead-name" className={etiquette}>{t("vitrine.leadForm.name")}</label>
                      <input id="lead-name" required maxLength={120} value={leadForm.prospectName} onChange={(e) => setLeadForm({ ...leadForm, prospectName: e.target.value })} className={champ} />
                    </div>
                    <div>
                      <label htmlFor="lead-email" className={etiquette}>{t("vitrine.leadForm.email")}</label>
                      <input id="lead-email" required type="email" maxLength={254} value={leadForm.prospectEmail} onChange={(e) => setLeadForm({ ...leadForm, prospectEmail: e.target.value })} className={champ} />
                    </div>
                    <div>
                      <label htmlFor="lead-phone" className={etiquette}>{t("vitrine.leadForm.phone")}</label>
                      <input id="lead-phone" required maxLength={40} value={leadForm.prospectPhone} onChange={(e) => setLeadForm({ ...leadForm, prospectPhone: e.target.value })} className={champ} />
                    </div>
                    <div>
                      <span id="lead-request-type" className={etiquette}>{t("vitrine.leadForm.requestType")}</span>
                      {/* Visite ou simple information : deux boutons plutôt que deux petits ronds. */}
                      <div role="radiogroup" aria-labelledby="lead-request-type" className="flex border border-slate-400">
                        {(["VISIT", "INFO"] as const).map((type) => (
                          <label
                            key={type}
                            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-r border-slate-400 px-3 py-2 text-xs font-semibold transition-colors last:border-r-0 ${
                              leadForm.requestType === type ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-50"
                            }`}
                          >
                            <input type="radio" name="requestType" checked={leadForm.requestType === type} onChange={() => setLeadForm({ ...leadForm, requestType: type })} className="sr-only" />
                            {t(`manager.listingLeads.requestTypes.${type}`)}
                          </label>
                        ))}
                      </div>
                    </div>
                    {leadForm.requestType === "VISIT" && (
                      <div>
                        <label htmlFor="lead-date" className={etiquette}>{t("vitrine.leadForm.preferredDate")}</label>
                        <ChampDate id="lead-date" value={leadForm.preferredDate} onChange={(e) => setLeadForm({ ...leadForm, preferredDate: e.target.value })} className={champ} />
                      </div>
                    )}
                    <div>
                      <label htmlFor="lead-message" className={etiquette}>{t("vitrine.leadForm.message")}</label>
                      <textarea id="lead-message" maxLength={2000} value={leadForm.message} onChange={(e) => setLeadForm({ ...leadForm, message: e.target.value })} rows={3} className={champ} />
                    </div>
                    {leadError && <p role="alert" className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{leadError}</p>}
                    <button type="submit" disabled={leadSubmitting} className="w-full cursor-pointer bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60">
                      {leadSubmitting ? t("common.actions.saving") : t("vitrine.leadForm.submit")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      <PiedVitrine />
    </div>
  );
}
