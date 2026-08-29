import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import type { Tenant } from "../../types";

const emptyForm = { firstName: "", lastName: "", phone: "", email: "" };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [portalTenant, setPortalTenant] = useState<Tenant | null>(null);
  const [portalPassword, setPortalPassword] = useState("");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  function load() {
    api.get<Tenant[]>("/tenants").then((res) => setTenants(res.data));
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setIdDocument(null);
    setShowForm(true);
  }

  function openEdit(t: Tenant) {
    setEditing(t);
    setForm({ firstName: t.firstName, lastName: t.lastName, phone: t.phone, email: t.email });
    setIdDocument(null);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => data.append(k, v));
      if (idDocument) data.append("idDocument", idDocument);

      if (editing) {
        await api.put(`/tenants/${editing.id}`, data);
      } else {
        await api.post("/tenants", data);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function openIdDocument(t: Tenant) {
    try {
      // La pièce d'identité vit dans le bucket PRIVÉ de Supabase Storage : on
      // génère une URL signée à durée limitée à la demande, plutôt que de
      // stocker un lien public permanent vers un document sensible.
      const { data } = await api.get<{ url: string }>(`/tenants/${t.id}/id-document-url`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleDelete(t: Tenant) {
    if (!confirm(`Supprimer le locataire "${t.firstName} ${t.lastName}" ?`)) return;
    try {
      await api.delete(`/tenants/${t.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleCreatePortal(e: React.FormEvent) {
    e.preventDefault();
    if (!portalTenant) return;
    setPortalMsg(null);
    try {
      await api.post(`/tenants/${portalTenant.id}/portal-account`, { password: portalPassword });
      setPortalMsg("Accès portail créé avec succès. Communiquez l'email et le mot de passe au locataire.");
      load();
    } catch (err) {
      setPortalMsg(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Locataires</h2>
          <p className="text-sm text-slate-500 mt-1">{tenants.length} locataire(s) enregistré(s)</p>
        </div>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
          + Ajouter un locataire
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 mb-4">{editing ? "Modifier le locataire" : "Nouveau locataire"}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Prénom</label>
              <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nom</label>
              <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Téléphone</label>
              <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Pièce d'identité (image ou PDF)</label>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setIdDocument(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 px-4 py-2">
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {portalTenant && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 mb-1">Créer l'accès portail pour {portalTenant.firstName} {portalTenant.lastName}</h3>
          <p className="text-xs text-slate-500 mb-4">Identifiant : {portalTenant.email}</p>
          <form onSubmit={handleCreatePortal} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mot de passe temporaire</label>
              <input required minLength={8} type="text" value={portalPassword} onChange={(e) => setPortalPassword(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
              Créer l'accès
            </button>
            <button type="button" onClick={() => { setPortalTenant(null); setPortalMsg(null); }} className="text-sm text-slate-500 px-2 py-2">
              Fermer
            </button>
          </form>
          {portalMsg && <p className="text-sm mt-2 text-slate-600">{portalMsg}</p>}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Téléphone</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Pièce d'identité</th>
              <th className="px-4 py-3 font-medium">Portail</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{t.firstName} {t.lastName}</td>
                <td className="px-4 py-3 text-slate-600">{t.phone}</td>
                <td className="px-4 py-3 text-slate-600">{t.email}</td>
                <td className="px-4 py-3">
                  {t.idDocument ? (
                    <button onClick={() => openIdDocument(t)} className="text-brand-600 hover:underline">
                      Voir
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {t.userId ? (
                    <span className="text-emerald-600 text-xs">Activé</span>
                  ) : (
                    <button onClick={() => { setPortalTenant(t); setPortalMsg(null); setPortalPassword(""); }} className="text-brand-600 hover:underline text-xs">
                      Créer l'accès
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button onClick={() => openEdit(t)} className="text-brand-600 hover:underline text-xs">Modifier</button>
                  <button onClick={() => handleDelete(t)} className="text-red-600 hover:underline text-xs">Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
