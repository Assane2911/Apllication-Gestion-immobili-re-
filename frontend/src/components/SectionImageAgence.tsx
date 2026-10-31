import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import type { AgencySettings } from "../types";

const CHAMP_REPONSE = { logo: "logoUrl", stamp: "stampOrSignatureUrl" } as const;

/**
 * Image de l'agence imprimée sur les quittances : le logo (en-tête) ou le tampon (à côté de « Quittance validée »).
 * Elle s'envoie à part du formulaire (fichier), et le formulaire ne la renvoie jamais. Mêmes règles que le serveur
 * (PNG ou JPEG, 2 Mo), vérifiées d'abord pour répondre sans attendre l'envoi.
 */
export default function SectionImageAgence({
  ressource,
  url,
  onChange,
}: {
  ressource: keyof typeof CHAMP_REPONSE;
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const { t } = useTranslation();
  const cle = `manager.agencySettings.${ressource}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    setSaved(false);
    if (fichier.type !== "image/png" && fichier.type !== "image/jpeg") return setError(t(`${cle}.wrongType`));
    if (fichier.size > 2 * 1024 * 1024) return setError(t(`${cle}.tooLarge`));
    setBusy(true);
    setError(null);
    try {
      const data = new FormData();
      data.append(ressource, fichier);
      const res = await api.post<AgencySettings>(`/agency/${ressource}`, data);
      onChange(res.data[CHAMP_REPONSE[ressource]] ?? null);
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm(t(`${cle}.confirmRemove`))) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.delete(`/agency/${ressource}`);
      onChange(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`agency-${ressource}-title`}
      className="bg-white rounded-2xl border border-contour-200 shadow-sm p-6"
    >
      <h3 id={`agency-${ressource}-title`} className="text-sm font-bold text-slate-800 uppercase tracking-wider">
        {t(`${cle}.title`)}
      </h3>
      <p className="text-sm text-slate-600 mt-2">{t(`${cle}.description`)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {url && (
          <img
            src={url}
            alt={t(`${cle}.previewAlt`)}
            className="h-14 max-w-[200px] object-contain rounded-lg border border-contour-200 bg-white p-1"
          />
        )}
        <label
          className={`inline-flex items-center px-4 py-2 rounded-xl text-sm font-semibold border border-slate-300 bg-white text-slate-800 shadow-sm focus-within:ring-2 focus-within:ring-brand-500 ${
            busy ? "opacity-60 cursor-wait" : "cursor-pointer hover:bg-slate-50"
          }`}
        >
          {busy ? t(`${cle}.uploading`) : url ? t(`${cle}.replace`) : t(`${cle}.choose`)}
          <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={handleChosen} />
        </label>
        {url && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-60"
          >
            {t(`${cle}.remove`)}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {t(`${cle}.saved`)}
        </p>
      )}
    </section>
  );
}
