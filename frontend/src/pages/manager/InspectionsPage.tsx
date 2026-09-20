import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, liste } from "../../api/client";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { TableRowSkeleton } from "../../components/Skeleton";
import SignatureModal from "../../components/SignatureModal";
import type {
  Contract,
  Inspection,
  InspectionKeyEntry,
  InspectionRoom,
  PaginatedResponse,
  RoomCondition,
} from "../../types";

const PAGE_SIZE = 20;
// Pour le sélecteur de contrat du formulaire de création : liste large, non paginée.
const CONTRACTS_PAGE_SIZE = 100;

const emptyEditForm = {
  rooms: [] as InspectionRoom[],
  meters: { electricity: "", water: "", gas: "" },
  keys: [] as InspectionKeyEntry[],
  generalComments: "",
};

export default function InspectionsPage() {
  const { t, i18n } = useTranslation();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ contractId: "", type: "ENTRY" as "ENTRY" | "EXIT" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [signingInspection, setSigningInspection] = useState<Inspection | null>(null);
  const [viewingReportInspection, setViewingReportInspection] = useState<Inspection | null>(null);

  function load() {
    Promise.all([
      api.get<PaginatedResponse<Inspection>>("/inspections", { params: { page, pageSize: PAGE_SIZE } }),
      api.get<PaginatedResponse<Contract>>("/contracts", { params: { pageSize: CONTRACTS_PAGE_SIZE } }),
    ])
      .then(([inspectionsRes, contractsRes]) => {
        setInspections(liste<Inspection>(inspectionsRes.data, "items"));
        setTotal(inspectionsRes.data.total);
        setTotalPages(inspectionsRes.data.totalPages);
        setContracts(liste<Contract>(contractsRes.data, "items"));
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);

  function openCreate() {
    setCreateForm({ contractId: "", type: "ENTRY" });
    setCreateError(null);
    setShowCreateForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.post("/inspections", createForm);
      setShowCreateForm(false);
      load();
    } catch (err) {
      setCreateError(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(inspection: Inspection) {
    setEditingInspection(inspection);
    setEditForm({
      rooms: inspection.rooms,
      meters: inspection.meters,
      keys: inspection.keys,
      generalComments: inspection.generalComments || "",
    });
    setEditError(null);
  }

  function addRoom() {
    setEditForm({ ...editForm, rooms: [...editForm.rooms, { name: "", condition: "BON", notes: "" }] });
  }

  function updateRoom(index: number, patch: Partial<InspectionRoom>) {
    setEditForm({
      ...editForm,
      rooms: editForm.rooms.map((room, i) => (i === index ? { ...room, ...patch } : room)),
    });
  }

  function removeRoom(index: number) {
    setEditForm({ ...editForm, rooms: editForm.rooms.filter((_, i) => i !== index) });
  }

  function addKey() {
    setEditForm({ ...editForm, keys: [...editForm.keys, { label: "", quantity: 1 }] });
  }

  function updateKey(index: number, patch: Partial<InspectionKeyEntry>) {
    setEditForm({
      ...editForm,
      keys: editForm.keys.map((key, i) => (i === index ? { ...key, ...patch } : key)),
    });
  }

  function removeKey(index: number) {
    setEditForm({ ...editForm, keys: editForm.keys.filter((_, i) => i !== index) });
  }

  async function handleSave() {
    if (!editingInspection) return;
    setSaving(true);
    setEditError(null);
    try {
      await api.put(`/inspections/${editingInspection.id}`, editForm);
      setEditingInspection(null);
      load();
    } catch (err) {
      setEditError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!editingInspection) return;
    if (!confirm(t("manager.inspections.confirmFinalize"))) return;
    setSaving(true);
    setEditError(null);
    try {
      await api.put(`/inspections/${editingInspection.id}`, { ...editForm, status: "COMPLETED" });
      setEditingInspection(null);
      load();
    } catch (err) {
      setEditError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(inspection: Inspection) {
    if (!confirm(t("manager.inspections.confirmDelete"))) return;
    try {
      await api.delete(`/inspections/${inspection.id}`);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("manager.inspections.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.inspections.count", { count: inspections.length })}</p>
        </div>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg shadow-brand-600/20 transition-all">
          {t("manager.inspections.addBtn")}
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

      {showCreateForm && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">{t("manager.inspections.formTitle")}</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="inspection-contract" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.inspections.fields.contract")}</label>
              <select id="inspection-contract" required value={createForm.contractId} onChange={(e) => setCreateForm({ ...createForm, contractId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="">{t("manager.inspections.fields.selectContract")}</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.property?.title} — {c.tenant?.firstName} {c.tenant?.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="inspection-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t("manager.inspections.fields.type")}</label>
              <select id="inspection-type" value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as "ENTRY" | "EXIT" })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm">
                <option value="ENTRY">{t("manager.inspections.typeEntry")}</option>
                <option value="EXIT">{t("manager.inspections.typeExit")}</option>
              </select>
            </div>
            {createError && <p className="md:col-span-2 text-sm text-red-600">{createError}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={creating} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {creating ? t("common.actions.saving") : t("manager.inspections.create")}
              </button>
              <button type="button" onClick={() => setShowCreateForm(false)} className="text-sm text-slate-500 dark:text-slate-400 px-4 py-2">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingInspection && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">{t("manager.inspections.editTitle")}</h3>
            <button onClick={() => setEditingInspection(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-semibold">✕</button>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{t("manager.inspections.roomsTitle")}</h4>
            <div className="space-y-2">
              {editForm.rooms.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">{t("manager.inspections.noRooms")}</p>}
              {editForm.rooms.map((room, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_1fr_auto] gap-2 items-start bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5">
                  <input
                    placeholder={t("manager.inspections.roomName")}
                    value={room.name}
                    onChange={(e) => updateRoom(i, { name: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm"
                  />
                  <select
                    value={room.condition}
                    onChange={(e) => updateRoom(i, { condition: e.target.value as RoomCondition })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm"
                  >
                    <option value="BON">{t("manager.inspections.conditionGood")}</option>
                    <option value="MOYEN">{t("manager.inspections.conditionFair")}</option>
                    <option value="MAUVAIS">{t("manager.inspections.conditionPoor")}</option>
                  </select>
                  <input
                    placeholder={t("manager.inspections.roomNotes")}
                    value={room.notes}
                    onChange={(e) => updateRoom(i, { notes: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm"
                  />
                  <button type="button" onClick={() => removeRoom(i)} className="text-red-600 dark:text-red-400 hover:underline text-xs px-2 py-1.5">
                    {t("manager.inspections.removeRow")}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addRoom} className="mt-2 text-brand-600 dark:text-brand-400 hover:underline text-xs font-semibold">
              {t("manager.inspections.addRoom")}
            </button>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{t("manager.inspections.metersTitle")}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="meter-electricity" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t("manager.inspections.meterElectricity")}</label>
                <input id="meter-electricity" value={editForm.meters.electricity} onChange={(e) => setEditForm({ ...editForm, meters: { ...editForm.meters, electricity: e.target.value } })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label htmlFor="meter-water" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t("manager.inspections.meterWater")}</label>
                <input id="meter-water" value={editForm.meters.water} onChange={(e) => setEditForm({ ...editForm, meters: { ...editForm.meters, water: e.target.value } })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label htmlFor="meter-gas" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t("manager.inspections.meterGas")}</label>
                <input id="meter-gas" value={editForm.meters.gas} onChange={(e) => setEditForm({ ...editForm, meters: { ...editForm.meters, gas: e.target.value } })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm" />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{t("manager.inspections.keysTitle")}</h4>
            <div className="space-y-2">
              {editForm.keys.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">{t("manager.inspections.noKeys")}</p>}
              {editForm.keys.map((key, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_auto] gap-2 items-start bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5">
                  <input
                    placeholder={t("manager.inspections.keyLabel")}
                    value={key.label}
                    onChange={(e) => updateKey(i, { label: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder={t("manager.inspections.keyQuantity")}
                    value={key.quantity}
                    onChange={(e) => updateKey(i, { quantity: Number(e.target.value) })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5 text-sm"
                  />
                  <button type="button" onClick={() => removeKey(i)} className="text-red-600 dark:text-red-400 hover:underline text-xs px-2 py-1.5">
                    {t("manager.inspections.removeRow")}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addKey} className="mt-2 text-brand-600 dark:text-brand-400 hover:underline text-xs font-semibold">
              {t("manager.inspections.addKey")}
            </button>
          </div>

          <div>
            <label htmlFor="inspection-comments" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{t("manager.inspections.generalComments")}</label>
            <textarea
              id="inspection-comments"
              rows={3}
              value={editForm.generalComments}
              onChange={(e) => setEditForm({ ...editForm, generalComments: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
            />
          </div>

          {editError && <p className="text-sm text-red-600">{editError}</p>}

          <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={handleSave} disabled={saving} className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {saving ? t("common.actions.saving") : t("common.actions.save")}
            </button>
            <button type="button" onClick={handleFinalize} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {t("manager.inspections.finalize")}
            </button>
            <button type="button" onClick={() => setEditingInspection(null)} className="text-sm text-slate-500 dark:text-slate-400 px-4 py-2">
              {t("common.actions.cancel")}
            </button>
          </div>
        </div>
      )}

      {!loading && inspections.length === 0 && !showCreateForm ? (
        <EmptyState
          icon="🔑"
          title={t("manager.inspections.emptyTitle")}
          description={t("manager.inspections.emptyDesc")}
          action={{ label: t("manager.inspections.addBtn"), onClick: openCreate }}
        />
      ) : (
      <>
      <div className="hidden sm:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t("manager.inspections.table.property")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.inspections.table.tenant")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.inspections.table.type")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.inspections.table.date")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.inspections.table.status")}</th>
              <th className="px-4 py-3 font-medium">{t("manager.inspections.table.signatures")}</th>
              <th className="px-4 py-3 font-medium text-right">{t("manager.inspections.table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} columns={7} />)
            ) : (
            inspections.map((insp) => (
              <tr key={insp.id}>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{insp.property?.title}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{insp.tenant?.firstName} {insp.tenant?.lastName}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{insp.type === "ENTRY" ? t("manager.inspections.typeEntry") : t("manager.inspections.typeExit")}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{new Date(insp.inspectionDate).toLocaleDateString(i18n.language)}</td>
                <td className="px-4 py-3"><Badge status={insp.status} /></td>
                <td className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{t("manager.inspections.agency")}</span>
                    {insp.signedByManagerAt ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✅ {t("manager.inspections.signed")}</span>
                    ) : insp.status === "COMPLETED" ? (
                      <button onClick={() => setSigningInspection(insp)} className="text-brand-600 dark:text-brand-400 font-semibold hover:underline">
                        ✍️ {t("manager.inspections.sign")}
                      </button>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{t("manager.inspections.tenantLabel")}</span>
                    {insp.signedByTenantAt ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✅ {t("manager.inspections.signed")}</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">⏳ {t("manager.inspections.pendingSignature")}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  {insp.status === "DRAFT" && (
                    <button onClick={() => openEdit(insp)} className="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-lg transition-colors">
                      {t("manager.inspections.edit")}
                    </button>
                  )}
                  {insp.status === "COMPLETED" && (
                    <button onClick={() => setViewingReportInspection(insp)} className="text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg transition-colors">
                      {t("manager.inspections.viewReport")}
                    </button>
                  )}
                  {insp.status === "DRAFT" && (
                    <button onClick={() => handleDelete(insp)} className="text-red-600 dark:text-red-400 hover:underline text-xs">
                      {t("common.actions.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden space-y-3">
        {inspections.map((insp) => (
          <div key={insp.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{insp.property?.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{insp.tenant?.firstName} {insp.tenant?.lastName}</p>
              </div>
              <Badge status={insp.status} />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{insp.type === "ENTRY" ? t("manager.inspections.typeEntry") : t("manager.inspections.typeExit")}</span>
              <span>{new Date(insp.inspectionDate).toLocaleDateString(i18n.language)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {insp.status === "DRAFT" && (
                <button onClick={() => openEdit(insp)} className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-lg">
                  {t("manager.inspections.edit")}
                </button>
              )}
              {insp.status === "COMPLETED" && !insp.signedByManagerAt && (
                <button onClick={() => setSigningInspection(insp)} className="text-xs bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg">
                  ✍️ {t("manager.inspections.sign")}
                </button>
              )}
              {insp.status === "COMPLETED" && (
                <button onClick={() => setViewingReportInspection(insp)} className="text-xs bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium px-2.5 py-1 rounded-lg">
                  {t("manager.inspections.viewReport")}
                </button>
              )}
              {insp.status === "DRAFT" && (
                <button onClick={() => handleDelete(insp)} className="text-red-600 dark:text-red-400 hover:underline text-xs">
                  {t("common.actions.delete")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </>
      )}

      {signingInspection && (
        <SignatureModal
          signUrl={`/inspections/${signingInspection.id}/sign`}
          title={t("manager.inspections.title") + " - " + (signingInspection.property?.title || "")}
          onSuccess={() => {
            setSigningInspection(null);
            load();
          }}
          onClose={() => setSigningInspection(null)}
        />
      )}

      {viewingReportInspection && (
        <DocumentModal
          title={t("manager.inspections.title") + " - " + (viewingReportInspection.property?.title || "")}
          docUrl={`/documents/inspection/${viewingReportInspection.id}`}
          onClose={() => setViewingReportInspection(null)}
        />
      )}
    </div>
  );
}
