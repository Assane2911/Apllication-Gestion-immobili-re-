import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";

interface Suggestion {
  id: string;
  authorId: string | null;
  authorLabel: string;
  authorRole: string | null;
  page: string | null;
  message: string;
  createdAt: string;
}

interface Page {
  items: Suggestion[];
  page: number;
  totalPages: number;
  total: number;
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
 */
export default function AdminSuggestionsPage() {
  const { t, i18n } = useTranslation();
  const [donnees, setDonnees] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    api
      .get<Page>("/admin/suggestions", { params: { page } })
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
  }, [page]);

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
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("admin.suggestions.subtitle")}</p>
      </div>

      {erreur && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">{t("admin.suggestions.errorTitle")}</p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{erreur}</p>
        </div>
      )}

      {/* « Aucune suggestion » ne s'affiche qu'une fois la réponse reçue :
          l'annoncer pendant le chargement donnerait une réponse fausse. */}
      {chargement && !donnees && <p className="text-xs text-slate-500 dark:text-slate-400">{t("admin.suggestions.loading")}</p>}

      {donnees && donnees.items.length === 0 && !erreur && (
        <EmptyState
          icon={Lightbulb}
          title={t("admin.suggestions.emptyTitle")}
          description={t("admin.suggestions.emptyDescription")}
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
                    <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{role(s.authorRole)}</span>
                    {s.authorId === null && (
                      <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
                        {t("admin.suggestions.deletedAuthor")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(s.createdAt).toLocaleString(i18n.language)}
                  </p>
                </div>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{s.message}</p>
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                  {s.page ? t("admin.suggestions.fromPage", { page: s.page }) : t("admin.suggestions.noPage")}
                </p>
              </li>
            ))}
          </ul>

          <Pagination page={donnees.page} totalPages={donnees.totalPages} total={donnees.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
