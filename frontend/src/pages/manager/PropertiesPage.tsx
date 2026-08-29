import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, apiErrorMessage, fileUrl } from "../../api/client";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import { PropertyCardSkeleton } from "../../components/Skeleton";
import { useCurrency } from "../../context/CurrencyContext";
import type { Property, PropertyStatus } from "../../types";

const emptyForm = { title: "", address: "", surface: "", rent: "", status: "AVAILABLE" as PropertyStatus, description: "" };

export default function PropertiesPage() {
  const { formatMoney } = useCurrency();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<Property[]>("/properties")
      .then((res) => setProperties(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setImage(null);
    setShowForm(true);
  }

  function openEdit(p: Property) {
    setEditing(p);
    setForm({
      title: p.title,
      address: p.address,
      surface: String(p.surface),
      rent: String(p.rent),
      status: p.status,
      description: p.description ?? "",
    });
    setImage(null);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("title", form.title);
      data.append("address", form.address);
      data.append("surface", form.surface);
      data.append("rent", form.rent);
      data.append("status", form.status);
      if (form.description) data.append("description", form.description);
      if (image) data.append("image", image);

      if (editing) {
        await api.put(`/properties/${editing.id}`, data);
      } else {
        await api.post("/properties", data);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: Property) {
    if (!confirm(`Supprimer le bien "${p.title}" ?`)) return;
    try {
      await api.delete(`/properties/${p.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Biens immobiliers</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{properties.length} bien(s) enregistré(s)</p>
        </div>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
          + Ajouter un bien
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">{editing ? "Modifier le bien" : "Nouveau bien"}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Titre</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Adresse</label>
              <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Surface (m²)</label>
              <input required type="number" step="0.1" value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Loyer mensuel</label>
              <input required type="number" step="0.01" value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Statut</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PropertyStatus })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="AVAILABLE">Disponible</option>
                <option value="OCCUPIED">Occupé</option>
                <option value="MAINTENANCE">Maintenance</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Image</label>
              <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="w-full text-sm text-slate-700 dark:text-slate-300" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm" rows={3} />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 dark:text-slate-400 px-4 py-2">
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <PropertyCardSkeleton key={i} />
          ))}
        </div>
      ) : properties.length === 0 && !showForm ? (
        <EmptyState
          icon={Building2}
          title="Aucun bien pour l'instant"
          description="Ajoutez votre premier bien immobilier (avec photo, surface et loyer) pour commencer à suivre sa location."
          action={{ label: "+ Ajouter un bien", onClick: openCreate }}
        />
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {properties.map((p) => (
          <div key={p.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="h-36 bg-slate-100 dark:bg-slate-800">
              {p.imageUrl ? (
                <img src={fileUrl(p.imageUrl) ?? undefined} alt={p.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600 text-4xl">🏠</div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-slate-900 dark:text-slate-100">{p.title}</h4>
                <Badge status={p.status} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{p.address}</p>
              <div className="flex justify-between text-sm mt-3">
                <span className="text-slate-500 dark:text-slate-400">{p.surface} m²</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{formatMoney(p.rent, p.currency)} / mois</span>
              </div>
              <div className="flex gap-3 mt-3 text-xs">
                <button onClick={() => openEdit(p)} className="text-brand-600 dark:text-brand-400 hover:underline">
                  Modifier
                </button>
                <button onClick={() => handleDelete(p)} className="text-red-600 dark:text-red-400 hover:underline">
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
