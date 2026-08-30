import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import { Skeleton, TableRowSkeleton } from "../../components/Skeleton";
import type { Tenant } from "../../types";

const emptyForm = { firstName: "", lastName: "", phone: "", email: "" };

export default function TenantsPage() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
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
    api
      .get<Tenant[]>("/tenants")
      .then((res) => setTenants(res.data))
      .finally(() => setLoading(false));
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

  async function openIdDocument(tenant: Tenant) {
    try {
      // La pièce d'identité vit dans le bucket PRIVÉ de Supabase Storage : on
      // génère une URL signée à durée limitée à la demande, plutôt que de
      // stocker un lien public permanent vers un document sensible.
      const { data } = await api.get<{ url: string }>(`/tenants/${tenant.id}/id-document-url`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleDelete(tenant: Tenant) {
    if (!confirm(t("manager.tenants.confirmDelete", { name: `${tenant.firstName} ${tenant.lastName}` }))) return;
    try {
      await api.delete(`/tenants/${tenant.id}`);
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
      setPortalMsg(t("manager.tenants.portalSuccess"));
      load();
    } catch (err) {
      setPortalMsg(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.tenants.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.tenants.count", { count: tenants.length })}</p>
        </div>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-brand-600/20 transition-all">
          {t("manager.tenants.addBtn")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">{editing ? t("manager.tenants.formTitleEdit") : t("manager.tenants.formTitleNew")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.tenants.fields.firstName")}</label>
              <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.tenants.fields.lastName")}</label>
              <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.tenants.fields.phone")}</label>
              <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.tenants.fields.email")}</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.tenants.fields.idDocument")}</label>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setIdDocument(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 dark:text-slate-400 px-4 py-2">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {portalTenant && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-1">
            {t("manager.tenants.createPortalTitle", { name: `${portalTenant.firstName} ${portalTenant.lastName}` })}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t("manager.tenants.loginId", { email: portalTenant.email })}</p>
          <form onSubmit={handleCreatePortal} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.tenants.tempPassword")}</label>
              <input required minLength={8} type="text" value={portalPassword} onChange={(e) => setPortalPassword(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {t("manager.tenants.createAccess")}
            </button>
            <button type="button" onClick={() => { setPortalTenant(null); setPortalMsg(null); }} className="text-sm text-slate-500 px-2 py-2">
              {t("common.actions.close")}
            </button>
          </form>
          {portalMsg && <p className="text-sm mt-2 text-slate-600 dark:text-slate-400">{portalMsg}</p>}
        </div>
      )}

      {!loading && tenants.length === 0 && !showForm ? (
        <EmptyState
          icon="👥"
          title={t("manager.tenants.emptyTitle")}
          description={t("manager.tenants.emptyDesc")}
          action={{ label: t("manager.tenants.addBtn"), onClick: openCreate }}
        />
      ) : (
      <>
      {/* Vue tableau (écrans sm et plus) */}
      <div className="hidden sm:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.tenants.table.name")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.tenants.table.phone")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.tenants.table.email")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.tenants.table.idDocument")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.tenants.table.portal")}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} columns={6} />)
            ) : (
            tenants.map((tenant) => (
              <tr key={tenant.id}>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{tenant.firstName} {tenant.lastName}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{tenant.phone}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{tenant.email}</td>
                <td className="px-4 py-3">
                  {tenant.idDocument ? (
                    <button onClick={() => openIdDocument(tenant)} className="text-brand-600 dark:text-brand-400 hover:underline">
                      {t("manager.tenants.viewIdDocument")}
                    </button>
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {tenant.userId ? (
                    <span className="text-emerald-600 dark:text-emerald-400 text-xs">{t("manager.tenants.portalActive")}</span>
                  ) : (
                    <button onClick={() => { setPortalTenant(tenant); setPortalMsg(null); setPortalPassword(""); }} className="text-brand-600 dark:text-brand-400 hover:underline text-xs">
                      {t("manager.tenants.createAccess")}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button onClick={() => openEdit(tenant)} className="text-brand-600 dark:text-brand-400 hover:underline text-xs">{t("common.actions.edit")}</button>
                  <button onClick={() => handleDelete(tenant)} className="text-red-600 dark:text-red-400 hover:underline text-xs">{t("common.actions.delete")}</button>
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>

      {/* Vue cartes empilées (mobile, < sm) */}
      <div className="sm:hidden space-y-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))
          : tenants.map((tenant) => (
              <div key={tenant.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{tenant.firstName} {tenant.lastName}</p>
                  {tenant.userId ? (
                    <span className="text-emerald-600 dark:text-emerald-400 text-[11px] font-medium shrink-0">{t("manager.tenants.portalActiveMobile")}</span>
                  ) : (
                    <button onClick={() => { setPortalTenant(tenant); setPortalMsg(null); setPortalPassword(""); }} className="text-brand-600 dark:text-brand-400 hover:underline text-[11px] font-medium shrink-0">
                      {t("manager.tenants.createAccess")}
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                  <p>{tenant.phone}</p>
                  <p>{tenant.email}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                  {tenant.idDocument ? (
                    <button onClick={() => openIdDocument(tenant)} className="text-brand-600 dark:text-brand-400 hover:underline">
                      {t("manager.tenants.viewIdDocumentMobile")}
                    </button>
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600">{t("manager.tenants.noIdDocument")}</span>
                  )}
                  <div className="space-x-3">
                    <button onClick={() => openEdit(tenant)} className="text-brand-600 dark:text-brand-400 hover:underline">{t("common.actions.edit")}</button>
                    <button onClick={() => handleDelete(tenant)} className="text-red-600 dark:text-red-400 hover:underline">{t("common.actions.delete")}</button>
                  </div>
                </div>
              </div>
            ))}
      </div>
      </>
      )}
    </div>
  );
}
