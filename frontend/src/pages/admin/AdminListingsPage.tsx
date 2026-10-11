import { Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, fileUrl } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { useCurrency } from "../../context/currency";

const VISIBILITES = ["", "VISIBLE", "HIDDEN"] as const;
type Visibilite = (typeof VISIBILITES)[number];

interface AdminListing {
  id: string;
  title: string;
  location: string;
  country: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  status: string;
  featured: boolean;
  hiddenByAdminAt: string | null;
  moderationReason: string | null;
  managerEmail: string;
  agencyName: string | null;
}

interface Page {
  items: AdminListing[];
  page: number;
  totalPages: number;
  total: number;
  counts?: { hidden: number };
}

const CLASSES_STATUT: Record<string, string> = {
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  ARCHIVED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const champ =
  "rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100";

/**
 * Modération des annonces de la vitrine publique.
 *
 * Masquer retire l'annonce de TOUTE la vitrine sans rien supprimer : le
 * gestionnaire la retrouve dans son espace avec le motif, qui est donc
 * OBLIGATOIRE et écrit pour lui. Seule l'administration rétablit. La mise en
 * avant se retire séparément, pour répondre à un abus sans masquer l'annonce.
 * Chaque action laisse une trace dans le journal d'audit.
 */
export default function AdminListingsPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [visibilite, setVisibilite] = useState<Visibilite>("");
  const [statut, setStatut] = useState("");
  const [version, setVersion] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [masquageId, setMasquageId] = useState<string | null>(null);
  const [motif, setMotif] = useState("");

  // Anti-rebond : on n'interroge le serveur qu'une fois la frappe terminée.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      setRecherche(saisie.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<Page>("/admin/listings", {
        params: {
          page,
          ...(recherche && { search: recherche }),
          ...(visibilite && { visibility: visibilite }),
          ...(statut && { status: statut }),
        },
      })
      .then((res) => {
        if (vivant) setDonnees(res.data);
      })
      .catch((err) => {
        if (vivant) setErreur(apiErrorMessage(err));
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [page, recherche, visibilite, statut, version]);

  async function agir(id: string, chemin: string, corps?: Record<string, unknown>) {
    setEnCours(id);
    setErreurAction(null);
    try {
      await api.post(`/admin/listings/${id}/${chemin}`, corps);
      setMasquageId(null);
      setMotif("");
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurAction(apiErrorMessage(err));
    } finally {
      setEnCours(null);
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const bouton =
    "text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t("admin.listings.title")}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("admin.listings.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("admin.listings.tabsLabel")}>
        {VISIBILITES.map((onglet) => {
          const actif = visibilite === onglet;
          const compte = onglet === "HIDDEN" ? donnees?.counts?.hidden : undefined;
          return (
            <button
              key={onglet || "ALL"}
              type="button"
              aria-pressed={actif}
              onClick={() => {
                setVisibilite(onglet);
                setPage(1);
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                actif
                  ? "bg-brand-600 text-white border-brand-600"
                  : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {t(`admin.listings.tabs.${onglet || "ALL"}`)}
              {compte !== undefined && ` (${compte})`}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={t("admin.listings.searchPlaceholder")}
          aria-label={t("admin.listings.searchLabel")}
          maxLength={100}
          className={`${champ} flex-1 min-w-[14rem]`}
        />
        <select
          value={statut}
          onChange={(e) => {
            setStatut(e.target.value);
            setPage(1);
          }}
          aria-label={t("admin.listings.statusFilter")}
          className={champ}
        >
          <option value="">{t("admin.listings.allStatuses")}</option>
          {(["PUBLISHED", "DRAFT", "ARCHIVED"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`common.status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {erreurAction && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {t("admin.listings.actionError")} — {erreurAction}
        </p>
      )}

      {erreur && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{t("admin.listings.errorTitle")}</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{erreur}</p>
        </div>
      )}

      {/* « Aucune annonce » ne s'affiche qu'une fois la réponse reçue :
          l'annoncer pendant le chargement donnerait une réponse fausse. */}
      {chargement && !donnees && <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.listings.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState
          icon={Megaphone}
          title={recherche || visibilite || statut ? t("admin.listings.emptyFilteredTitle") : t("admin.listings.emptyTitle")}
          description={
            recherche || visibilite || statut ? t("admin.listings.emptyFilteredDescription") : t("admin.listings.emptyDescription")
          }
        />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <ul className="space-y-3">
            {donnees.items.map((a) => {
              const masquee = Boolean(a.hiddenByAdminAt);
              const occupe = enCours === a.id;
              return (
                <li
                  key={a.id}
                  className={`rounded-2xl border bg-white dark:bg-slate-900 p-4 ${
                    masquee ? "border-red-300 dark:border-red-900" : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex gap-4">
                    {a.imageUrl ? (
                      <img
                        src={fileUrl(a.imageUrl) ?? undefined}
                        alt=""
                        className="w-20 h-20 rounded-lg object-cover shrink-0 bg-slate-100 dark:bg-slate-800"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-lg shrink-0 bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{a.title}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        {a.location} · {formatMoney(a.price, a.currency)}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 break-all">
                        {t("admin.listings.manager", { who: a.agencyName ? `${a.agencyName} (${a.managerEmail})` : a.managerEmail })}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CLASSES_STATUT[a.status] ?? CLASSES_STATUT.DRAFT}`}
                        >
                          {t(`common.status.${a.status}`)}
                        </span>
                        {a.featured && (
                          <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                            {t("admin.listings.featuredBadge")}
                          </span>
                        )}
                        {masquee && (
                          <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                            {t("admin.listings.hiddenBadge")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {masquee && a.hiddenByAdminAt && (
                    <div className="mt-3 text-xs text-slate-700 dark:text-slate-300">
                      <p>{t("admin.listings.hiddenSince", { date: date(a.hiddenByAdminAt) })}</p>
                      {a.moderationReason && <p className="mt-0.5 break-words">{t("admin.listings.reason", { reason: a.moderationReason })}</p>}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {masquee ? (
                      <button type="button" className={bouton} disabled={occupe} onClick={() => void agir(a.id, "restore")}>
                        {t("admin.listings.restore")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={bouton}
                        disabled={occupe}
                        aria-expanded={masquageId === a.id}
                        onClick={() => {
                          setMasquageId(masquageId === a.id ? null : a.id);
                          setMotif("");
                          setErreurAction(null);
                        }}
                      >
                        {t("admin.listings.hide")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={bouton}
                      disabled={occupe}
                      onClick={() => void agir(a.id, "featured", { featured: !a.featured })}
                    >
                      {a.featured ? t("admin.listings.unfeature") : t("admin.listings.feature")}
                    </button>
                    {!masquee && a.status === "PUBLISHED" && (
                      <a
                        href={`/vitrine/annonces/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        {t("admin.listings.viewPublic")}
                      </a>
                    )}
                  </div>

                  {masquageId === a.id && !masquee && (
                    <form
                      className="mt-3 space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 p-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void agir(a.id, "hide", { reason: motif.trim() });
                      }}
                    >
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t("admin.listings.hideTitle")}</p>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300" htmlFor={`motif-${a.id}`}>
                        {t("admin.listings.reasonLabel")}
                      </label>
                      <textarea
                        id={`motif-${a.id}`}
                        value={motif}
                        onChange={(e) => setMotif(e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder={t("admin.listings.reasonPlaceholder")}
                        className={`${champ} w-full`}
                      />
                      <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.listings.reasonHelp")}</p>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={occupe || motif.trim().length < 3}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {occupe ? t("admin.listings.working") : t("admin.listings.confirmHide")}
                        </button>
                        <button type="button" className={bouton} onClick={() => setMasquageId(null)}>
                          {t("admin.listings.cancel")}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>

          <Pagination page={donnees.page} totalPages={donnees.totalPages} total={donnees.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
