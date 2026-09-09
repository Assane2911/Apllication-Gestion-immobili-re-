/**
 * Zoom plein écran sur une photo (galerie d'incidents, gestionnaire et
 * locataire). Cliquer n'importe où referme l'agrandissement.
 */
export default function PhotoLightbox({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50 cursor-zoom-out backdrop-blur-sm"
    >
      <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl border border-slate-700" />
    </div>
  );
}
