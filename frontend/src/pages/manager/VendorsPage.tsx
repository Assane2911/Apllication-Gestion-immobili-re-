import { HardHat, Mail, Pencil, Phone, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import ChampTelephone from "../../components/ChampTelephone";
import EmptyState from "../../components/EmptyState";
import Initiales from "../../components/Initiales";
import { Skeleton } from "../../components/Skeleton";
import type { Vendor } from "../../types";
import Bulle from "../../components/Bulle";

const emptyForm = { name: "", trade: "", phone: "", email: "", notes: "" };

export default function VendorsPage() {
  const { t, i18n } = useTranslation();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [metier, setMetier] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");

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

  // Carnet classé par ordre alphabétique ; les métiers présents servent d'onglets, avec leur effectif.
  const tries = useMemo(() => [...vendors].sort((a, b) => a.name.localeCompare(b.name, i18n.language)), [vendors, i18n.language]);
  const metiers = useMemo(() => {
    const effectifs = new Map<string, number>();
    for (const v of vendors) {
      const m = v.trade?.trim();
      if (m) effectifs.set(m, (effectifs.get(m) ?? 0) + 1);
    }
    return [...effectifs.entries()].sort((a, b) => a[0].localeCompare(b[0], i18n.language));
  }, [vendors, i18n.language]);
  // Un métier qui n'existe plus (dernier prestataire supprimé ou renommé) ne doit pas laisser une liste vide.
  const metierActif = metier && metiers.some(([m]) => m === metier) ? metier : null;
  const termes = recherche.trim().toLocaleLowerCase(i18n.language);
  const visibles = tries.filter(
    (v) =>
      (!metierActif || v.trade?.trim() === metierActif) &&
      (!termes || [v.name, v.trade, v.phone, v.email].some((c) => c?.toLocaleLowerCase(i18n.language).includes(termes)))
  );
  const lienContact = "border-b border-ink-900/40 text-slate-900 hover:border-orange-700 hover:text-orange-700";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.vendors.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.vendors.count", { count: vendors.length })}</p>
        </div>
        <Bulle texte={t("manager.tips.vendorCreate")}>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition-colors">
          {t("manager.vendors.addBtn")}
        </button>
        </Bulle>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={load} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl border border-contour-200 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 mb-4">{editing ? t("manager.vendors.formTitleEdit") : t("manager.vendors.formTitleNew")}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vendor-name" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.vendors.fields.name")}</label>
              <input id="vendor-name" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="vendor-trade" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.vendors.fields.trade")}</label>
              <input id="vendor-trade" maxLength={100} value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder={t("manager.vendors.fields.tradePlaceholder")} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="vendor-phone" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.vendors.fields.phone")}</label>
              <ChampTelephone id="vendor-phone" required value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            </div>
            <div>
              <label htmlFor="vendor-email" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.vendors.fields.email")}</label>
              <input id="vendor-email" type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="vendor-notes" className="block text-sm font-medium text-slate-700 mb-1">{t("manager.vendors.fields.notes")}</label>
              <textarea id="vendor-notes" maxLength={5000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            {error && <p role="alert" className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {saving ? t("common.actions.saving") : t("common.actions.save")}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-600 px-4 py-2">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {!loading && vendors.length > 0 && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label={t("manager.vendors.filters.byTrade")} className="flex flex-wrap border border-slate-400 bg-white sm:inline-flex">
            <button
              type="button"
              aria-pressed={metierActif === null}
              onClick={() => setMetier(null)}
              className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors sm:flex-none ${
                metierActif === null ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              {t("manager.vendors.filters.all")} <span className="opacity-70">{vendors.length}</span>
            </button>
            {metiers.map(([m, n]) => (
              <button
                key={m}
                type="button"
                aria-pressed={metierActif === m}
                onClick={() => setMetier(m)}
                className={`flex-1 cursor-pointer whitespace-nowrap border-r border-slate-400 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                  metierActif === m ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                {m} <span className="opacity-70">{n}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full lg:w-72">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              aria-label={t("manager.vendors.filters.search")}
              placeholder={t("manager.vendors.filters.search")}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="w-full border border-slate-400 bg-white py-2 pl-9 pr-3 text-xs text-slate-900"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3 border border-slate-300 bg-white p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
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
      ) : visibles.length === 0 && vendors.length > 0 ? (
        <p className="border border-slate-300 bg-white py-12 text-center text-sm text-slate-600">{t("manager.vendors.filters.noMatch")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((vendor, rang) => (
            <article key={vendor.id} className="group flex flex-col justify-between border border-slate-300 bg-white transition-colors hover:border-ink-900">
              <div>
                <div className="flex items-start gap-3 p-4">
                  <Initiales prenom={vendor.name.split(/\s+/)[0]} nom={vendor.name.split(/\s+/)[1]} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold leading-snug text-slate-900">{vendor.name}</h3>
                    {vendor.trade ? (
                      <span className="mt-1 inline-block border border-orange-700/50 bg-orange-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-800">
                        {vendor.trade}
                      </span>
                    ) : null}
                  </div>
                  <span aria-hidden="true" className="font-mono text-[10px] text-slate-500">
                    {String(rang + 1).padStart(2, "0")}
                  </span>
                </div>
                <ul className="space-y-2 border-t border-slate-300 px-4 py-3 text-xs">
                  <li className="flex items-center gap-2">
                    <Phone size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                    <a href={`tel:${vendor.phone.replace(/\s+/g, "")}`} className={`font-mono ${lienContact}`}>
                      {vendor.phone}
                    </a>
                  </li>
                  <li className="flex items-center gap-2">
                    <Mail size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                    {vendor.email ? (
                      <a href={`mailto:${vendor.email}`} className={`min-w-0 truncate font-mono ${lienContact}`}>
                        {vendor.email}
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </li>
                </ul>
                {vendor.notes && (
                  <p className="mx-4 mb-4 line-clamp-3 border-l-2 border-orange-700 pl-3 text-xs leading-relaxed text-slate-700">{vendor.notes}</p>
                )}
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-300 border-t border-slate-300 text-xs font-semibold">
                <Bulle texte={t("manager.tips.vendorEdit")} className="block">
                  <button
                    onClick={() => openEdit(vendor)}
                    className="flex w-full cursor-pointer items-center justify-center gap-1.5 py-2.5 text-slate-700 transition-colors hover:bg-slate-100 hover:text-ink-900"
                  >
                    <Pencil size={13} aria-hidden="true" />
                    {t("common.actions.edit")}
                  </button>
                </Bulle>
                <Bulle texte={t("manager.tips.vendorDelete")} className="block">
                  <button
                    onClick={() => handleDelete(vendor)}
                    className="flex w-full cursor-pointer items-center justify-center gap-1.5 py-2.5 text-rose-700 transition-colors hover:bg-rose-50"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {t("common.actions.delete")}
                  </button>
                </Bulle>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
