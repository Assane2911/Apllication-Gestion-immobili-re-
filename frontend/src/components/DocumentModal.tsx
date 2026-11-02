import { Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled } from "../api/client";
import { useDialogue } from "../hooks/useDialogue";

interface DocumentModalProps {
  title: string;
  docUrl: string; // e.g. "/documents/receipt/inv_123" or "/documents/lease/con_456"
  onClose: () => void;
}

export default function DocumentModal({ title, docUrl, onClose }: DocumentModalProps) {
  const { t } = useTranslation();
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sans AbortController, un changement de docUrl pendant que ce composant
  // reste monté (ex. bascule mois/année sans fermer la modale) pouvait
  // afficher un document périmé si l'ancienne requête répondait après la
  // nouvelle — même schéma que MessagesPage.tsx.
  useEffect(() => {
    setLoading(true);
    setError(null);
    // Le document précédent ne doit pas rester affiché sous le suivant, ni sous son erreur.
    setHtmlContent(null);
    const controller = new AbortController();
    api
      .get(docUrl, { responseType: "text", signal: controller.signal })
      .then((res) => {
        setHtmlContent(res.data);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setError(apiErrorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [docUrl]);

  const [erreurImpression, setErreurImpression] = useState(false);

  /**
   * Impression du document affiché dans l'iframe.
   *
   * L'iframe portait `sandbox=""`. Une chaîne vide n'est pas « pas de bac à
   * sable » : c'est TOUTES les restrictions activées. L'iframe recevait donc
   * une origine opaque, depuis laquelle `contentWindow.print` n'existe
   * simplement pas — la liste blanche cross-origin ne l'expose pas. L'appel
   * levait, rien ne l'attrapait, et le clic ne produisait absolument rien :
   * ni impression, ni message. Le document, lui, s'affichait parfaitement,
   * ce qui rendait la panne incompréhensible.
   *
   * `allow-same-origin allow-modals` rétablit l'accès et la boîte de dialogue
   * d'impression. `allow-scripts` reste volontairement absent : le document
   * vient de notre propre serveur, il est statique, et sans cette permission
   * aucun script ne peut s'exécuter dans l'iframe quoi qu'il contienne.
   *
   * Le try/catch n'est pas de la prudence décorative : c'est ce qui manquait
   * pour que la panne se voie au lieu de se taire.
   */
  function handlePrint() {
    try {
      const fenetre = iframeRef.current?.contentWindow;
      if (!fenetre) throw new Error("Document non chargé");
      fenetre.focus();
      fenetre.print();
      setErreurImpression(false);
    } catch {
      setErreurImpression(true);
    }
  }

  const dialogue = useDialogue({ onClose, titreId: "document-title" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div {...dialogue} className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden border-2 border-ink-900 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-ink-900 bg-ink-900 px-6 py-4 text-white">
          <div className="min-w-0">
            <h3 id="document-title" className="text-base font-bold">
              {title}
            </h3>
            <p className="text-xs text-white/85">{erreurImpression ? t("components.documentModal.printFailed") : t("components.documentModal.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={!htmlContent}
              className="inline-flex cursor-pointer items-center gap-1.5 border border-white bg-white px-3.5 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              <Printer size={14} aria-hidden="true" /> {t("components.documentModal.print")}
            </button>
            <button onClick={onClose} className="cursor-pointer p-2 text-white/80 hover:text-white" aria-label={t("common.actions.close")}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden bg-slate-100 p-4">
          {loading && <div className="absolute inset-0 flex items-center justify-center font-mono text-xs uppercase tracking-wider text-slate-600">{t("components.documentModal.loading")}</div>}
          {error && (
            <div role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-rose-800">
              {error}
            </div>
          )}
          {htmlContent && (
            <iframe ref={iframeRef} srcDoc={htmlContent} title={title} sandbox="allow-same-origin allow-modals" className="h-full w-full border border-slate-400 bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
