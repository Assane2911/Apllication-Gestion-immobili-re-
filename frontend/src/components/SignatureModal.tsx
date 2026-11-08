import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import CadreModale from "./CadreModale";
import { BOUTON_ANNULER, BOUTON_PLEIN, BOUTON_TRAIT, ERREUR } from "./styleFormulaire";

interface SignatureModalProps {
  /** Chemin complet de l'endpoint de signature (ex: `/contracts/${id}/sign`, `/inspections/${id}/sign`). */
  signUrl: string;
  title: string;
  /** Ce qui est signé : le bail (par défaut) ou un état des lieux. Choisit le titre et le texte de la fenêtre. */
  objet?: "bail" | "etatDesLieux";
  onSuccess: () => void;
  onClose: () => void;
}

export default function SignatureModal({ signUrl, title, objet = "bail", onSuccess, onClose }: SignatureModalProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set line appearance
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function getCoordinates(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  }

  function startDrawing(e: React.MouseEvent | React.TouchEvent) {
    setIsDrawing(true);
    setHasDrawn(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing() {
    setIsDrawing(false);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function handleSaveSignature() {
    if (!hasDrawn) {
      setError(t("components.signatureModal.errorRequired"));
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL("image/png");

    setSaving(true);
    setError(null);
    try {
      await api.post(signUrl, { signatureDataUrl });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CadreModale titre={t(objet === "etatDesLieux" ? "components.signatureModal.titleInspection" : "components.signatureModal.title")} titreId="signature-title" sousTitre={title} onClose={onClose} fermable={!saving} largeur="lg">
      <p className="text-xs text-slate-600">{t(objet === "etatDesLieux" ? "components.signatureModal.instructionsInspection" : "components.signatureModal.instructions")}</p>

      <div className="relative mt-3 flex touch-none items-center justify-center overflow-hidden border-2 border-dashed border-slate-400 bg-slate-50">
        <canvas
          ref={canvasRef}
          width={460}
          height={180}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full cursor-crosshair"
        />
        {!hasDrawn && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs uppercase tracking-wider text-slate-600">
            {t("components.signatureModal.signHere")}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className={`mt-3 ${ERREUR}`}>
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-300 pt-4">
        <button type="button" onClick={clearCanvas} className={BOUTON_TRAIT}>
          {t("components.signatureModal.clear")}
        </button>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className={BOUTON_ANNULER}>
            {t("common.actions.cancel")}
          </button>
          <button type="button" onClick={handleSaveSignature} disabled={saving} className={BOUTON_PLEIN}>
            {saving ? t("components.signatureModal.validating") : t("components.signatureModal.validate")}
          </button>
        </div>
      </div>
    </CadreModale>
  );
}
