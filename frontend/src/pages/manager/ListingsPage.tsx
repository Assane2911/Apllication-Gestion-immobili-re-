import { Check, ExternalLink, Link2, Megaphone, MapPin, Pencil, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, fileUrl, isRequestCancelled, liste, MAX_UPLOAD_SIZE_MB } from "../../api/client";
import { preparerFichier } from "../../utils/fichiers";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import SectionReglage from "../../components/SectionReglage";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { PropertyCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/currency";
import type { Listing, ListingStatus, ListingType, PaginatedResponse, PricePeriod } from "../../types";
import { SUPPORTED_COUNTRY_CODES, countryLabel } from "../../utils/countries";
import ChampTelephone from "../../components/ChampTelephone";
import { CURRENCIES } from "../../context/currency";
import { PAYS } from "../../data/pays";
import Bulle from "../../components/Bulle";
import { nomDevise } from "../../utils/nomDevise";
import PlanLogement from "../../components/PlanLogement";
import { correspond } from "../../utils/recherche";
import { lienVitrine, syntheseAnnonces, trierAnnonces, type CritereTriAnnonce } from "../../utils/syntheseLocation";

// Sous ce nombre d'annonces, la recherche et les filtres n'apportent rien : la barre d'outils reste cachée.
const SEUIL_OUTILS = 4;
const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900";

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
  const { formatMoney, availableCurrencies } = useCurrency();
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
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<"all" | ListingStatus>("all");
  const [tri, setTri] = useState<CritereTriAnnonce>("recent");
  const [lienCopie, setLienCopie] = useState<string | null>(null);
  const [publicationId, setPublicationId] = useState<string | null>(null);

  // Aperçu de l'image choisie, avant l'envoi. Absent là où le navigateur ne sait pas fabriquer l'adresse.
  const apercu = useMemo(() => {
    if (!image || typeof URL.createObjectURL !== "function") return null;
    return URL.createObjectURL(image);
  }, [image]);
  useEffect(() => {
    if (!apercu) return;
    return () => URL.revokeObjectURL(apercu);
  }, [apercu]);

  function load(signal?: AbortSignal) {
    api
      .get<PaginatedResponse<Listing>>("/listings", { params: { page, pageSize: PAGE_SIZE }, signal })
      .then((res) => {
        setListings(liste<Listing>(res.data, "items"));
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

  /**
   * Choisir un pays propose sa devise.
   *
   * `data/pays.ts` porte déjà la devise de chaque pays : une annonce à Dakar
   * s'affiche donc en FCFA sans qu'on ait à y penser. La proposition n'est pas
   * imposée — le gestionnaire reste libre de la changer juste à côté, un bien
   * pouvant être libellé dans une autre monnaie que celle du lieu.
   */
  function choisirPays(code: string) {
    const pays = PAYS.find((p) => p.code === code);
    setForm((precedent) => ({
      ...precedent,
      country: code,
      currency: pays && CURRENCIES[pays.devise] ? pays.devise : precedent.currency,
    }));
  }

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

  // Même règle que pour les biens : photo réduite avant l'envoi, ou refus immédiat et lisible.
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
        await api.put(`/listings/${editing.id}`, data, { timeout: DELAI_UPLOAD_MS });
      } else {
        await api.post("/listings", data, { timeout: DELAI_UPLOAD_MS });
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

  async function copierLien(listing: Listing) {
    try {
      await navigator.clipboard.writeText(lienVitrine(window.location.origin, listing.id));
      setLienCopie(listing.id);
      setTimeout(() => setLienCopie((actuel) => (actuel === listing.id ? null : actuel)), 1800);
    } catch {
      // Presse-papiers indisponible : le lien reste accessible par « Voir sur la vitrine ».
    }
  }

  /** Passe une annonce en ligne d'un clic, sans rouvrir tout le formulaire : seul le statut part au serveur. */
  async function publier(listing: Listing) {
    setPublicationId(listing.id);
    try {
      const data = new FormData();
      data.append("status", "PUBLISHED");
      await api.put(`/listings/${listing.id}`, data, { timeout: DELAI_UPLOAD_MS });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setPublicationId(null);
    }
  }

  const synthese = syntheseAnnonces(listings);
  const afficherOutils = listings.length >= SEUIL_OUTILS;
  const visibles = trierAnnonces(
    listings.filter((l) => (filtre === "all" || l.status === filtre) && correspond(recherche, l.title, l.location, l.description)),
    tri
  );
  const filtresActifs = recherche.trim() !== "" || filtre !== "all";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.listings.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.listings.count", { count: Math.max(total, listings.length) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/*
            Sans ce lien, le gestionnaire n'avait aucun moyen de voir ce que
            ses annonces donnent une fois publiées : la vitrine n'était reliée
            à rien. Publier sans pouvoir regarder le résultat, c'est publier à
            l'aveugle.
          */}
          <Link to="/vitrine" className="inline-flex items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-sm font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700">
            <ExternalLink size={14} aria-hidden="true" />
            {t("manager.listings.viewVitrine")}
          </Link>
          <Link to="/leads" className="inline-flex items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-sm font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700">
            <Users size={14} aria-hidden="true" />
            {t("manager.listings.viewLeads")}
          </Link>
          <Bulle texte={t("manager.tips.listingCreate")}>
          <button onClick={openCreate} className={BOUTON_PLEIN}>
            {t("manager.listings.addBtn")}
          </button>
          </Bulle>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showForm && (
        <SectionReglage id="fiche-annonce" numero="01" titre={editing ? t("manager.listings.formTitleEdit") : t("manager.listings.formTitleNew")}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="listing-title" className={LIBELLE}>{t("manager.listings.fields.title")}</label>
              <input id="listing-title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="listing-type" className={LIBELLE}>{t("manager.listings.fields.type")}</label>
              <select id="listing-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ListingType })} className={CHAMP}>
                {LISTING_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`manager.listings.types.${type}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-price" className={LIBELLE}>{t("manager.listings.fields.price")}</label>
              <input id="listing-price" required type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="listing-currency" className={LIBELLE}>{t("manager.listings.fields.currency")}</label>
              {/*
                C'était un champ texte libre pré-rempli à « EUR ». Depuis que
                le serveur valide la devise, y taper « FCFA » au lieu de
                « XOF » faisait échouer la création avec une erreur 400 : le
                champ tendait un piège au lieu de proposer un choix.
              */}
              <select id="listing-currency" required value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={CHAMP}>
                {availableCurrencies.map((devise) => (
                  <option key={devise.code} value={devise.code}>
                    {nomDevise(devise.code, i18n.language, devise.name)} ({devise.symbol})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-pricePeriod" className={LIBELLE}>{t("manager.listings.fields.pricePeriod")}</label>
              <select id="listing-pricePeriod" value={form.pricePeriod} onChange={(e) => setForm({ ...form, pricePeriod: e.target.value as PricePeriod })} className={CHAMP}>
                {PRICE_PERIODS.map((period) => (
                  <option key={period} value={period}>{t(`manager.listings.pricePeriods.${period}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-surface" className={LIBELLE}>{t("manager.listings.fields.surface")}</label>
              <input id="listing-surface" type="number" step="0.1" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="listing-rooms" className={LIBELLE}>{t("manager.listings.fields.rooms")}</label>
              <input id="listing-rooms" type="number" step="1" min="1" max="1000" value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="listing-location" className={LIBELLE}>{t("manager.listings.fields.location")}</label>
              <input id="listing-location" required maxLength={200} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="listing-country" className={LIBELLE}>{t("manager.listings.fields.country")}</label>
              <select id="listing-country" value={form.country} onChange={(e) => choisirPays(e.target.value)} className={CHAMP}>
                <option value="">{t("manager.listings.fields.noCountry")}</option>
                {SUPPORTED_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>{countryLabel(code, i18n.language)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-status" className={LIBELLE}>{t("manager.listings.fields.status")}</label>
              <select id="listing-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ListingStatus })} className={CHAMP}>
                {LISTING_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(`common.status.${status}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="listing-contactPhone" className={LIBELLE}>{t("manager.listings.fields.contactPhone")}</label>
              <ChampTelephone id="listing-contactPhone" value={form.contactPhone} onChange={(contactPhone) => setForm({ ...form, contactPhone })} />
            </div>
            <div>
              <label htmlFor="listing-contactWhatsapp" className={LIBELLE}>{t("manager.listings.fields.contactWhatsapp")}</label>
              {/*
                Celui-ci surtout : WhatsApp n'accepte QUE le format
                international, et un numéro local sans indicatif était
                enregistré tel quel, silencieusement inutilisable.
              */}
              <ChampTelephone id="listing-contactWhatsapp" value={form.contactWhatsapp} onChange={(contactWhatsapp) => setForm({ ...form, contactWhatsapp })} />
            </div>
            <div>
              <label htmlFor="listing-contactEmail" className={LIBELLE}>{t("manager.listings.fields.contactEmail")}</label>
              <input id="listing-contactEmail" type="email" maxLength={254} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={CHAMP} />
            </div>
            <div>
              <label htmlFor="listing-image" className={LIBELLE}>{t("manager.listings.fields.image")}</label>
              <input id="listing-image" type="file" accept="image/*" onChange={(e) => void choisirImage(e)} className="w-full text-sm text-slate-700" />
              {(apercu || editing?.imageUrl) && (
                <figure className="mt-2 flex items-end gap-3">
                  <img src={apercu ?? fileUrl(editing?.imageUrl) ?? undefined} alt="" className="h-16 w-24 border border-slate-300 object-cover" />
                  <figcaption className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
                    {apercu ? t("manager.listings.form.imagePreview") : t("manager.listings.form.currentImage")}
                  </figcaption>
                </figure>
              )}
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input id="listing-featured" type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="size-4 cursor-pointer accent-orange-700" />
              <label htmlFor="listing-featured" className="text-sm font-medium text-slate-700">{t("manager.listings.fields.featured")}</label>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="listing-description" className={LIBELLE}>{t("manager.listings.fields.description")}</label>
              <textarea id="listing-description" required maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={CHAMP} rows={3} />
            </div>
            {error && <p role="alert" className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="cursor-pointer px-4 py-2 text-sm text-slate-600 hover:text-ink-900">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </SectionReglage>
      )}

      {!loading && listings.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.listings.summary.label")}
          cases={[
            { libelle: t("manager.listings.summary.published"), valeur: synthese.publiees, aide: t("manager.listings.summary.publishedHint") },
            { libelle: t("manager.listings.summary.drafts"), valeur: synthese.brouillons, aide: t("manager.listings.summary.draftsHint") },
            { libelle: t("manager.listings.summary.featured"), valeur: synthese.vedettes, aide: t("manager.listings.summary.featuredHint") },
            {
              libelle: t("manager.listings.summary.hidden"),
              valeur: synthese.masquees,
              aide: t("manager.listings.summary.hiddenHint"),
              ton: synthese.masquees > 0 ? "alerte" : "normal",
            },
          ]}
        />
      )}

      {!loading && afficherOutils && (
        <>
          <BarreListe
            idPrefixe="annonces"
            recherche={recherche}
            onRecherche={setRecherche}
            placeholderRecherche={t("manager.listings.search")}
            libelleFiltres={t("manager.listings.filtersLabel")}
            filtres={[
              { cle: "all", libelle: t("manager.liste.all"), compte: listings.length },
              { cle: "PUBLISHED", libelle: t("common.status.PUBLISHED"), compte: synthese.publiees },
              { cle: "DRAFT", libelle: t("common.status.DRAFT"), compte: synthese.brouillons },
              { cle: "ARCHIVED", libelle: t("common.status.ARCHIVED"), compte: synthese.archivees },
            ]}
            filtreActif={filtre}
            onFiltre={(cle) => setFiltre(cle as "all" | ListingStatus)}
            tri={{
              libelle: t("manager.listings.sort.label"),
              valeur: tri,
              onChange: (v) => setTri(v as CritereTriAnnonce),
              options: [
                { valeur: "recent", libelle: t("manager.listings.sort.recent") },
                { valeur: "prixDesc", libelle: t("manager.listings.sort.priceDesc") },
                { valeur: "prixAsc", libelle: t("manager.listings.sort.priceAsc") },
                { valeur: "titre", libelle: t("manager.listings.sort.title") },
              ],
            }}
          />
          <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {t(totalPages > 1 ? "manager.liste.shownOnPage" : "manager.liste.shown", { shown: visibles.length, total: listings.length })}
          </p>
        </>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <PropertyCardSkeleton key={i} />
          ))}
        </div>
      ) : visibles.length === 0 && listings.length > 0 ? (
        <div className="border border-slate-300 bg-white p-8 text-center shadow-[inset_4px_0_0_var(--color-ink-900)]">
          <p className="text-sm text-slate-700">{t("manager.liste.noResult")}</p>
          {filtresActifs && (
            <button type="button" onClick={() => { setRecherche(""); setFiltre("all"); }} className={`${BOUTON_TRAIT} mt-4`}>
              {t("manager.liste.resetFilters")}
            </button>
          )}
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
        {visibles.map((listing, rang) => (
          <article
            key={listing.id}
            className="group flex flex-col justify-between overflow-hidden border border-slate-300 bg-white transition-colors duration-200 hover:border-ink-900"
          >
            <div>
              <div className="relative h-44 bg-slate-100 border-b border-slate-300 overflow-hidden">
                {listing.imageUrl ? (
                  <img
                    src={fileUrl(listing.imageUrl) ?? undefined}
                    alt={listing.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 motion-reduce:transform-none"
                  />
                ) : (
                  <PlanLogement id={listing.id} className="w-full h-full" />
                )}
                <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5">
                  <Badge status={listing.status} />
                  {listing.featured && (
                    <span className="border border-orange-700 bg-orange-700 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
                      {t("manager.listings.featuredBadge")}
                    </span>
                  )}
                </div>
                {/* Numéro de fiche, comme l'étiquette d'une planche de plan. */}
                <span aria-hidden="true" className="absolute bottom-0 left-0 z-10 bg-ink-900 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white">
                  {String((page - 1) * PAGE_SIZE + rang + 1).padStart(2, "0")}
                </span>
              </div>
              {listing.hiddenByAdminAt && (
                <div role="note" className="border-b border-orange-300 bg-orange-50 px-4 py-3 shadow-[inset_3px_0_0_var(--color-orange-700)]">
                  <p className="text-xs font-semibold text-orange-900">{t("manager.listings.moderation.title")}</p>
                  {listing.moderationReason && (
                    <p className="text-xs text-orange-900 mt-0.5 wrap-break-word">
                      {t("manager.listings.moderation.reason", { reason: listing.moderationReason })}
                    </p>
                  )}
                  <p className="text-xs text-orange-900 mt-1">{t("manager.listings.moderation.help")}</p>
                </div>
              )}
              <div className="p-4 sm:p-5">
                <h3 className="font-bold text-slate-900 text-base leading-snug">{listing.title}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                  <MapPin size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                  <span className="line-clamp-1">
                    {listing.location}
                    {listing.country ? ` · ${countryLabel(listing.country, i18n.language)}` : ""}
                  </span>
                </p>
                {/* Fiche technique : nature de l'annonce et prix, libellés en police technique. */}
                <dl className="mt-4 grid grid-cols-2 border border-slate-300 divide-x divide-slate-300">
                  <div className="px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.listings.fields.type")}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-slate-900">{t(`manager.listings.types.${listing.type}`)}</dd>
                  </div>
                  <div className="px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.listings.fields.price")}</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(listing.price, listing.currency)}{" "}
                      {listing.pricePeriod === "MONTH" && (
                        <span className="text-xs font-normal text-slate-600">{t("manager.listings.perMonth")}</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-300 px-4 py-2.5 text-xs font-semibold">
              {listing.status === "PUBLISHED" ? (
                <>
                  <Link to={`/vitrine/annonces/${listing.id}`} className="inline-flex items-center gap-1.5 border-b border-ink-900/40 text-ink-900 hover:border-orange-700 hover:text-orange-700">
                    <ExternalLink size={12} aria-hidden="true" />
                    {t("manager.listings.share.view")}
                  </Link>
                  <button type="button" onClick={() => copierLien(listing)} className="inline-flex cursor-pointer items-center gap-1.5 border-b border-ink-900/40 text-ink-900 hover:border-orange-700 hover:text-orange-700">
                    {lienCopie === listing.id ? <Check size={12} aria-hidden="true" /> : <Link2 size={12} aria-hidden="true" />}
                    {lienCopie === listing.id ? t("manager.listings.share.copied") : t("manager.listings.share.copy")}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => publier(listing)} disabled={publicationId === listing.id} className="cursor-pointer border border-ink-900 bg-ink-900 px-2.5 py-1 text-white transition-colors hover:border-orange-700 hover:bg-orange-700 disabled:opacity-60">
                  {publicationId === listing.id ? t("manager.listings.share.publishing") : t("manager.listings.share.publish")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-300 border-t border-slate-300 text-xs font-semibold">
              <Bulle texte={t("manager.tips.listingEdit")} className="block">
                <button
                  onClick={() => openEdit(listing)}
                  className="flex w-full items-center justify-center gap-1.5 py-2.5 text-slate-700 hover:bg-slate-100 hover:text-ink-900 transition-colors cursor-pointer"
                >
                  <Pencil size={13} aria-hidden="true" />
                  {t("common.actions.edit")}
                </button>
              </Bulle>
              <Bulle texte={t("manager.tips.listingDelete")} className="block">
                <button
                  onClick={() => handleDelete(listing)}
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
