import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import type { AgencySettings } from "../../types";

export default function AgencySettingsPage() {
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    agencyName: "",
    siretOrId: "",
    address: "",
    phone: "",
    email: "",
    legalNotice: "",
  });

  useEffect(() => {
    api.get<AgencySettings>("/agency").then((res) => {
      setForm({
        agencyName: res.data.agencyName || "",
        siretOrId: res.data.siretOrId || "",
        address: res.data.address || "",
        phone: res.data.phone || "",
        email: res.data.email || "",
        legalNotice: res.data.legalNotice || "",
      });
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await api.put<AgencySettings>("/agency", form);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">🏢 Identité de l'Agence & Marque Blanche</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Personnalisez les coordonnées et mentions légales qui apparaîtront sur vos quittances et contrats officiels
        </p>
      </div>

      {success && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <span>✅</span> Paramètres de l'agence mis à jour avec succès ! Vos futures quittances intégreront ces informations.
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nom commercial de l'agence *
              </label>
              <input
                required
                value={form.agencyName}
                onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
                placeholder="Ex: Horizon Immobilier Prestige"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                N° SIRET / Registre du Commerce (NIF)
              </label>
              <input
                value={form.siretOrId}
                onChange={(e) => setForm({ ...form, siretOrId: e.target.value })}
                placeholder="Ex: 849 203 194 00012"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Email de contact officiel *
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contact@monagence.com"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Téléphone de l'agence
              </label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+33 1 40 00 00 00"
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Adresse du siège de l'agence
            </label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="12 Avenue des Champs-Élysées, 75008 Paris"
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Mentions légales du pied de page des quittances
            </label>
            <textarea
              rows={3}
              value={form.legalNotice}
              onChange={(e) => setForm({ ...form, legalNotice: e.target.value })}
              placeholder="Ex: Société de gestion immobilière SARL au capital de 50 000€. Carte professionnelle Transaction et Gestion Immobilière n°CPI 7501 délivrée par la CCI..."
              className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-6 py-2.5 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              {saving ? "Sauvegarde en cours..." : "Enregistrer les paramètres"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
