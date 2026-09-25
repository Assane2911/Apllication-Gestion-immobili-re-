import { Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";

/**
 * Bouton « Une suggestion ? », flottant et présent sur tous les espaces.
 *
 * Trois décisions valent d'être écrites.
 *
 * Il est PARTOUT plutôt que rangé dans un écran dédié. Une idée arrive en
 * travaillant, devant l'écran qui la provoque ; renvoyer vers une page de
 * contact, c'est la perdre en chemin. Le chemin courant part d'ailleurs avec
 * le message : une remarque sur les factures écrite depuis les factures se
 * comprend sans explication.
 *
 * Il ne demande QUE le texte. Chaque champ supplémentaire est une raison de
 * renoncer, et une idée qu'on renonce à écrire ne vaut rien. Ni catégorie, ni
 * objet, ni note : l'auteur et la page sont déjà connus du serveur.
 *
 * Il est discret. Une aide qui masque le contenu se fait fermer une fois puis
 * ignorer — d'où la taille réduite, le coin bas, et un retrait sur mobile où
 * la place manque vraiment.
 */
export default function BoutonSuggestion() {
  const { t } = useTranslation();
  const emplacement = useLocation();
  const [ouvert, setOuvert] = useState(false);
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ouvert) champ.current?.focus();
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;
    // Échap ferme, comme toute chose qui s'ouvre.
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [ouvert]);

  function fermer() {
    setOuvert(false);
    setErreur(null);
    setEnvoye(false);
  }

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await api.post("/suggestions", { message, page: emplacement.pathname });
      setMessage("");
      setEnvoye(true);
    } catch (err) {
      setErreur(apiErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="hidden sm:flex fixed bottom-4 right-4 z-40 items-center gap-2 rounded-full bg-slate-900/90 dark:bg-slate-700/90 hover:bg-slate-900 dark:hover:bg-slate-700 text-white text-xs font-semibold px-4 py-2.5 shadow-lg backdrop-blur transition-colors"
      >
        <Lightbulb size={14} aria-hidden="true" /> {t("suggestions.button")}
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suggestion-titre"
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-5"
          >
            <h3 id="suggestion-titre" className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t("suggestions.title")}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("suggestions.subtitle")}</p>

            {envoye ? (
              <div className="mt-4">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("suggestions.thanks")}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEnvoye(false)}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-300 px-3 py-2"
                  >
                    {t("suggestions.another")}
                  </button>
                  <button
                    type="button"
                    onClick={fermer}
                    className="text-xs font-semibold bg-slate-900 dark:bg-slate-700 text-white px-3.5 py-2 rounded-lg"
                  >
                    {t("common.actions.close")}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={envoyer} className="mt-4 space-y-3">
                <label htmlFor="suggestion-message" className="sr-only">
                  {t("suggestions.title")}
                </label>
                <textarea
                  id="suggestion-message"
                  ref={champ}
                  required
                  minLength={5}
                  maxLength={4000}
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("suggestions.placeholder")}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                />

                {erreur && <p className="text-xs text-red-600 dark:text-red-400">{erreur}</p>}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={fermer}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-300 px-3 py-2"
                  >
                    {t("common.actions.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={envoi}
                    className="text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white px-3.5 py-2 rounded-lg"
                  >
                    {envoi ? t("suggestions.sending") : t("suggestions.send")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
