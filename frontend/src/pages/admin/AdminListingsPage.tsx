import { Eye, Mail, Megaphone, Star } from "lucide-react";
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
  // Compte du gestionnaire suspendu : l'annonce n'est plus visible sur la vitrine.
  // Absent d'une réponse d'un serveur plus ancien (déploiement en cours).
  managerSuspendedAt?: string | null;
  // Abonnement du gestionnaire terminé : même effet, son espace est fermé jusqu'au renouvellement.
  managerSubscriptionExpired?: boolean;
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
  PUBLISHED: "border border-emerald-300 bg-emerald-50 text-emerald-900",
  DRAFT: "border border-slate-300 bg-slate-100 text-slate-700",
  ARCHIVED: "border border-slate-300 bg-slate-100 text-slate-700",
};

/** Motifs les plus fréquents, proposés en un clic : l'administrateur les complète au besoin plutôt que de tout retaper. */
const MOTIFS_RAPIDES = ["photos", "price", "content", "duplicate", "contact"] as const;

const champ = "border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900";
/** Étiquette d'état : angles droits, filet et fond teinté, comme les autres pages. */
const etiquette = "inline-block px-2 py-0.5 text-xs font-semibold";

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
    "cursor-pointer border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:opacity-50";

  /** Ajoute un motif tout fait à ce que l'administrateur a déjà écrit, sans jamais dépasser la limite du champ. */
  function ajouterMotif(texte: string) {
    setMotif((actuel) => {
      const base = actuel.trim();
      if (base.includes(texte)) return actuel;
      return (base ? `${base} ${texte}` : texte).slice(0, 500);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("admin.listings.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("admin.listings.subtitle")}</p>
        {donnees && !erreur && (
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("admin.listings.count", { count: donnees.total })}</p>
        )}
      </div>

      <div className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex" role="group" aria-label={t("admin.listings.tabsLabel")}>
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
              className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                actif ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
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
          className={`${champ} min-w-56 flex-1`}
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
        <p role="alert" className="text-xs text-red-700">
          {t("admin.listings.actionError")} — {erreurAction}
        </p>
      )}

      {erreur && (
        <div className="border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t("admin.listings.errorTitle")}</p>
          <p role="alert" className="mt-0.5 text-xs text-red-700">{erreur}</p>
        </div>
      )}

      {/* « Aucune annonce » ne s'affiche qu'une fois la réponse reçue :
          l'annoncer pendant le chargement donnerait une réponse fausse. */}
      {chargement && !donnees && <p className="text-xs text-slate-600">{t("admin.listings.loading")}</p>}

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
          <ul className="space-y-5">
            {donnees.items.map((a) => {
              const masquee = Boolean(a.hiddenByAdminAt);
              const occupe = enCours === a.id;
              // Ce que voit réellement le public : publiée, ni masquée, ni compte suspendu, ni abonnement terminé.
              const enLigne = !masquee && !a.managerSuspendedAt && !a.managerSubscriptionExpired && a.status === "PUBLISHED";
              return (
                <li
                  key={a.id}
                  className={`border bg-white ${masquee ? "border-rose-300 shadow-[inset_4px_0_0_var(--color-rose-600)]" : "border-slate-300 shadow-[inset_4px_0_0_var(--color-slate-300)]"}`}
                >
                  <div className="sm:grid sm:grid-cols-[13rem_1fr]">
                    {/* La photo telle que la vitrine la montre ; à défaut, la bande hachurée des plans. */}
                    <div className="relative h-40 border-b border-slate-300 bg-slate-100 sm:h-auto sm:min-h-36 sm:border-b-0 sm:border-r">
                      {a.imageUrl ? (
                        <img src={fileUrl(a.imageUrl) ?? undefined} alt="" className={`absolute inset-0 h-full w-full object-cover ${masquee ? "opacity-60 grayscale" : ""}`} />
                      ) : (
                        <div className="bande-motif absolute inset-0 opacity-25" aria-hidden="true" />
                      )}
                      <p className="absolute bottom-0 left-0 bg-ink-900 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white">
                        {formatMoney(a.price, a.currency)}
                      </p>
                    </div>

                    <div className="min-w-0 p-5">
                      <p className="wrap-break-word text-base font-bold leading-snug text-slate-900">{a.title}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{a.location}</p>
                      <p className="mt-0.5 break-all font-mono text-xs text-slate-600">
                        {t("admin.listings.manager", { who: a.agencyName ? `${a.agencyName} (${a.managerEmail})` : a.managerEmail })}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={`${etiquette} ${CLASSES_STATUT[a.status] ?? CLASSES_STATUT.DRAFT}`}>{t(`common.status.${a.status}`)}</span>
                        {enLigne && (
                          <span className={`${etiquette} inline-flex items-center gap-1 border border-ink-900 bg-white text-ink-900`}>
                            <Eye size={12} aria-hidden="true" />
                            {t("admin.listings.onlineBadge")}
                          </span>
                        )}
                        {a.featured && (
                          <span className={`${etiquette} inline-flex items-center gap-1 border border-amber-300 bg-amber-50 text-amber-900`}>
                            <Star size={12} aria-hidden="true" />
                            {t("admin.listings.featuredBadge")}
                          </span>
                        )}
                        {masquee && <span className={`${etiquette} border border-rose-300 bg-rose-50 text-rose-900`}>{t("admin.listings.hiddenBadge")}</span>}
                        {a.managerSuspendedAt && <span className={`${etiquette} border border-ink-900 bg-ink-900 text-white`}>{t("admin.listings.suspendedBadge")}</span>}
                        {!a.managerSuspendedAt && a.managerSubscriptionExpired && (
                          <span className={`${etiquette} border border-amber-300 bg-amber-50 text-amber-900`}>{t("admin.listings.expiredBadge")}</span>
                        )}
                      </div>

                      {masquee && a.hiddenByAdminAt && (
                        <div className="mt-3 border-l-2 border-rose-300 pl-3 text-xs text-slate-700">
                          <p>{t("admin.listings.hiddenSince", { date: date(a.hiddenByAdminAt) })}</p>
                          {a.moderationReason && <p className="mt-0.5 wrap-break-word">{t("admin.listings.reason", { reason: a.moderationReason })}</p>}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
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
                        <a
                          href={`mailto:${a.managerEmail}`}
                          className="inline-flex items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                        >
                          <Mail size={13} aria-hidden="true" />
                          {t("admin.listings.writeToManager")}
                        </a>
                        {enLigne && (
                          <a
                            href={`/vitrine/annonces/${a.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                          >
                            {t("admin.listings.viewPublic")}
                          </a>
                        )}
                      </div>

                      {masquageId === a.id && !masquee && (
                        <form
                          className="mt-4 space-y-2 border border-slate-300 bg-slate-50 p-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void agir(a.id, "hide", { reason: motif.trim() });
                          }}
                        >
                          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t("admin.listings.hideTitle")}</p>
                          <label className="block text-xs font-medium text-slate-700" htmlFor={`motif-${a.id}`}>
                            {t("admin.listings.reasonLabel")}
                          </label>
                          {/* Les motifs courants, d'un clic : le texte est complétable ensuite. */}
                          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("admin.listings.quickReasons")}>
                            {MOTIFS_RAPIDES.map((cle) => (
                              <button
                                key={cle}
                                type="button"
                                onClick={() => ajouterMotif(t(`admin.listings.quick.${cle}`))}
                                className="cursor-pointer border border-slate-400 bg-white px-2.5 py-1 text-xs text-slate-800 transition-colors hover:border-orange-700 hover:text-orange-700"
                              >
                                {t(`admin.listings.quickLabel.${cle}`)}
                              </button>
                            ))}
                          </div>
                          <textarea
                            id={`motif-${a.id}`}
                            value={motif}
                            onChange={(e) => setMotif(e.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder={t("admin.listings.reasonPlaceholder")}
                            className={`${champ} w-full`}
                          />
                          <p className="text-xs text-slate-600">{t("admin.listings.reasonHelp")}</p>
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={occupe || motif.trim().length < 3}
                              className="cursor-pointer bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                            >
                              {occupe ? t("admin.listings.working") : t("admin.listings.confirmHide")}
                            </button>
                            <button type="button" className={bouton} onClick={() => setMasquageId(null)}>
                              {t("admin.listings.cancel")}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
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
