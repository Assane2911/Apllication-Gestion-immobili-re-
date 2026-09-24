import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";

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
  const [visible, setVisible] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get(docUrl, { responseType: "text" })
      .then((res) => {
        setHtmlContent(res.data);
      })
      .catch((err) => {
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        setLoading(false);
      });
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

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full h-[85vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-all duration-200 ${
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {erreurImpression
                ? t("components.documentModal.printFailed")
                : t("components.documentModal.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={!htmlContent}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <span>🖨️</span> {t("components.documentModal.print")}
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2 text-lg font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-4 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">
              {t("components.documentModal.loading")}
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-red-600 text-sm p-4 text-center">
              {error}
            </div>
          )}
          {htmlContent && (
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              title={title}
              sandbox="allow-same-origin allow-modals"
              className="w-full h-full bg-white rounded-xl shadow border border-slate-200 dark:border-slate-700"
            />
          )}
        </div>
      </div>
    </div>
  );
}
