import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import type { Cotenant, Tenant } from "../types";
import CadreModale from "./CadreModale";
import { BOUTON_PLEIN, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

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

  return (
    <CadreModale titre={t("components.cotenants.title")} titreId="cotenants-title" sousTitre={t("components.cotenants.hint")} onClose={onClose} fermable={!saving}>
      {verrouille && <p className={INFO}>{t("components.cotenants.locked")}</p>}

      {colocs.length === 0 ? (
        <p className="text-sm text-slate-600">{t("components.cotenants.none")}</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-300 border border-slate-300 px-3">
          {colocs.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-slate-800">
                <span className="font-semibold">
                  {c.tenant.firstName} {c.tenant.lastName}
                </span>
                <span className="block text-xs text-slate-600">{[c.tenant.email, c.tenant.phone].filter(Boolean).join(" · ")}</span>
              </span>
              {!verrouille && (
                <button type="button" onClick={() => retirer(c)} aria-label={t("components.cotenants.remove", { name: c.tenant.firstName })} className="cursor-pointer p-1 text-slate-500 hover:text-rose-700">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!verrouille && colocs.length < 5 && (
        <form onSubmit={ajouter} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-300 pt-4">
          <div className="min-w-48 flex-1">
            <label htmlFor="cotenant-select" className={ETIQUETTE}>
              {t("components.cotenants.choose")}
            </label>
            <select id="cotenant-select" value={choix} onChange={(e) => setChoix(e.target.value)} className={CHAMP}>
              <option value="">{proposables.length ? t("components.cotenants.placeholder") : t("components.cotenants.noneAvailable")}</option>
              {proposables.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.firstName} {l.lastName} — {l.email}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={saving || !choix} className={BOUTON_PLEIN}>
            {saving ? t("components.cotenants.saving") : t("components.cotenants.add")}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className={`mt-3 ${ERREUR}`}>
          {error}
        </p>
      )}
    </CadreModale>
  );
}
