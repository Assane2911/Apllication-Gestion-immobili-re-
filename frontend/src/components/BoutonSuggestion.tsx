import { Lightbulb } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import Dialogue from "./Dialogue";

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
export default function BoutonSuggestion({ aCote }: { aCote?: ReactNode } = {}) {
  const { t } = useTranslation();
  const emplacement = useLocation();
  const [ouvert, setOuvert] = useState(false);
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);

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
      {/* `aCote` : un raccourci rangé à gauche du bouton (le guide de démarrage, dans l'espace gestionnaire). */}
      <aside aria-label={t("suggestions.zone")} className="hidden sm:flex fixed bottom-4 right-4 z-40 items-center gap-2">
        {aCote}
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className="flex items-center gap-2 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 shadow-md transition-colors"
        >
          <Lightbulb size={14} aria-hidden="true" /> {t("suggestions.button")}
        </button>
      </aside>

      {ouvert && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-4">
          <Dialogue
            onClose={fermer}
            titreId="suggestion-titre"
            className="w-full max-w-lg rounded-2xl bg-white border border-contour-200 shadow-xl p-5"
          >
            <h3 id="suggestion-titre" className="text-base font-bold text-slate-900">
              {t("suggestions.title")}
            </h3>
            <p className="mt-1 text-xs text-slate-600">{t("suggestions.subtitle")}</p>

            {envoye ? (
              <div className="mt-4">
                <p className="text-sm text-emerald-700">{t("suggestions.thanks")}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEnvoye(false)}
                    className="text-xs font-semibold text-slate-600 px-3 py-2"
                  >
                    {t("suggestions.another")}
                  </button>
                  <button
                    type="button"
                    onClick={fermer}
                    className="text-xs font-semibold bg-slate-900 text-white px-3.5 py-2 rounded-lg"
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
                  required
                  minLength={5}
                  maxLength={4000}
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("suggestions.placeholder")}
                  className="w-full rounded-xl border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm"
                />

                {erreur && <p role="alert" className="text-xs text-red-600">{erreur}</p>}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={fermer}
                    className="text-xs font-semibold text-slate-600 px-3 py-2"
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
          </Dialogue>
        </div>
      )}
    </>
  );
}
