import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, liste } from "../../api/client";
import ChampTelephone from "../../components/ChampTelephone";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { Skeleton, TableRowSkeleton } from "../../components/Skeleton";
import type { Owner, PaginatedResponse } from "../../types";
import Bulle from "../../components/Bulle";

const emptyForm = {
  civility: "",
  firstName: "",
  lastName: "",
  companyName: "",
  phone: "",
  email: "",
  address: "",
  iban: "",
  bic: "",
  managementFeeRate: "8",
  notes: "",
};
const PAGE_SIZE = 20;

export default function OwnersPage() {
  const { t } = useTranslation();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Owner | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviting, setInvitingId] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<{ ownerId: string; text: string } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  function load() {
    api
      .get<PaginatedResponse<Owner>>("/owners", { params: { page, pageSize: PAGE_SIZE } })
      .then((res) => {
        setOwners(liste<Owner>(res.data, "items"));
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(owner: Owner) {
    setEditing(owner);
    setForm({
      firstName: owner.firstName,
      lastName: owner.lastName,
      companyName: owner.companyName ?? "",
      phone: owner.phone,
      civility: owner.civility ?? "",
      email: owner.email,
      address: owner.address ?? "",
      iban: owner.iban ?? "",
      bic: owner.bic ?? "",
      managementFeeRate: String(owner.managementFeeRate),
      notes: owner.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        // `undefined` et non `""` : la civilité est facultative, et le serveur
        // n'accepte que « M », « MME » ou l'absence du champ.
        civility: form.civility || undefined,
        firstName: form.firstName,
        lastName: form.lastName,
        companyName: form.companyName || undefined,
        phone: form.phone,
        email: form.email,
        address: form.address || undefined,
        iban: form.iban || undefined,
        bic: form.bic || undefined,
        managementFeeRate: form.managementFeeRate,
        notes: form.notes || undefined,
      };

      if (editing) {
        await api.put(`/owners/${editing.id}`, body);
      } else {
        await api.post("/owners", body);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(owner: Owner) {
    if (!confirm(t("manager.owners.confirmDelete", { name: `${owner.firstName} ${owner.lastName}` }))) return;
    try {
      await api.delete(`/owners/${owner.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  async function handleInvite(owner: Owner) {
    setInvitingId(owner.id);
    setInviteMsg(null);
    try {
      await api.post(`/owners/${owner.id}/invite`);
      setInviteMsg({ ownerId: owner.id, text: t("manager.owners.inviteSuccess") });
      load();
    } catch (err) {
      setInviteMsg({ ownerId: owner.id, text: apiErrorMessage(err) });
    } finally {
      setInvitingId(null);
    }
  }

  function portalStatusLabel(owner: Owner) {
    if (owner.portalStatus === "ACTIVE") return t("manager.owners.portalActive");
    if (owner.portalStatus === "PENDING") return t("manager.owners.portalPending");
    return t("manager.owners.portalNone");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.owners.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.owners.count", { count: owners.length })}</p>
        </div>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-brand-600/20 transition-all">
          {t("manager.owners.addBtn")}
        </button>
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
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">{editing ? t("manager.owners.formTitleEdit") : t("manager.owners.formTitleNew")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="owner-civility" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("common.civility.label")}</label>
              <select id="owner-civility" value={form.civility} onChange={(e) => setForm({ ...form, civility: e.target.value })} className="w-full md:w-56 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{t("common.civility.none")}</option>
                <option value="M">{t("common.civility.M")}</option>
                <option value="MME">{t("common.civility.MME")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="owner-firstName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.firstName")}</label>
              <input id="owner-firstName" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="owner-lastName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.lastName")}</label>
              <input id="owner-lastName" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-companyName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.companyName")}</label>
              <input id="owner-companyName" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="owner-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.phone")}</label>
              <ChampTelephone id="owner-phone" required value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
            <div>
              <label htmlFor="owner-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.email")}</label>
              <input id="owner-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-address" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.address")}</label>
              <input id="owner-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="owner-iban" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.iban")}</label>
              <input id="owner-iban" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="owner-bic" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.bic")}</label>
              <input id="owner-bic" value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="owner-managementFeeRate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.managementFeeRate")}</label>
              <input id="owner-managementFeeRate" required type="number" step="0.1" min="0" max="100" value={form.managementFeeRate} onChange={(e) => setForm({ ...form, managementFeeRate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="owner-notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.owners.fields.notes")}</label>
              <textarea id="owner-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm" />
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

      {!loading && owners.length === 0 && !showForm ? (
        <EmptyState
          icon="🧑‍💼"
          title={t("manager.owners.emptyTitle")}
          description={t("manager.owners.emptyDesc")}
          action={{ label: t("manager.owners.addBtn"), onClick: openCreate }}
        />
      ) : (
      <>
      {/* Vue tableau (écrans sm et plus) */}
      <div className="hidden sm:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.owners.table.name")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.owners.table.phone")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.owners.table.email")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.owners.table.feeRate")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.owners.table.portal")}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} columns={6} />)
            ) : (
            owners.map((owner) => (
              <tr key={owner.id}>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                  {owner.firstName} {owner.lastName}
                  {owner.companyName && <span className="block text-xs font-normal text-slate-400 dark:text-slate-500">{owner.companyName}</span>}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{owner.phone}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{owner.email}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{owner.managementFeeRate}%</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span
                      className={`text-xs ${
                        owner.portalStatus === "ACTIVE"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : owner.portalStatus === "PENDING"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {portalStatusLabel(owner)}
                    </span>
                    {owner.portalStatus !== "ACTIVE" && (
                      <Bulle texte={t("manager.tips.ownerInvite")}>
                      <button
                        onClick={() => handleInvite(owner)}
                        disabled={inviting === owner.id}
                        className="text-brand-600 dark:text-brand-400 hover:underline text-xs text-left disabled:opacity-60"
                      >
                        {owner.portalStatus === "PENDING" ? t("manager.owners.resendInvite") : t("manager.owners.invite")}
                      </button>
                      </Bulle>
                    )}
                    {inviteMsg?.ownerId === owner.id && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{inviteMsg.text}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <Link to={`/proprietaires/${owner.id}/crg`} className="text-brand-600 dark:text-brand-400 hover:underline text-xs">{t("manager.owners.viewCrg")}</Link>
                  <Bulle texte={t("manager.tips.ownerEdit")}><button onClick={() => openEdit(owner)} className="text-brand-600 dark:text-brand-400 hover:underline text-xs">{t("common.actions.edit")}</button></Bulle>
                  <Bulle texte={t("manager.tips.ownerDelete")}><button onClick={() => handleDelete(owner)} className="text-red-600 dark:text-red-400 hover:underline text-xs">{t("common.actions.delete")}</button></Bulle>
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
          : owners.map((owner) => (
              <div key={owner.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{owner.firstName} {owner.lastName}</p>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">{owner.managementFeeRate}%</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                  <p>{owner.phone}</p>
                  <p>{owner.email}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={
                        owner.portalStatus === "ACTIVE"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : owner.portalStatus === "PENDING"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-slate-400 dark:text-slate-500"
                      }
                    >
                      {portalStatusLabel(owner)}
                    </span>
                    {owner.portalStatus !== "ACTIVE" && (
                      <Bulle texte={t("manager.tips.ownerInvite")}>
                      <button onClick={() => handleInvite(owner)} disabled={inviting === owner.id} className="text-brand-600 dark:text-brand-400 hover:underline text-left disabled:opacity-60">
                        {owner.portalStatus === "PENDING" ? t("manager.owners.resendInvite") : t("manager.owners.invite")}
                      </button>
                      </Bulle>
                    )}
                  </div>
                  <div className="space-x-3">
                    <Link to={`/proprietaires/${owner.id}/crg`} className="text-brand-600 dark:text-brand-400 hover:underline">{t("manager.owners.viewCrg")}</Link>
                    <Bulle texte={t("manager.tips.ownerEdit")}><button onClick={() => openEdit(owner)} className="text-brand-600 dark:text-brand-400 hover:underline">{t("common.actions.edit")}</button></Bulle>
                    <Bulle texte={t("manager.tips.ownerDelete")}><button onClick={() => handleDelete(owner)} className="text-red-600 dark:text-red-400 hover:underline">{t("common.actions.delete")}</button></Bulle>
                  </div>
                </div>
                {inviteMsg?.ownerId === owner.id && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{inviteMsg.text}</p>
                )}
              </div>
            ))}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </>
      )}
    </div>
  );
}
