import { Lightbulb, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Initiales from "../../components/Initiales";
import Pagination from "../../components/Pagination";

const STATUTS = ["NEW", "PLANNED", "DONE", "DECLINED"] as const;
type Statut = (typeof STATUTS)[number];

/** Filet de couleur de la fiche : l'orange signale ce qui n'a pas encore été lu, le vert ce qui est livré. */
const FILET_STATUT: Record<Statut, string> = {
  NEW: "shadow-[inset_4px_0_0_var(--color-orange-700)]",
  PLANNED: "shadow-[inset_4px_0_0_var(--color-ink-900)]",
  DONE: "shadow-[inset_4px_0_0_var(--color-emerald-600)]",
  DECLINED: "shadow-[inset_4px_0_0_var(--color-slate-300)]",
};

const JOUR_MS = 86_400_000;
/** Une suggestion restée « Nouvelle » au-delà de ce délai est signalée : personne ne l'a encore traitée. */
const SEUIL_SANS_SUITE_JOURS = 7;

/** Statut lu avec repli : une réponse sans `status` (serveur plus ancien) vaut « Nouvelle ». */
const statutDe = (valeur?: string): Statut => ((STATUTS as readonly string[]).includes(valeur ?? "") ? (valeur as Statut) : "NEW");

interface Suggestion {
  id: string;
  authorId: string | null;
  authorLabel: string;
  authorRole: string | null;
  page: string | null;
  message: string;
  // Absents d'une réponse d'un serveur plus ancien : lus avec un repli.
  status?: string;
  adminNote?: string | null;
  createdAt: string;
}

interface Page {
  items: Suggestion[];
  page: number;
  totalPages: number;
  total: number;
  counts?: Record<Statut, number> & { total: number };
}

/**
 * La boîte de réception des suggestions.
 *
 * Volontairement une LECTURE, sans réponse ni statut. Un fil de discussion
 * suppose que quelqu'un s'engage à répondre à chacun ; promettre cela puis
 * laisser des messages sans réponse abîme plus la confiance que de ne rien
 * promettre. Ce qu'il faut d'abord, c'est lire.
 *
 * Chaque ligne porte l'email de son auteur, son rôle et la page d'où elle
 * part : trois choses qui permettent de comprendre une remarque sans
 * aller-retour, et de recontacter la personne s'il le faut.
 *
 * Le SUIVI reste dans le même esprit : un statut (où en est l'idée) et une
 * note interne, jamais montrée à l'auteur. Toujours pas de réponse — on ne
 * promet pas un échange que personne n'a décidé de tenir.
 */
export default function AdminSuggestionsPage() {
  const { t, i18n } = useTranslation();
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [filtre, setFiltre] = useState<"" | Statut>("");
  const [version, setVersion] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurSuivi, setErreurSuivi] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [enregistrement, setEnregistrement] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<Page>("/admin/suggestions", { params: { page, ...(filtre && { status: filtre }) } })
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
  }, [page, filtre, version]);

  async function modifier(id: string, changements: { status?: Statut; adminNote?: string }) {
    setEnregistrement(id);
    setErreurSuivi(null);
    try {
      await api.patch(`/admin/suggestions/${id}`, changements);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreurSuivi(apiErrorMessage(err));
    } finally {
      setEnregistrement(null);
    }
  }

  function role(valeur: string | null) {
    // Le rôle vient d'une énumération ; une valeur inattendue (ou absente)
    // doit rester lisible plutôt que d'afficher une clé brute.
    const cles = ["MANAGER", "TENANT", "OWNER", "ADMIN"];
    return t(`admin.suggestions.roles.${valeur && cles.includes(valeur) ? valeur : "unknown"}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("admin.suggestions.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("admin.suggestions.subtitle")}</p>
      </div>

      <div className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex" role="group" aria-label={t("admin.suggestions.tabsLabel")}>
        {(["", ...STATUTS] as const).map((onglet) => {
          const compte = onglet === "" ? donnees?.counts?.total : donnees?.counts?.[onglet];
          const actif = filtre === onglet;
          return (
            <button
              key={onglet || "ALL"}
              type="button"
              aria-pressed={actif}
              onClick={() => {
                setFiltre(onglet);
                setPage(1);
              }}
              className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                actif ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              {t(`admin.suggestions.tabs.${onglet || "ALL"}`)}
              {compte !== undefined && ` (${compte})`}
            </button>
          );
        })}
      </div>

      {erreurSuivi && (
        <p role="alert" className="text-xs text-red-700">
          {erreurSuivi}
        </p>
      )}

      {erreur && (
        <div className="border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t("admin.suggestions.errorTitle")}</p>
          <p role="alert" className="mt-0.5 text-xs text-red-700">{erreur}</p>
        </div>
      )}

      {/* « Aucune suggestion » ne s'affiche qu'une fois la réponse reçue :
          l'annoncer pendant le chargement donnerait une réponse fausse. */}
      {chargement && !donnees && <p className="text-xs text-slate-600">{t("admin.suggestions.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState
          icon={Lightbulb}
          title={filtre ? t("admin.suggestions.emptyFilteredTitle") : t("admin.suggestions.emptyTitle")}
          description={filtre ? t("admin.suggestions.emptyFilteredDescription") : t("admin.suggestions.emptyDescription")}
        />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <ul className="space-y-5">
            {donnees.items.map((s) => {
              const statut = statutDe(s.status);
              const jours = Math.max(0, Math.floor((Date.now() - new Date(s.createdAt).getTime()) / JOUR_MS));
              const sansSuite = statut === "NEW" && jours >= SEUIL_SANS_SUITE_JOURS;
              // Le libellé de l'auteur est son adresse : c'est aussi le moyen de le recontacter, sans rien promettre de plus.
              const peutEcrire = s.authorId !== null && s.authorLabel.includes("@");
              return (
                <li key={s.id} className={`border border-slate-300 bg-white ${FILET_STATUT[statut]}`}>
                  <div className="lg:grid lg:grid-cols-[16rem_1fr]">
                    {/* L'auteur : qui écrit, avec quel rôle, depuis quelle page, et depuis quand. */}
                    <div className="border-b border-slate-300 bg-slate-50 p-5 lg:border-b-0 lg:border-r">
                      <div className="flex items-center gap-3">
                        <Initiales prenom={s.authorLabel} />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-slate-900">{s.authorLabel}</p>
                          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600">{role(s.authorRole)}</p>
                        </div>
                      </div>
                      {s.authorId === null && (
                        <p className="mt-3 border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">{t("admin.suggestions.deletedAuthor")}</p>
                      )}
                      <p className="mt-4 font-mono text-[11px] tabular-nums text-slate-600">{new Date(s.createdAt).toLocaleString(i18n.language)}</p>
                      <p className="mt-1 break-words font-mono text-[11px] text-slate-600">
                        {s.page ? t("admin.suggestions.fromPage", { page: s.page }) : t("admin.suggestions.noPage")}
                      </p>
                      {peutEcrire && (
                        <a
                          href={`mailto:${s.authorLabel}`}
                          className="mt-4 inline-flex items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700"
                        >
                          <Mail size={13} aria-hidden="true" />
                          {t("admin.suggestions.writeToAuthor")}
                        </a>
                      )}
                    </div>

                    <div className="p-5">
                      {sansSuite && (
                        <p className="mb-3 inline-block border border-orange-300 bg-orange-50 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-900">
                          {t("admin.suggestions.unreadFor", { count: jours })}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-slate-800">{s.message}</p>

                      {/* Où en est l'idée : quatre états qui se suivent, celui de la fiche est plein. */}
                      <div
                        role="group"
                        aria-label={t("admin.suggestions.statusLabel")}
                        className="mt-5 flex flex-wrap border border-slate-400 bg-white sm:inline-flex"
                      >
                        {STATUTS.map((st) => (
                          <button
                            key={st}
                            type="button"
                            aria-pressed={statut === st}
                            disabled={enregistrement === s.id}
                            onClick={() => statut !== st && void modifier(s.id, { status: st })}
                            className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 disabled:cursor-wait sm:flex-none ${
                              statut === st ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
                            }`}
                          >
                            {t(`admin.suggestions.statuses.${st}`)}
                          </button>
                        ))}
                      </div>

                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                          {s.adminNote ? t("admin.suggestions.noteSummaryFilled") : t("admin.suggestions.noteSummary")}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={notes[s.id] ?? s.adminNote ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                            maxLength={2000}
                            rows={3}
                            aria-label={t("admin.suggestions.noteLabel")}
                            className="w-full border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                          <p className="text-xs text-slate-600">{t("admin.suggestions.noteHelp")}</p>
                          <button
                            type="button"
                            disabled={enregistrement === s.id || (notes[s.id] ?? s.adminNote ?? "") === (s.adminNote ?? "")}
                            onClick={() => void modifier(s.id, { adminNote: notes[s.id] ?? "" })}
                            className="cursor-pointer bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                          >
                            {enregistrement === s.id ? t("admin.suggestions.noteSaving") : t("admin.suggestions.noteSave")}
                          </button>
                        </div>
                      </details>
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
