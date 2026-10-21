import { Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useCurrency } from "../context/currency";
import type { Guarantor } from "../types";
import ChampTelephone from "./ChampTelephone";
import { useDialogue } from "../hooks/useDialogue";

interface GuarantorsModalProps {
  contractId: string;
  currency?: string;
  /** Bail signé par le locataire : les garants font partie du contenu signé, consultation seule. */
  verrouille: boolean;
  onChange: () => void;
  onClose: () => void;
}

/** Lit un plafond saisi à la main : « 1 500 000,50 » vaut 1500000.5 ; « » vaut sans plafond ; tout autre texte est illisible. */
function lirePlafond(saisie: string): number | null | "illisible" {
  const texte = saisie.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (texte === "") return null;
  return /^\d+(\.\d+)?$/.test(texte) ? Number(texte) : "illisible";
}

const vide = { civility: "", firstName: "", lastName: "", phone: "", email: "", address: "", maxAmount: "", notes: "" };

/** Garants d'un bail : liste, ajout, modification, retrait (jusqu'à la signature du locataire). */
export default function GuarantorsModal({ contractId, currency, verrouille, onChange, onClose }: GuarantorsModalProps) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [garants, setGarants] = useState<Guarantor[]>([]);
  const [form, setForm] = useState(vide);
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [formOuvert, setFormOuvert] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const { data } = await api.get<Guarantor[]>(`/contracts/${contractId}/guarantors`);
      setGarants(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, [contractId]);
  useEffect(() => {
    charger();
  }, [charger]);

  function ouvrir(g?: Guarantor) {
    setError(null);
    setEnEdition(g?.id ?? null);
    setForm(
      g
        ? { civility: g.civility ?? "", firstName: g.firstName, lastName: g.lastName, phone: g.phone, email: g.email ?? "", address: g.address ?? "", maxAmount: g.maxAmount === null ? "" : String(g.maxAmount), notes: g.notes ?? "" }
        : vide
    );
    setFormOuvert(true);
  }

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const plafond = lirePlafond(form.maxAmount);
    if (plafond === "illisible") {
      setError(t("components.guarantors.maxAmountInvalid"));
      return;
    }
    setSaving(true);
    const corps = {
      civility: form.civility || null,
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      maxAmount: plafond,
      notes: form.notes.trim() || null,
    };
    try {
      if (enEdition) await api.put(`/contracts/${contractId}/guarantors/${enEdition}`, corps);
      else await api.post(`/contracts/${contractId}/guarantors`, corps);
      setFormOuvert(false);
      await charger();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function retirer(g: Guarantor) {
    if (!window.confirm(t("components.guarantors.confirmDelete", { name: `${g.firstName} ${g.lastName}` }))) return;
    setError(null);
    try {
      await api.delete(`/contracts/${contractId}/guarantors/${g.id}`);
      await charger();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const champ = "w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm";
  const etiquette = "block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1";

  const dialogue = useDialogue({ onClose, titreId: "guarantors-title", fermable: !saving });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div {...dialogue} className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-contour-200 dark:border-slate-700">
        <div className="flex items-start justify-between">
          <h3 id="guarantors-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("components.guarantors.title")}</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t("common.actions.close")} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        {verrouille && <p className="mt-3 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">{t("components.guarantors.locked")}</p>}

        {garants.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{t("components.guarantors.none")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-contour-100 dark:divide-slate-800">
            {garants.map((g) => (
              <li key={g.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                <span className="text-slate-800 dark:text-slate-200">
                  <span className="font-medium">
                    {g.civility ? `${t(`common.civility.${g.civility}`)} ` : ""}
                    {g.firstName} {g.lastName}
                  </span>
                  <span className="block text-xs text-slate-600 dark:text-slate-400">{[g.phone, g.email, g.address].filter(Boolean).join(" · ")}</span>
                  {g.maxAmount !== null && (
                    <span className="block text-xs text-slate-600 dark:text-slate-400">{t("components.guarantors.maxAmountRow", { amount: formatMoney(g.maxAmount, currency) })}</span>
                  )}
                </span>
                {!verrouille && (
                  <span className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => ouvrir(g)} aria-label={t("components.guarantors.edit", { name: g.firstName })} className="text-slate-400 hover:text-brand-600">
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => retirer(g)} aria-label={t("components.guarantors.remove", { name: g.firstName })} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {!verrouille && !formOuvert && garants.length < 5 && (
          <button type="button" onClick={() => ouvrir()} className="mt-4 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:underline">
            {t("components.guarantors.add")}
          </button>
        )}

        {!verrouille && formOuvert && (
          <form onSubmit={enregistrer} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-contour-100 dark:border-slate-800 pt-4">
            <div className="sm:col-span-2">
              <label htmlFor="g-civility" className={etiquette}>{t("common.civility.label")}</label>
              <select id="g-civility" value={form.civility} onChange={(e) => setForm({ ...form, civility: e.target.value })} className={champ}>
                <option value="">{t("common.civility.none")}</option>
                <option value="M">{t("common.civility.M")}</option>
                <option value="MME">{t("common.civility.MME")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="g-firstName" className={etiquette}>{t("components.guarantors.firstName")}</label>
              <input id="g-firstName" required maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={champ} />
            </div>
            <div>
              <label htmlFor="g-lastName" className={etiquette}>{t("components.guarantors.lastName")}</label>
              <input id="g-lastName" required maxLength={100} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={champ} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="g-phone" className={etiquette}>{t("components.guarantors.phone")}</label>
              <ChampTelephone id="g-phone" required value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
            <div>
              <label htmlFor="g-email" className={etiquette}>{t("components.guarantors.email")}</label>
              <input id="g-email" type="email" aria-describedby="g-email-hint" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={champ} />
              <p id="g-email-hint" className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("components.guarantors.emailHint")}</p>
            </div>
            <div>
              <label htmlFor="g-maxAmount" className={etiquette}>{t("components.guarantors.maxAmount")}</label>
              <input id="g-maxAmount" inputMode="decimal" value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} className={champ} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="g-address" className={etiquette}>{t("components.guarantors.address")}</label>
              <input id="g-address" value={form.address} maxLength={300} onChange={(e) => setForm({ ...form, address: e.target.value })} className={champ} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="g-notes" className={etiquette}>{t("components.guarantors.notes")}</label>
              <textarea id="g-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={champ} />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOuvert(false)} disabled={saving} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">
                {t("common.actions.cancel")}
              </button>
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                {saving ? t("components.guarantors.saving") : t("components.guarantors.save")}
              </button>
            </div>
          </form>
        )}

        {error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
