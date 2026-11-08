import { Camera, Check, Circle, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, DELAI_UPLOAD_MS } from "../api/client";
import type {
  Contract,
  LeaseNotice,
  LeaseNoticeDeliveryMode,
  LeaseNoticeGivenBy,
  LeaseNoticePeriodUnit,
  LeaseNoticesResponse,
} from "../types";
import { dateDeSortieProposee } from "../utils/conge";
import CadreModale from "./CadreModale";
import { AIDE, AVIS, BOUTON_ANNULER, BOUTON_DANGER, BOUTON_PLEIN, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

const MODES: LeaseNoticeDeliveryMode[] = ["BAILIFF", "REGISTERED_MAIL", "HAND_DELIVERY", "EMAIL", "OTHER"];

interface LeaseNoticeModalProps {
  contract: Contract;
  /** Appelé après toute modification, pour recharger la liste des baux. */
  onChange: () => void;
  onClose: () => void;
}

const dateCourte = (valeur: string, langue: string) => new Date(valeur).toLocaleDateString(langue, { timeZone: "UTC" });
const jourIso = (valeur: string) => new Date(valeur).toISOString().slice(0, 10);

/**
 * Congé d'un bail. La plateforme ENREGISTRE un congé donné par un autre moyen (acte d'huissier, lettre recommandée, remise en
 * main propre…) : elle ne le notifie pas et ne fournit aucun acte. La date à saisir est celle de la signification ou de la
 * réception, point de départ du préavis ; le scan du document remis au locataire se joint ici.
 */
export default function LeaseNoticeModal({ contract, onChange, onClose }: LeaseNoticeModalProps) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<LeaseNoticesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formFileRef = useRef<HTMLInputElement>(null);

  const [givenBy, setGivenBy] = useState<LeaseNoticeGivenBy>("LANDLORD");
  const [deliveryMode, setDeliveryMode] = useState<LeaseNoticeDeliveryMode>("BAILIFF");
  const [servedAt, setServedAt] = useState("");
  const [periodValue, setPeriodValue] = useState("");
  const [periodUnit, setPeriodUnit] = useState<LeaseNoticePeriodUnit>("MONTHS");
  const [exitDate, setExitDate] = useState("");
  const [exitTouched, setExitTouched] = useState(false);
  const [bailiffName, setBailiffName] = useState("");
  const [actReference, setActReference] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: reponse } = await api.get<LeaseNoticesResponse>(`/contracts/${contract.id}/notices`);
      setData(reponse);
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }, [contract.id]);

  useEffect(() => {
    load();
  }, [load]);

  const actif: LeaseNotice | undefined = data?.conges.find((c) => c.status === "ACTIVE");
  const retires = data?.conges.filter((c) => c.status === "WITHDRAWN") ?? [];
  const formulaire = data !== null && (editing || !actif);

  // La date de sortie suit la signification et le préavis, tant que le gestionnaire ne l'a pas fixée lui-même.
  useEffect(() => {
    if (exitTouched) return;
    setExitDate(dateDeSortieProposee(servedAt, Number(periodValue), periodUnit));
  }, [servedAt, periodValue, periodUnit, exitTouched]);

  function ouvrirFormulaire(conge?: LeaseNotice) {
    setError(null);
    setConfirmWithdraw(false);
    if (conge) {
      setGivenBy(conge.givenBy);
      setDeliveryMode(conge.deliveryMode);
      setServedAt(jourIso(conge.servedAt));
      setPeriodValue(String(conge.periodValue));
      setPeriodUnit(conge.periodUnit);
      setExitDate(jourIso(conge.exitDate));
      setExitTouched(true);
      setBailiffName(conge.bailiffName ?? "");
      setActReference(conge.actReference ?? "");
      setReason(conge.reason ?? "");
    }
    setEditing(true);
  }

  async function envoyerDocument(fichier: File, conge: string) {
    const formData = new FormData();
    formData.append("document", fichier);
    await api.post(`/contracts/${contract.id}/notices/${conge}/document`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: DELAI_UPLOAD_MS,
    });
  }

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const corps = {
      givenBy,
      deliveryMode,
      servedAt,
      periodValue: Number(periodValue),
      periodUnit,
      ...(exitDate ? { exitDate } : {}),
      bailiffName: bailiffName.trim() || null,
      actReference: actReference.trim() || null,
      reason: reason.trim() || null,
    };
    try {
      const { data: conge } = actif && editing
        ? await api.put<LeaseNotice>(`/contracts/${contract.id}/notices/${actif.id}`, corps)
        : await api.post<LeaseNotice>(`/contracts/${contract.id}/notices`, corps);
      const fichier = formFileRef.current?.files?.[0];
      if (fichier) {
        try {
          await envoyerDocument(fichier, conge.id);
        } catch (err) {
          // Le congé est enregistré : seul le scan a échoué, il peut être rejoint depuis la fiche.
          setError(t("components.leaseNoticeModal.documentFailed", { reason: apiErrorMessage(err) }));
        }
      }
      setEditing(false);
      setExitTouched(false);
      await load();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function retirer() {
    if (!actif) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/contracts/${contract.id}/notices/${actif.id}/withdraw`);
      setConfirmWithdraw(false);
      await load();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function joindre(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier || !actif) return;
    setUploading(true);
    setError(null);
    try {
      await envoyerDocument(fichier, actif.id);
      await load();
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  const periode = (c: LeaseNotice) => `${c.periodValue} ${t(`components.leaseNoticeModal.unit.${c.periodUnit}`)}`;
  const BAILLEUR_LIGNE = "flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-slate-200 py-1.5 text-sm";

  return (
    <CadreModale
      titre={t("components.leaseNoticeModal.title")}
      titreId="lease-notice-title"
      sousTitre={t("components.leaseNoticeModal.subtitle", {
        property: contract.property?.title ?? "",
        tenant: contract.tenant ? `${contract.tenant.firstName} ${contract.tenant.lastName}` : "",
      })}
      onClose={onClose}
      fermable={!saving && !uploading}
      largeur="xl"
    >
      <div className="space-y-4">
        <p className={INFO}>{t("components.leaseNoticeModal.disclaimer")}</p>

        {loadError && (
          <p role="alert" className={ERREUR}>
            {loadError}
          </p>
        )}
        {!data && !loadError && <p className="text-sm text-slate-600">{t("components.leaseNoticeModal.loading")}</p>}

        {formulaire && (
          <form onSubmit={enregistrer} className="space-y-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">
              {actif ? t("components.leaseNoticeModal.editTitle") : t("components.leaseNoticeModal.newTitle")}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="notice-given-by" className={ETIQUETTE}>
                  {t("components.leaseNoticeModal.givenBy")}
                </label>
                <select id="notice-given-by" value={givenBy} onChange={(e) => setGivenBy(e.target.value as LeaseNoticeGivenBy)} className={CHAMP}>
                  <option value="LANDLORD">{t("components.leaseNoticeModal.givenByLANDLORD")}</option>
                  <option value="TENANT">{t("components.leaseNoticeModal.givenByTENANT")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="notice-mode" className={ETIQUETTE}>
                  {t("components.leaseNoticeModal.deliveryMode")}
                </label>
                <select id="notice-mode" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as LeaseNoticeDeliveryMode)} className={CHAMP}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`components.leaseNoticeModal.mode.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {deliveryMode === "BAILIFF" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="notice-bailiff" className={ETIQUETTE}>
                    {t("components.leaseNoticeModal.bailiffName")}
                  </label>
                  <input id="notice-bailiff" type="text" maxLength={200} value={bailiffName} onChange={(e) => setBailiffName(e.target.value)} className={CHAMP} />
                </div>
                <div>
                  <label htmlFor="notice-act" className={ETIQUETTE}>
                    {t("components.leaseNoticeModal.actReference")}
                  </label>
                  <input id="notice-act" type="text" maxLength={120} value={actReference} onChange={(e) => setActReference(e.target.value)} className={CHAMP} />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="notice-served" className={ETIQUETTE}>
                {deliveryMode === "BAILIFF" ? t("components.leaseNoticeModal.servedAtBailiff") : t("components.leaseNoticeModal.servedAt")}
              </label>
              <input id="notice-served" type="date" required value={servedAt} onChange={(e) => setServedAt(e.target.value)} className={`${CHAMP} sm:w-56`} />
              <p className={AIDE}>{t("components.leaseNoticeModal.servedAtHint")}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="notice-period" className={ETIQUETTE}>
                  {t("components.leaseNoticeModal.period")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="notice-period"
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    required
                    value={periodValue}
                    onChange={(e) => setPeriodValue(e.target.value)}
                    className={`${CHAMP} w-24`}
                  />
                  <select aria-label={t("components.leaseNoticeModal.periodUnit")} value={periodUnit} onChange={(e) => setPeriodUnit(e.target.value as LeaseNoticePeriodUnit)} className={CHAMP}>
                    <option value="MONTHS">{t("components.leaseNoticeModal.unit.MONTHS")}</option>
                    <option value="DAYS">{t("components.leaseNoticeModal.unit.DAYS")}</option>
                  </select>
                </div>
                <p className={AIDE}>{t("components.leaseNoticeModal.periodHint")}</p>
              </div>
              <div>
                <label htmlFor="notice-exit" className={ETIQUETTE}>
                  {t("components.leaseNoticeModal.exitDate")}
                </label>
                <input
                  id="notice-exit"
                  type="date"
                  required
                  value={exitDate}
                  onChange={(e) => {
                    setExitDate(e.target.value);
                    setExitTouched(true);
                  }}
                  className={CHAMP}
                />
                <p className={AIDE}>{t("components.leaseNoticeModal.exitDateHint")}</p>
              </div>
            </div>

            <div>
              <label htmlFor="notice-reason" className={ETIQUETTE}>
                {t("components.leaseNoticeModal.reason")}
              </label>
              <textarea id="notice-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={CHAMP} />
            </div>

            <div className="border border-dashed border-slate-400 bg-slate-50 p-4">
              <label htmlFor="notice-doc-form" className={ETIQUETTE}>
                {t("components.leaseNoticeModal.documentLabel")}
              </label>
              <input id="notice-doc-form" ref={formFileRef} type="file" accept="image/*,application/pdf" className="block w-full text-sm text-slate-700" />
              <p className={AIDE}>{t("components.leaseNoticeModal.documentHint")}</p>
            </div>

            {error && (
              <p role="alert" className={ERREUR}>
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
              <button type="button" onClick={() => (actif ? setEditing(false) : onClose())} disabled={saving} className={BOUTON_ANNULER}>
                {t("common.actions.cancel")}
              </button>
              <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
                {saving ? t("components.leaseNoticeModal.saving") : t("components.leaseNoticeModal.save")}
              </button>
            </div>
          </form>
        )}

        {data && actif && !editing && (
          <div className="space-y-4">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">{t("components.leaseNoticeModal.currentTitle")}</h4>
            <dl>
              <div className={BAILLEUR_LIGNE}>
                <dt className="text-slate-600">{t("components.leaseNoticeModal.givenBy")}</dt>
                <dd className="font-semibold text-slate-900">{t(`components.leaseNoticeModal.givenBy${actif.givenBy}`)}</dd>
              </div>
              <div className={BAILLEUR_LIGNE}>
                <dt className="text-slate-600">{t("components.leaseNoticeModal.deliveryMode")}</dt>
                <dd className="font-semibold text-slate-900">{t(`components.leaseNoticeModal.mode.${actif.deliveryMode}`)}</dd>
              </div>
              {actif.bailiffName && (
                <div className={BAILLEUR_LIGNE}>
                  <dt className="text-slate-600">{t("components.leaseNoticeModal.bailiffName")}</dt>
                  <dd className="font-semibold text-slate-900">{actif.bailiffName}</dd>
                </div>
              )}
              {actif.actReference && (
                <div className={BAILLEUR_LIGNE}>
                  <dt className="text-slate-600">{t("components.leaseNoticeModal.actReference")}</dt>
                  <dd className="font-semibold text-slate-900">{actif.actReference}</dd>
                </div>
              )}
              <div className={BAILLEUR_LIGNE}>
                <dt className="text-slate-600">{t("components.leaseNoticeModal.servedAtShort")}</dt>
                <dd className="font-semibold text-slate-900">{dateCourte(actif.servedAt, i18n.language)}</dd>
              </div>
              <div className={BAILLEUR_LIGNE}>
                <dt className="text-slate-600">{t("components.leaseNoticeModal.period")}</dt>
                <dd className="font-semibold text-slate-900">{periode(actif)}</dd>
              </div>
              <div className={BAILLEUR_LIGNE}>
                <dt className="text-slate-600">{t("components.leaseNoticeModal.exitDate")}</dt>
                <dd className="font-semibold text-orange-800">{dateCourte(actif.exitDate, i18n.language)}</dd>
              </div>
              {actif.reason && (
                <div className={BAILLEUR_LIGNE}>
                  <dt className="text-slate-600">{t("components.leaseNoticeModal.reason")}</dt>
                  <dd className="max-w-[60%] text-right text-slate-900">{actif.reason}</dd>
                </div>
              )}
            </dl>

            <section aria-label={t("components.leaseNoticeModal.documentLabel")} className="border border-slate-300 p-4">
              <h5 className={ETIQUETTE}>{t("components.leaseNoticeModal.documentLabel")}</h5>
              <div className="flex flex-wrap items-center gap-3">
                {actif.documentUrl ? (
                  <a href={actif.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border-b border-ink-900/40 text-sm font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
                    <ExternalLink size={14} aria-hidden="true" />
                    {t("components.leaseNoticeModal.viewDocument")}
                  </a>
                ) : (
                  <span className="text-sm text-slate-600">{t("components.leaseNoticeModal.noDocument")}</span>
                )}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={BOUTON_TRAIT}>
                  <Camera size={13} aria-hidden="true" className="mr-1.5 inline" />
                  {uploading ? t("components.leaseNoticeModal.uploading") : actif.documentUrl ? t("components.leaseNoticeModal.replaceDocument") : t("components.leaseNoticeModal.attachDocument")}
                </button>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={joindre} className="sr-only" aria-label={t("components.leaseNoticeModal.documentLabel")} tabIndex={-1} />
              </div>
              <p className={AIDE}>{t("components.leaseNoticeModal.documentHint")}</p>
            </section>

            {data.etapes && (
              <section aria-label={t("components.leaseNoticeModal.stepsTitle")} className="border border-slate-300 p-4">
                <h5 className={ETIQUETTE}>{t("components.leaseNoticeModal.stepsTitle")}</h5>
                <ul className="space-y-1.5 text-sm text-slate-800">
                  <li className="flex items-center gap-2">
                    {data.etapes.etatDesLieuxDeSortie === "COMPLETED" ? <Check size={14} className="text-emerald-700" aria-hidden="true" /> : <Circle size={14} className="text-slate-400" aria-hidden="true" />}
                    <span>{t(`components.leaseNoticeModal.inspection.${data.etapes.etatDesLieuxDeSortie}`)}</span>
                    {data.etapes.etatDesLieuxDeSortie !== "COMPLETED" && (
                      <Link to="/etats-des-lieux" className="ml-auto border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
                        {t("components.leaseNoticeModal.goInspections")}
                      </Link>
                    )}
                  </li>
                  <li className="flex items-center gap-2">
                    {data.etapes.depotRestitue ? <Check size={14} className="text-emerald-700" aria-hidden="true" /> : <Circle size={14} className="text-slate-400" aria-hidden="true" />}
                    <span>{data.etapes.depotRestitue ? t("components.leaseNoticeModal.depositDone") : t("components.leaseNoticeModal.depositTodo")}</span>
                  </li>
                </ul>
                <p className={AIDE}>{t("components.leaseNoticeModal.stepsHint")}</p>
              </section>
            )}

            {data.facturesApresSortie > 0 && (
              <p role="note" className={AVIS}>
                {t("components.leaseNoticeModal.invoicesAfterExit", { count: data.facturesApresSortie })}
              </p>
            )}

            {error && (
              <p role="alert" className={ERREUR}>
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 pt-4">
              {confirmWithdraw ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-slate-800">{t("components.leaseNoticeModal.withdrawConfirm")}</span>
                  <button type="button" onClick={retirer} disabled={saving} className={BOUTON_DANGER}>
                    {saving ? t("components.leaseNoticeModal.withdrawing") : t("components.leaseNoticeModal.withdrawYes")}
                  </button>
                  <button type="button" onClick={() => setConfirmWithdraw(false)} disabled={saving} className={BOUTON_ANNULER}>
                    {t("common.actions.cancel")}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmWithdraw(true)} className="text-xs font-semibold text-orange-800 border-b border-orange-700/40 hover:border-orange-800">
                  {t("components.leaseNoticeModal.withdraw")}
                </button>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className={BOUTON_TRAIT}>
                  {t("common.actions.close")}
                </button>
                <button type="button" onClick={() => ouvrirFormulaire(actif)} className={BOUTON_PLEIN}>
                  {t("components.leaseNoticeModal.edit")}
                </button>
              </div>
            </div>
          </div>
        )}

        {data && retires.length > 0 && (
          <section aria-label={t("components.leaseNoticeModal.historyTitle")} className="border-t border-slate-300 pt-3">
            <h5 className={ETIQUETTE}>{t("components.leaseNoticeModal.historyTitle")}</h5>
            <ul className="space-y-1 text-xs text-slate-600">
              {retires.map((c) => (
                <li key={c.id}>
                  {t("components.leaseNoticeModal.historyLine", {
                    served: dateCourte(c.servedAt, i18n.language),
                    exit: dateCourte(c.exitDate, i18n.language),
                    withdrawn: c.withdrawnAt ? dateCourte(c.withdrawnAt, i18n.language) : "",
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </CadreModale>
  );
}
