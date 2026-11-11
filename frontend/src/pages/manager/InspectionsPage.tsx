import { CheckCircle2, Hourglass, KeyRound, PenLine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../../api/client";
import BandeauChiffres from "../../components/BandeauChiffres";
import BarreListe from "../../components/BarreListe";
import SectionReglage from "../../components/SectionReglage";
import Badge from "../../components/Badge";
import DocumentModal from "../../components/DocumentModal";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import { TableRowSkeleton } from "../../components/Skeleton";
import Bulle from "../../components/Bulle";
import ComparaisonEdlModal from "../../components/ComparaisonEdlModal";
import DepositRefundModal from "../../components/DepositRefundModal";
import SignatureModal from "../../components/SignatureModal";
import type {
  Contract,
  Inspection,
  InspectionKeyEntry,
  InspectionRoom,
  PaginatedResponse,
  RoomCondition,
} from "../../types";
import { formaterJour } from "../../utils/jourCivil";
import { NomDuBien } from "../../components/PlanLogement";
import { correspond } from "../../utils/recherche";
import { etatEdl, PIECES_TYPES, resumePieces, syntheseEdl, type EtatEdl } from "../../utils/syntheseExploitation";

// Sous ce nombre d'états des lieux, la recherche et les filtres n'apportent rien : la barre d'outils reste cachée.
const SEUIL_OUTILS = 4;
const CHAMP = "w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const CHAMP_COMPACT = "border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900";
const LIBELLE = "mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";
const BOUTON_PLEIN = "cursor-pointer bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60";
const BOUTON_TRAIT = "cursor-pointer border border-slate-400 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:opacity-60";
const ACTION = "inline-flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 text-xs font-semibold transition-colors";
const ACTION_TRAIT = `${ACTION} border-slate-400 bg-white text-slate-800 hover:border-ink-900 hover:bg-slate-100`;
const ACTION_ENCRE = `${ACTION} border-ink-900 bg-white text-ink-900 hover:bg-slate-100`;
const FILET_ETAT = { BON: "border-l-ink-900", MOYEN: "border-l-orange-300", MAUVAIS: "border-l-orange-700" } as const;
type Filtre = "all" | EtatEdl;

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
  const [comparingInspection, setComparingInspection] = useState<Inspection | null>(null);
  const [refundContract, setRefundContract] = useState<Contract | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("all");

  function load(signal?: AbortSignal) {
    Promise.all([
      api.get<PaginatedResponse<Inspection>>("/inspections", { params: { page, pageSize: PAGE_SIZE }, signal }),
      api.get<PaginatedResponse<Contract>>("/contracts", { params: { pageSize: CONTRACTS_PAGE_SIZE }, signal }),
    ])
      .then(([inspectionsRes, contractsRes]) => {
        setInspections(liste<Inspection>(inspectionsRes.data, "items"));
        setTotal(inspectionsRes.data.total);
        setTotalPages(inspectionsRes.data.totalPages);
        setContracts(liste<Contract>(contractsRes.data, "items"));
        setLoadError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setLoadError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [page]);

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

  function addTypicalRoom(cle: (typeof PIECES_TYPES)[number]) {
    if (editForm.rooms.length >= 100) return;
    setEditForm({ ...editForm, rooms: [...editForm.rooms, { name: t(`manager.inspections.quickRooms.names.${cle}`), condition: "BON", notes: "" }] });
  }

  function allRoomsGood() {
    setEditForm({ ...editForm, rooms: editForm.rooms.map((room) => ({ ...room, condition: "BON" as RoomCondition })) });
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

  const bailAComparer = comparingInspection ? contracts.find((c) => c.id === comparingInspection.contractId) : undefined;
  const synthese = syntheseEdl(inspections);
  const pieces = resumePieces(editForm.rooms);
  const visibles = inspections.filter((i) => (filtre === "all" || etatEdl(i) === filtre) && correspond(recherche, i.property?.title, i.tenant?.firstName, i.tenant?.lastName));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.inspections.title")}</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-600">{t("manager.inspections.count", { count: inspections.length })}</p>
        </div>
        <button onClick={openCreate} className={BOUTON_PLEIN}>
          {t("manager.inspections.addBtn")}
        </button>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {showCreateForm && (
        <SectionReglage id="nouvel-edl" numero="01" titre={t("manager.inspections.formTitle")}>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="inspection-contract" className={LIBELLE}>{t("manager.inspections.fields.contract")}</label>
              <select id="inspection-contract" required value={createForm.contractId} onChange={(e) => setCreateForm({ ...createForm, contractId: e.target.value })} className={CHAMP}>
                <option value="">{t("manager.inspections.fields.selectContract")}</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.property?.title} — {c.tenant?.firstName} {c.tenant?.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="inspection-type" className={LIBELLE}>{t("manager.inspections.fields.type")}</label>
              <select id="inspection-type" value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as "ENTRY" | "EXIT" })} className={CHAMP}>
                <option value="ENTRY">{t("manager.inspections.typeEntry")}</option>
                <option value="EXIT">{t("manager.inspections.typeExit")}</option>
              </select>
            </div>
            {createError && <p role="alert" className="md:col-span-2 text-sm text-red-600">{createError}</p>}
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" disabled={creating} className={BOUTON_PLEIN}>
                {creating ? t("common.actions.saving") : t("manager.inspections.create")}
              </button>
              <button type="button" onClick={() => setShowCreateForm(false)} className="cursor-pointer px-4 py-2 text-sm text-slate-600 hover:text-ink-900">
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </SectionReglage>
      )}

      {editingInspection && (
        <SectionReglage id="edition-edl" numero="02" titre={t("manager.inspections.editTitle")}>
        <div className="space-y-5">
          <div className="flex justify-end">
            <button
              onClick={() => setEditingInspection(null)}
              className="cursor-pointer text-slate-500 hover:text-ink-900"
              aria-label={t("common.actions.close")}
            >
              <X size={18} />
            </button>
          </div>

          <div>
            <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900">{t("manager.inspections.roomsTitle")}</h4>
            <div className="space-y-2">
              {editForm.rooms.length === 0 && <p className="text-xs text-slate-600">{t("manager.inspections.noRooms")}</p>}
              {editForm.rooms.map((room, i) => (
                <div key={i} className={`grid grid-cols-1 items-start gap-2 border border-l-4 border-slate-300 bg-slate-50 p-2.5 sm:grid-cols-[1fr_140px_1fr_auto] ${FILET_ETAT[room.condition]}`}>
                  <input
                    aria-label={t("manager.inspections.roomName")}
                    placeholder={t("manager.inspections.roomName")}
                    value={room.name}
                    maxLength={200}
                    onChange={(e) => updateRoom(i, { name: e.target.value })}
                    className={CHAMP_COMPACT}
                  />
                  <select
                    aria-label={t("manager.inspections.roomCondition")}
                    value={room.condition}
                    onChange={(e) => updateRoom(i, { condition: e.target.value as RoomCondition })}
                    className={CHAMP_COMPACT}
                  >
                    <option value="BON">{t("manager.inspections.conditionGood")}</option>
                    <option value="MOYEN">{t("manager.inspections.conditionFair")}</option>
                    <option value="MAUVAIS">{t("manager.inspections.conditionPoor")}</option>
                  </select>
                  <input
                    aria-label={t("manager.inspections.roomNotes")}
                    placeholder={t("manager.inspections.roomNotes")}
                    value={room.notes}
                    maxLength={2000}
                    onChange={(e) => updateRoom(i, { notes: e.target.value })}
                    className={CHAMP_COMPACT}
                  />
                  <button type="button" onClick={() => removeRoom(i)} className="text-xs font-semibold text-rose-700 border-b border-rose-700/40 hover:border-rose-700 transition-colors px-2 py-1.5">
                    {t("manager.inspections.removeRow")}
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={addRoom} disabled={editForm.rooms.length >= 100} className="cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 disabled:opacity-50">
                {t("manager.inspections.addRoom")}
              </button>
              <span aria-hidden="true" className="text-slate-400">|</span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.inspections.quickRooms.label")}</span>
              {PIECES_TYPES.map((cle) => (
                <button
                  key={cle}
                  type="button"
                  onClick={() => addTypicalRoom(cle)}
                  disabled={editForm.rooms.length >= 100}
                  className="cursor-pointer border border-slate-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:opacity-50"
                >
                  {t(`manager.inspections.quickRooms.names.${cle}`)}
                </button>
              ))}
            </div>
            {editForm.rooms.length > 0 && (
              <p className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-700">
                {t("manager.inspections.quickRooms.summary", { good: pieces.bon, fair: pieces.moyen, poor: pieces.mauvais })}
                <button type="button" onClick={allRoomsGood} className="cursor-pointer border-b border-ink-900/40 font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
                  {t("manager.inspections.quickRooms.allGood")}
                </button>
              </p>
            )}
          </div>

          <div>
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 mb-2">{t("manager.inspections.metersTitle")}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="meter-electricity" className={LIBELLE}>{t("manager.inspections.meterElectricity")}</label>
                <input id="meter-electricity" maxLength={100} value={editForm.meters.electricity} onChange={(e) => setEditForm({ ...editForm, meters: { ...editForm.meters, electricity: e.target.value } })} className={`${CHAMP_COMPACT} w-full`} />
              </div>
              <div>
                <label htmlFor="meter-water" className={LIBELLE}>{t("manager.inspections.meterWater")}</label>
                <input id="meter-water" maxLength={100} value={editForm.meters.water} onChange={(e) => setEditForm({ ...editForm, meters: { ...editForm.meters, water: e.target.value } })} className={`${CHAMP_COMPACT} w-full`} />
              </div>
              <div>
                <label htmlFor="meter-gas" className={LIBELLE}>{t("manager.inspections.meterGas")}</label>
                <input id="meter-gas" maxLength={100} value={editForm.meters.gas} onChange={(e) => setEditForm({ ...editForm, meters: { ...editForm.meters, gas: e.target.value } })} className={`${CHAMP_COMPACT} w-full`} />
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 mb-2">{t("manager.inspections.keysTitle")}</h4>
            <div className="space-y-2">
              {editForm.keys.length === 0 && <p className="text-xs text-slate-600">{t("manager.inspections.noKeys")}</p>}
              {editForm.keys.map((key, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_auto] gap-2 items-start bg-slate-50 border border-slate-300 p-2.5">
                  <input
                    aria-label={t("manager.inspections.keyLabel")}
                    placeholder={t("manager.inspections.keyLabel")}
                    value={key.label}
                    maxLength={200}
                    onChange={(e) => updateKey(i, { label: e.target.value })}
                    className={CHAMP_COMPACT}
                  />
                  <input
                    aria-label={t("manager.inspections.keyQuantity")}
                    type="number"
                    min={0}
                    max={1000}
                    placeholder={t("manager.inspections.keyQuantity")}
                    value={key.quantity}
                    onChange={(e) => updateKey(i, { quantity: Number(e.target.value) })}
                    className={CHAMP_COMPACT}
                  />
                  <button type="button" onClick={() => removeKey(i)} className="text-xs font-semibold text-rose-700 border-b border-rose-700/40 hover:border-rose-700 transition-colors px-2 py-1.5">
                    {t("manager.inspections.removeRow")}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addKey} disabled={editForm.keys.length >= 50} className="mt-2 cursor-pointer border-b border-ink-900/40 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700 disabled:opacity-50">
              {t("manager.inspections.addKey")}
            </button>
          </div>

          <div>
            <label htmlFor="inspection-comments" className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 mb-2">{t("manager.inspections.generalComments")}</label>
            <textarea
              id="inspection-comments"
              rows={3}
              value={editForm.generalComments}
              maxLength={20000}
              onChange={(e) => setEditForm({ ...editForm, generalComments: e.target.value })}
              className={CHAMP}
            />
          </div>

          {editError && <p role="alert" className="text-sm text-red-600">{editError}</p>}

          <div className="flex gap-2 border-t border-slate-200 pt-3">
            <Bulle texte={t("manager.tips.inspectionSave")}>
            <button type="button" onClick={handleSave} disabled={saving} className={BOUTON_TRAIT}>
              {saving ? t("common.actions.saving") : t("common.actions.save")}
            </button>
            </Bulle>
            <button type="button" onClick={handleFinalize} disabled={saving} className={BOUTON_PLEIN}>
              {t("manager.inspections.finalize")}
            </button>
            <button type="button" onClick={() => setEditingInspection(null)} className="cursor-pointer px-4 py-2 text-sm text-slate-600 hover:text-ink-900">
              {t("common.actions.cancel")}
            </button>
          </div>
        </div>
        </SectionReglage>
      )}

      {!loading && inspections.length > 0 && (
        <BandeauChiffres
          etiquette={t("manager.inspections.summary.label")}
          cases={[
            { libelle: t("manager.inspections.summary.drafts"), valeur: synthese.brouillons, aide: t("manager.inspections.summary.draftsHint") },
            { libelle: t("manager.inspections.summary.toSign"), valeur: synthese.aSigner, aide: t("manager.inspections.summary.toSignHint"), ton: synthese.aSigner > 0 ? "alerte" : "normal" },
            { libelle: t("manager.inspections.summary.signed"), valeur: synthese.signes, aide: t("manager.inspections.summary.signedHint") },
            { libelle: t("manager.inspections.summary.types"), valeur: `${synthese.entrees} / ${synthese.sorties}`, aide: t("manager.inspections.summary.typesHint") },
          ]}
        />
      )}

      {!loading && inspections.length >= SEUIL_OUTILS && (
        <>
          <BarreListe
            idPrefixe="edl"
            recherche={recherche}
            onRecherche={setRecherche}
            placeholderRecherche={t("manager.inspections.search")}
            libelleFiltres={t("manager.inspections.filtersLabel")}
            filtres={[
              { cle: "all", libelle: t("manager.liste.all"), compte: inspections.length },
              { cle: "draft", libelle: t("manager.inspections.filters.draft"), compte: synthese.brouillons },
              { cle: "toSign", libelle: t("manager.inspections.filters.toSign"), compte: synthese.aSigner },
              { cle: "signed", libelle: t("manager.inspections.filters.signed"), compte: synthese.signes },
            ]}
            filtreActif={filtre}
            onFiltre={(cle) => setFiltre(cle as Filtre)}
          />
          <p aria-live="polite" className="font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {t(totalPages > 1 ? "manager.liste.shownOnPage" : "manager.liste.shown", { shown: visibles.length, total: inspections.length })}
          </p>
        </>
      )}

      {!loading && inspections.length === 0 && !showCreateForm ? (
        <EmptyState
          icon={KeyRound}
          title={t("manager.inspections.emptyTitle")}
          description={t("manager.inspections.emptyDesc")}
          action={{ label: t("manager.inspections.addBtn"), onClick: openCreate }}
        />
      ) : (
      <>
      <div className="relative hidden overflow-x-auto border border-slate-300 bg-white sm:block">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("manager.inspections.table.property")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.inspections.table.tenant")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.inspections.table.type")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.inspections.table.date")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.inspections.table.status")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager.inspections.table.signatures")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("manager.inspections.table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} columns={7} />)
            ) : (
            visibles.map((insp) => (
              <tr key={insp.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900"><NomDuBien titre={insp.property?.title} id={insp.property?.id} /></td>
                <td className="px-4 py-3 text-slate-600">{insp.tenant?.firstName} {insp.tenant?.lastName}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block whitespace-nowrap border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${insp.type === "ENTRY" ? "border-ink-900 bg-white text-ink-900" : "border-orange-300 bg-orange-50 text-orange-900"}`}>
                    {insp.type === "ENTRY" ? t("manager.inspections.typeEntry") : t("manager.inspections.typeExit")}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap tabular-nums">{formaterJour(insp.inspectionDate, i18n.language)}</td>
                <td className="px-4 py-3"><Badge status={insp.status} /></td>
                <td className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-600">{t("manager.inspections.agency")}</span>
                    {insp.signedByManagerAt ? (
                      <span className="text-ink-900 font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 size={13} aria-hidden="true" /> {t("manager.inspections.signed")}
                      </span>
                    ) : insp.status === "COMPLETED" ? (
                      <Bulle texte={t("manager.tips.inspectionSign")}>
                      <button onClick={() => setSigningInspection(insp)} className="font-semibold text-ink-900 border-b border-ink-900/40 hover:border-orange-700 hover:text-orange-700 transition-colors inline-flex items-center gap-1">
                        <PenLine size={13} aria-hidden="true" /> {t("manager.inspections.sign")}
                      </button>
                      </Bulle>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-600">{t("manager.inspections.tenantLabel")}</span>
                    {insp.signedByTenantAt ? (
                      <span className="text-ink-900 font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 size={13} aria-hidden="true" /> {t("manager.inspections.signed")}
                      </span>
                    ) : (
                      <span className="text-orange-800 inline-flex items-center gap-1">
                        <Hourglass size={12} aria-hidden="true" /> {t("manager.inspections.pendingSignature")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap [&>*]:ml-2">
                  {insp.status === "DRAFT" && (
                    <Bulle texte={t("manager.tips.inspectionEdit")}>
                    <button onClick={() => openEdit(insp)} className={ACTION_TRAIT}>
                      {t("manager.inspections.edit")}
                    </button>
                    </Bulle>
                  )}
                  {insp.status === "COMPLETED" && (
                    <Bulle texte={t("manager.tips.inspectionView")}>
                    <button onClick={() => setViewingReportInspection(insp)} className={ACTION_ENCRE}>
                      {t("manager.inspections.viewReport")}
                    </button>
                    </Bulle>
                  )}
                  {insp.status === "COMPLETED" && insp.type === "EXIT" && (
                    <button onClick={() => setComparingInspection(insp)} className={ACTION_TRAIT}>
                      {t("manager.inspections.compare.button")}
                    </button>
                  )}
                  {insp.status === "DRAFT" && (
                    <Bulle texte={t("manager.tips.inspectionDelete")}>
                    <button onClick={() => handleDelete(insp)} className="text-xs font-semibold text-rose-700 border-b border-rose-700/40 hover:border-rose-700 transition-colors">
                      {t("common.actions.delete")}
                    </button>
                    </Bulle>
                  )}
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 sm:hidden">
        {visibles.map((insp) => (
          <div key={insp.id} className="space-y-2.5 border border-slate-300 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900"><NomDuBien titre={insp.property?.title} id={insp.property?.id} /></p>
                <p className="text-xs text-slate-600">{insp.tenant?.firstName} {insp.tenant?.lastName}</p>
              </div>
              <Badge status={insp.status} />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{insp.type === "ENTRY" ? t("manager.inspections.typeEntry") : t("manager.inspections.typeExit")}</span>
              <span>{formaterJour(insp.inspectionDate, i18n.language)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
              {insp.status === "DRAFT" && (
                <Bulle texte={t("manager.tips.inspectionEdit")}>
                <button onClick={() => openEdit(insp)} className={ACTION_TRAIT}>
                  {t("manager.inspections.edit")}
                </button>
                </Bulle>
              )}
              {insp.status === "COMPLETED" && !insp.signedByManagerAt && (
                <Bulle texte={t("manager.tips.inspectionSign")}>
                <button onClick={() => setSigningInspection(insp)} className={ACTION_ENCRE}>
                  <PenLine size={12} aria-hidden="true" /> {t("manager.inspections.sign")}
                </button>
                </Bulle>
              )}
              {insp.status === "COMPLETED" && (
                <Bulle texte={t("manager.tips.inspectionView")}>
                <button onClick={() => setViewingReportInspection(insp)} className={ACTION_ENCRE}>
                  {t("manager.inspections.viewReport")}
                </button>
                </Bulle>
              )}
              {insp.status === "COMPLETED" && insp.type === "EXIT" && (
                <button onClick={() => setComparingInspection(insp)} className={ACTION_TRAIT}>
                  {t("manager.inspections.compare.button")}
                </button>
              )}
              {insp.status === "DRAFT" && (
                <Bulle texte={t("manager.tips.inspectionDelete")}>
                <button onClick={() => handleDelete(insp)} className="text-xs font-semibold text-rose-700 border-b border-rose-700/40 hover:border-rose-700 transition-colors">
                  {t("common.actions.delete")}
                </button>
                </Bulle>
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
          objet="etatDesLieux"
          title={t("manager.inspections.title") + " - " + (signingInspection.property?.title || "")}
          onSuccess={() => {
            setSigningInspection(null);
            load();
          }}
          onClose={() => setSigningInspection(null)}
        />
      )}

      {comparingInspection && (
        <ComparaisonEdlModal
          inspectionId={comparingInspection.id}
          titre={comparingInspection.property?.title || ""}
          onClose={() => setComparingInspection(null)}
          onPrepareRefund={
            bailAComparer && !bailAComparer.depositRefundedAt
              ? () => {
                  setRefundContract(bailAComparer);
                  setComparingInspection(null);
                }
              : undefined
          }
        />
      )}

      {refundContract && (
        <DepositRefundModal
          contract={refundContract}
          onSuccess={() => setRefundContract(null)}
          onClose={() => setRefundContract(null)}
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
