import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";

interface DocumentModalProps {
  title: string;
  docUrl: string; // e.g. "/documents/receipt/inv_123" or "/documents/lease/con_456"
  onClose: () => void;
}

export default function DocumentModal({ title, docUrl, onClose }: DocumentModalProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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

  function handlePrint() {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            <p className="text-xs text-slate-500">Aperçu officiel certifié & Téléchargement / Impression</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={!htmlContent}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <span>🖨️</span> Imprimer / Enregistrer PDF
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-2 text-lg font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100 p-4 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
              Chargement du document officiel...
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
              className="w-full h-full bg-white rounded-xl shadow border border-slate-200"
            />
          )}
        </div>
      </div>
    </div>
  );
}
