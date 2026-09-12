import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Image as ImageIcon, Printer, X } from "lucide-react";

interface ScannedContractModalProps {
  title: string;
  fileUrl: string;
  onClose: () => void;
}

export default function ScannedContractModal({ title, fileUrl, onClose }: ScannedContractModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const isPdf = /\.pdf(\?.*)?$/i.test(fileUrl) || fileUrl.includes("application/pdf");

  function handlePrint() {
    window.open(fileUrl, "_blank")?.print();
  }

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full h-[88vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-all duration-200 ${
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 flex items-center justify-center">
              {isPdf ? <FileText size={18} /> : <ImageIcon size={18} />}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isPdf ? "Document PDF numérisé" : "Scan image / photo haute résolution"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Imprimer"
            >
              <Printer size={14} />
              <span>Imprimer</span>
            </button>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download size={14} />
              <span>Télécharger</span>
            </a>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <ExternalLink size={14} />
              <span>Plein écran</span>
            </a>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2 text-lg font-bold rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Fermer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-4 relative overflow-hidden flex items-center justify-center">
          {isPdf ? (
            <iframe
              src={fileUrl}
              title={title}
              className="w-full h-full bg-white rounded-xl shadow border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-2">
              <img
                src={fileUrl}
                alt={title}
                className="max-w-full max-h-full object-contain rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 bg-white"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
