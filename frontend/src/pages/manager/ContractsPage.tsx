import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import SignatureModal from "../../components/SignatureModal";
import { useCurrency } from "../../context/CurrencyContext";
import type { Contract, ContractStatus, Property, Tenant } from "../../types";

const emptyForm = { propertyId: "", tenantId: "", rent: "", deposit: "", startDate: "", endDate: "" };

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("fr-FR");
}

export default function ContractsPage() {
  const { formatMoney } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [viewingLeaseContract, setViewingLeaseContract] = useState<Contract | null>(null);

  function load() {
    api.get<Contract[]>("/contracts").then((res) => setContracts(res.data));
    api.get<Property[]>("/properties").then((res) => setProperties(res.data));
    api.get<Tenant[]>("/tenants").then((res) => setTenants(res.data));
  }

  useEffect(load, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/contracts", form);
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(c: Contract, status: ContractStatus) {
    try {
      await api.put(`/contracts/${c.id}`, { status });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleDelete(c: Contract) {
    if (!confirm("Supprimer ce contrat et toutes ses factures associées ?")) return;
    try {
      await api.delete(`/contracts/${c.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  const availableProperties = properties.filter((p) => p.status !== "OCCUPIED");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Contrats de location & Baux</h2>
          <p className="text-sm text-slate-500 mt-1">{contracts.length} contrat(s) de bail en gestion</p>
        </div>
        <button onClick={() => setShowForm(true)} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
          + Nouveau contrat
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 mb-4">Nouveau contrat</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bien</label>
              <select required value={form.propertyId} onChange={(e) => {
                const prop = properties.find((p) => p.id === e.target.value);
                setForm({ ...form, propertyId: e.target.value, rent: prop ? String(prop.rent) : form.rent, deposit: prop ? String(prop.rent * 2) : form.deposit });
              }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Sélectionner un bien</option>
                {availableProperties.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Locataire</label>
              <select required value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Sélectionner un locataire</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Loyer mensuel</label>
              <input required type="number" step="0.01" value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Dépôt de garantie</label>
              <input required type="number" step="0.01" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date de début</label>
              <input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date de fin</label>
              <input required type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? "Enregistrement..." : "Créer le contrat"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 px-4 py-2">
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Bien</th>
              <th className="px-4 py-3 font-medium">Locataire</th>
              <th className="px-4 py-3 font-medium">Loyer</th>
              <th className="px-4 py-3 font-medium">Durée</th>
              <th className="px-4 py-3 font-medium">Signatures</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contracts.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 text-slate-900 font-medium">{c.property?.title}</td>
                <td className="px-4 py-3 text-slate-600">{c.tenant?.firstName} {c.tenant?.lastName}</td>
                <td className="px-4 py-3 text-slate-900 font-semibold">{formatMoney(c.rent, c.currency)}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">
                  {formatDate(c.startDate)} → {formatDate(c.endDate)}
                </td>
                <td className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500">Agence :</span>
                    {c.signedByManagerAt ? (
                      <span className="text-emerald-700 font-semibold">✅ Signé</span>
                    ) : (
                      <button
                        onClick={() => setSigningContract(c)}
                        className="text-brand-600 font-semibold hover:underline"
                      >
                        ✍️ Signer
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500">Locataire :</span>
                    {c.signedByTenantAt ? (
                      <span className="text-emerald-700 font-semibold">✅ Signé</span>
                    ) : (
                      <span className="text-amber-600">⏳ En attente</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3"><Badge status={c.status} /></td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  <button
                    onClick={() => setViewingLeaseContract(c)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1"
                  >
                    <span>📄</span> Bail PDF
                  </button>
                  {c.status === "ACTIVE" && (
                    <button onClick={() => changeStatus(c, "TERMINATED")} className="text-amber-600 hover:underline text-xs">
                      Résilier
                    </button>
                  )}
                  <button onClick={() => handleDelete(c)} className="text-red-600 hover:underline text-xs">
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {signingContract && (
        <SignatureModal
          contractId={signingContract.id}
          contractTitle={`Bail - ${signingContract.property?.title}`}
          onSuccess={() => {
            setSigningContract(null);
            load();
          }}
          onClose={() => setSigningContract(null)}
        />
      )}

      {viewingLeaseContract && (
        <DocumentModal
          title={`Contrat de Bail - ${viewingLeaseContract.property?.title}`}
          docUrl={`/documents/lease/${viewingLeaseContract.id}`}
          onClose={() => setViewingLeaseContract(null)}
        />
      )}
    </div>
  );
}

