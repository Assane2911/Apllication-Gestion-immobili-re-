import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";

const STATUTS = ["NEW", "PLANNED", "DONE", "DECLINED"] as const;
type Statut = (typeof STATUTS)[number];

const CLASSES_STATUT: Record<Statut, string> = {
  NEW: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  PLANNED: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  DONE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  DECLINED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

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
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t("admin.suggestions.title")}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("admin.suggestions.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("admin.suggestions.tabsLabel")}>
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
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                actif
                  ? "bg-brand-600 text-white border-brand-600"
                  : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {t(`admin.suggestions.tabs.${onglet || "ALL"}`)}
              {compte !== undefined && ` (${compte})`}
            </button>
          );
        })}
      </div>

      {erreurSuivi && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {erreurSuivi}
        </p>
      )}

      {erreur && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{t("admin.suggestions.errorTitle")}</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{erreur}</p>
        </div>
      )}

      {/* « Aucune suggestion » ne s'affiche qu'une fois la réponse reçue :
          l'annoncer pendant le chargement donnerait une réponse fausse. */}
      {chargement && !donnees && <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.suggestions.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState
          icon={Lightbulb}
          title={filtre ? t("admin.suggestions.emptyFilteredTitle") : t("admin.suggestions.emptyTitle")}
          description={filtre ? t("admin.suggestions.emptyFilteredDescription") : t("admin.suggestions.emptyDescription")}
        />
      )}

      {donnees && donnees.items.length > 0 && (
        <>
          <ul className="space-y-3">
            {donnees.items.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {s.authorLabel}
                    <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-400">{role(s.authorRole)}</span>
                    {s.authorId === null && (
                      <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
                        {t("admin.suggestions.deletedAuthor")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {new Date(s.createdAt).toLocaleString(i18n.language)}
                  </p>
                </div>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{s.message}</p>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                  {s.page ? t("admin.suggestions.fromPage", { page: s.page }) : t("admin.suggestions.noPage")}
                </p>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CLASSES_STATUT[statutDe(s.status)]}`}>
                    {t(`admin.suggestions.statuses.${statutDe(s.status)}`)}
                  </span>
                  <select
                    value={statutDe(s.status)}
                    onChange={(e) => void modifier(s.id, { status: e.target.value as Statut })}
                    disabled={enregistrement === s.id}
                    aria-label={t("admin.suggestions.statusLabel")}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {STATUTS.map((st) => (
                      <option key={st} value={st}>
                        {t(`admin.suggestions.statuses.${st}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <details className="mt-3">
                  <summary className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    {s.adminNote ? t("admin.suggestions.noteSummaryFilled") : t("admin.suggestions.noteSummary")}
                  </summary>
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={notes[s.id] ?? s.adminNote ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                      maxLength={2000}
                      rows={3}
                      aria-label={t("admin.suggestions.noteLabel")}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <p className="text-xs text-slate-600 dark:text-slate-400">{t("admin.suggestions.noteHelp")}</p>
                    <button
                      type="button"
                      disabled={enregistrement === s.id || (notes[s.id] ?? s.adminNote ?? "") === (s.adminNote ?? "")}
                      onClick={() => void modifier(s.id, { adminNote: notes[s.id] ?? "" })}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {enregistrement === s.id ? t("admin.suggestions.noteSaving") : t("admin.suggestions.noteSave")}
                    </button>
                  </div>
                </details>
              </li>
            ))}
          </ul>

          <Pagination page={donnees.page} totalPages={donnees.totalPages} total={donnees.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
