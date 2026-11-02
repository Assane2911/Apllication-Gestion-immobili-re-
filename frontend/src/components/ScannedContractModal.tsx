import { useTranslation } from "react-i18next";
import { Download, ExternalLink, FileText, Image as ImageIcon, Printer, X } from "lucide-react";
import { useDialogue } from "../hooks/useDialogue";

interface ScannedContractModalProps {
  title: string;
  fileUrl: string;
  onClose: () => void;
}

export default function ScannedContractModal({ title, fileUrl, onClose }: ScannedContractModalProps) {
  const { t } = useTranslation();
  const isPdf = /\.pdf(\?.*)?$/i.test(fileUrl) || fileUrl.includes("application/pdf");

  /**
   * Le contrat scanné vit dans le stockage Supabase, donc sur une AUTRE
   * origine que l'application. `window.open(url).print()` était condamné deux
   * fois : le navigateur refuse `print()` sur une fenêtre d'une autre origine,
   * et l'appel partait de toute façon avant que le document soit chargé — il
   * n'y aurait rien eu à imprimer.
   *
   * On ouvre donc l'onglet et on laisse l'utilisateur imprimer depuis son
   * propre navigateur, ce qu'il sait faire. Un bouton qui ouvre honnêtement le
   * document vaut mieux qu'un bouton qui prétend imprimer et ne fait rien.
   */
  function handlePrint() {
    window.open(fileUrl, "_blank", "noopener,noreferrer");
  }

  const dialogue = useDialogue({ onClose, titreId: "scanned-contract-title" });

  const BOUTON_BLANC =
    "inline-flex cursor-pointer items-center gap-1.5 border border-white/70 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div {...dialogue} className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden border-2 border-ink-900 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900 bg-ink-900 px-6 py-4 text-white">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-white/70">{isPdf ? <FileText size={18} aria-hidden="true" /> : <ImageIcon size={18} aria-hidden="true" />}</div>
            <div className="min-w-0">
              <h3 id="scanned-contract-title" className="text-base font-bold">
                {title}
              </h3>
              <p className="text-xs text-white/85">{isPdf ? t("components.scannedContractModal.pdfSubtitle") : t("components.scannedContractModal.imageSubtitle")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handlePrint} className={BOUTON_BLANC}>
              <Printer size={14} aria-hidden="true" />
              <span>{t("components.scannedContractModal.print")}</span>
            </button>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" download className={BOUTON_BLANC}>
              <Download size={14} aria-hidden="true" />
              <span>{t("components.scannedContractModal.download")}</span>
            </a>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border border-white bg-white px-3 py-2 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-100">
              <ExternalLink size={14} aria-hidden="true" />
              <span>{t("components.scannedContractModal.fullscreen")}</span>
            </a>
            <button onClick={onClose} className="cursor-pointer p-2 text-white/80 hover:text-white" aria-label={t("common.actions.close")}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-100 p-4">
          {isPdf ? (
            <iframe src={fileUrl} title={title} className="h-full w-full border border-slate-400 bg-white" />
          ) : (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-2">
              <img src={fileUrl} alt={title} className="max-h-full max-w-full border border-slate-400 bg-white object-contain" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
