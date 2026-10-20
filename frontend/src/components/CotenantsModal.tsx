import { Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import type { Cotenant, Tenant } from "../types";
import { useDialogue } from "../hooks/useDialogue";

interface CotenantsModalProps {
  contractId: string;
  /** Titulaire du bail : ne peut pas être ajouté comme colocataire. */
  titulaireId: string;
  /** Locataires de l'agence, proposés à l'ajout. */
  locataires: Tenant[];
  /** Bail signé par le titulaire : colocation figée, consultation seule. */
  verrouille: boolean;
  onChange: () => void;
  onClose: () => void;
}

/** Colocataires d'un bail : des fiches locataires de l'agence ajoutées au bail du titulaire. */
export default function CotenantsModal({ contractId, titulaireId, locataires, verrouille, onChange, onClose }: CotenantsModalProps) {
  const { t } = useTranslation();
  const [colocs, setColocs] = useState<Cotenant[]>([]);
  const [choix, setChoix] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const { data } = await api.get<Cotenant[]>(`/contracts/${contractId}/cotenants`);
      setColocs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, [contractId]);
  useEffect(() => {
    charger();
  }, [charger]);

  const dejaLa = new Set(colocs.map((c) => c.tenant.id));
  const proposables = locataires.filter((l) => l.id !== titulaireId && !dejaLa.has(l.id) && !l.anonymizedAt);

  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    if (!choix) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/contracts/${contractId}/cotenants`, { tenantId: choix });
      setChoix("");
      await charger();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function retirer(c: Cotenant) {
    const nom = `${c.tenant.firstName} ${c.tenant.lastName}`;
    if (!window.confirm(t("components.cotenants.confirmRemove", { name: nom }))) return;
    setError(null);
    try {
      await api.delete(`/contracts/${contractId}/cotenants/${c.id}`);
      await charger();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const dialogue = useDialogue({ onClose, titreId: "cotenants-title", fermable: !saving });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div {...dialogue} className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-start justify-between">
          <h3 id="cotenants-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("components.cotenants.title")}</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t("common.actions.close")} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{t("components.cotenants.hint")}</p>
        {verrouille && <p className="mt-3 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">{t("components.cotenants.locked")}</p>}

        {colocs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{t("components.cotenants.none")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {colocs.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  <span className="font-medium">{c.tenant.firstName} {c.tenant.lastName}</span>
                  <span className="block text-xs text-slate-600 dark:text-slate-400">{[c.tenant.email, c.tenant.phone].filter(Boolean).join(" · ")}</span>
                </span>
                {!verrouille && (
                  <button type="button" onClick={() => retirer(c)} aria-label={t("components.cotenants.remove", { name: c.tenant.firstName })} className="text-slate-400 hover:text-red-600">
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!verrouille && colocs.length < 5 && (
          <form onSubmit={ajouter} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="cotenant-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t("components.cotenants.choose")}</label>
              <select id="cotenant-select" value={choix} onChange={(e) => setChoix(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{proposables.length ? t("components.cotenants.placeholder") : t("components.cotenants.noneAvailable")}</option>
                {proposables.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.firstName} {l.lastName} — {l.email}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={saving || !choix} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg">
              {saving ? t("components.cotenants.saving") : t("components.cotenants.add")}
            </button>
          </form>
        )}

        {error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
