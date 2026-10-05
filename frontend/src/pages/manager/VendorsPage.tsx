import { HardHat } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import ChampTelephone from "../../components/ChampTelephone";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import type { Vendor } from "../../types";
import Bulle from "../../components/Bulle";

const emptyForm = { name: "", trade: "", phone: "", email: "", notes: "" };

export default function VendorsPage() {
  const { t } = useTranslation();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<Vendor[]>("/vendors")
      .then((res) => {
        setVendors(Array.isArray(res.data) ? res.data : []);
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(vendor: Vendor) {
    setEditing(vendor);
    setForm({
      name: vendor.name,
      trade: vendor.trade ?? "",
      phone: vendor.phone,
      email: vendor.email ?? "",
      notes: vendor.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        trade: form.trade || undefined,
        phone: form.phone,
        email: form.email || undefined,
        notes: form.notes || undefined,
      };

      if (editing) {
        await api.put(`/vendors/${editing.id}`, body);
      } else {
        await api.post("/vendors", body);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(vendor: Vendor) {
    if (!confirm(t("manager.vendors.confirmDelete", { name: vendor.name }))) return;
    try {
      await api.delete(`/vendors/${vendor.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.vendors.title")}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t("manager.vendors.count", { count: vendors.length })}</p>
        </div>
        <Bulle texte={t("manager.tips.vendorCreate")}>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-brand-600/20 transition-all">
          {t("manager.vendors.addBtn")}
        </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={load} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">{editing ? t("manager.vendors.formTitleEdit") : t("manager.vendors.formTitleNew")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vendor-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.vendors.fields.name")}</label>
              <input id="vendor-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="vendor-trade" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.vendors.fields.trade")}</label>
              <input id="vendor-trade" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder={t("manager.vendors.fields.tradePlaceholder")} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="vendor-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.vendors.fields.phone")}</label>
              <ChampTelephone id="vendor-phone" required value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
            <div>
              <label htmlFor="vendor-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.vendors.fields.email")}</label>
              <input id="vendor-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="vendor-notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.vendors.fields.notes")}</label>
              <textarea id="vendor-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-600 dark:text-slate-400 px-4 py-2">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      ) : vendors.length === 0 && !showForm ? (
        <EmptyState
          icon={HardHat}
          title={t("manager.vendors.emptyTitle")}
          description={t("manager.vendors.emptyDesc")}
          action={{ label: t("manager.vendors.addBtn"), onClick: openCreate }}
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t("manager.vendors.table.name")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.vendors.table.trade")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.vendors.table.phone")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.vendors.table.email")}</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {vendors.map((vendor) => (
                <tr key={vendor.id}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{vendor.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{vendor.trade || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{vendor.phone}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{vendor.email || "—"}</td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <Bulle texte={t("manager.tips.vendorEdit")}><button onClick={() => openEdit(vendor)} className="text-brand-600 dark:text-brand-400 hover:underline text-xs">{t("common.actions.edit")}</button></Bulle>
                    <Bulle texte={t("manager.tips.vendorDelete")}><button onClick={() => handleDelete(vendor)} className="text-red-600 dark:text-red-400 hover:underline text-xs">{t("common.actions.delete")}</button></Bulle>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
