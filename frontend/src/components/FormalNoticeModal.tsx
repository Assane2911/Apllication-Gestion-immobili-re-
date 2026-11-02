import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useAuth } from "../context/auth";
import { useCurrency } from "../context/currency";
import { reglesDuPays } from "../data/reglesPays";
import type { FormalNotice, FormalNoticeDue } from "../types";
import CadreModale from "./CadreModale";
import { AIDE, AVIS, BOUTON_ANNULER, BOUTON_DANGER, BOUTON_TRAIT, CHAMP, ERREUR, ETIQUETTE, INFO } from "./styleFormulaire";

interface FormalNoticeModalProps {
  bail: FormalNoticeDue;
  /** Ouvre le courrier émis (document à imprimer). */
  onOpenDocument: (noticeId: string) => void;
  onIssued: () => void;
  onClose: () => void;
}

/** Émission d'une mise en demeure de payer : délai, envoi par email, copie aux garants. */
export default function FormalNoticeModal({ bail, onOpenDocument, onIssued, onClose }: FormalNoticeModalProps) {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  // Délai proposé : celui du pays de l'agence (30 jours au Sénégal, 8 ailleurs), que le gestionnaire peut changer.
  const { user } = useAuth();
  const [deadlineDays, setDeadlineDays] = useState(String(reglesDuPays(user?.country).delaiMiseEnDemeureJours));
  const [sendEmail, setSendEmail] = useState(true);
  const [notifyGuarantors, setNotifyGuarantors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emise, setEmise] = useState<FormalNotice | null>(null);

  async function emettre(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.post<FormalNotice>(`/contracts/${bail.contractId}/formal-notices`, {
        deadlineDays: Number(deadlineDays),
        sendEmail,
        notifyGuarantors: sendEmail && notifyGuarantors,
      });
      setEmise(data);
      onIssued();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CadreModale
      titre={t("components.formalNoticeModal.title")}
      titreId="formal-notice-title"
      sousTitre={t("components.formalNoticeModal.subtitle", {
        property: bail.propertyTitle,
        tenant: bail.tenantName,
        total: formatMoney(bail.totalDue, bail.currency),
      })}
      onClose={onClose}
      fermable={!saving}
      largeur="lg"
      danger
    >
      {emise ? (
        <div className="space-y-3">
          <p role="status" className={INFO}>
            <span className="text-sm">
              {t("components.formalNoticeModal.done", { reference: emise.reference })}{" "}
              {!sendEmail
                ? t("components.formalNoticeModal.doneNoEmail")
                : emise.emailEnvoye
                  ? t("components.formalNoticeModal.doneEmail")
                  : t("components.formalNoticeModal.doneEmailFailed")}
              {sendEmail && notifyGuarantors && (
                <>
                  {" "}
                  {emise.guarantorsNotified > 0
                    ? t("components.formalNoticeModal.doneGuarantors", { count: emise.guarantorsNotified })
                    : t("components.formalNoticeModal.doneGuarantorsNone")}
                </>
              )}
            </span>
          </p>
          <p className="text-xs text-slate-600">{t("components.formalNoticeModal.registeredMail")}</p>
          <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
            <button type="button" onClick={onClose} className={BOUTON_TRAIT}>
              {t("common.actions.close")}
            </button>
            <button type="button" onClick={() => onOpenDocument(emise.id)} className={BOUTON_DANGER}>
              {t("components.formalNoticeModal.open")}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={emettre} className="space-y-4">
          <p className="text-sm text-slate-700">{t("components.formalNoticeModal.intro")}</p>
          <div>
            <label htmlFor="formal-notice-deadline" className={ETIQUETTE}>
              {t("components.formalNoticeModal.deadline")}
            </label>
            <input
              id="formal-notice-deadline"
              type="number"
              min={1}
              max={60}
              step={1}
              required
              value={deadlineDays}
              onChange={(e) => setDeadlineDays(e.target.value)}
              className={`${CHAMP} w-28`}
            />
            <p className={AIDE}>{t("components.formalNoticeModal.deadlineHint")}</p>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="mt-0.5" />
            {t("components.formalNoticeModal.sendEmail")}
          </label>
          <label className={`ml-6 flex items-start gap-2 text-sm ${sendEmail ? "text-slate-800" : "text-slate-500"}`}>
            <input
              type="checkbox"
              checked={sendEmail && notifyGuarantors}
              disabled={!sendEmail}
              onChange={(e) => setNotifyGuarantors(e.target.checked)}
              className="mt-0.5"
            />
            {t("components.formalNoticeModal.notifyGuarantors")}
          </label>
          <p className="text-xs text-slate-600">{t("components.formalNoticeModal.registeredMail")}</p>
          {bail.agencyReachable === false && (
            <p role="note" className={AVIS}>
              {t("components.formalNoticeModal.agencyUnreachable")}
            </p>
          )}
          {error && (
            <p role="alert" className={ERREUR}>
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className={BOUTON_ANNULER}>
              {t("common.actions.cancel")}
            </button>
            <button type="submit" disabled={saving} className={BOUTON_DANGER}>
              {saving ? t("components.formalNoticeModal.submitting") : t("components.formalNoticeModal.submit")}
            </button>
          </div>
        </form>
      )}
    </CadreModale>
  );
}
