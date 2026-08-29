import { useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "../api/client";

interface SignatureModalProps {
  contractId: string;
  contractTitle: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function SignatureModal({ contractId, contractTitle, onSuccess, onClose }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Déclenche la transition d'entrée au montage (fondu + léger zoom).
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

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
      setError("Veuillez apposer votre signature sur le cadre avant de valider.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL("image/png");

    setSaving(true);
    setError(null);
    try {
      await api.post(`/contracts/${contractId}/sign`, { signatureDataUrl });
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 transition-all duration-200 ${
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">✍️ Signature électronique du bail</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{contractTitle}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-semibold">
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 mt-4">
          Tracez votre signature au doigt ou à la souris dans le cadre ci-dessous. En validant, vous attestez
          l'exactitude et la signature légale du contrat de bail.
        </p>

        <div className="mt-3 relative border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 overflow-hidden touch-none flex items-center justify-center">
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
            className="cursor-crosshair w-full"
          />
          {!hasDrawn && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-400 text-sm font-medium">
              Signez ici
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex items-center justify-between mt-5 gap-3">
          <button
            type="button"
            onClick={clearCanvas}
            className="text-xs text-slate-600 hover:text-slate-900 border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded-lg font-medium transition-colors"
          >
            Effacer
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSaveSignature}
              disabled={saving}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              {saving ? "Validation..." : "Valider ma signature"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
