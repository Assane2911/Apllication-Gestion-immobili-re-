import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../api/client";
import { useAuth } from "../context/auth";
import { useCurrency } from "../context/currency";
import { reglesDuPays } from "../data/reglesPays";
import type { FormalNotice, FormalNoticeDue } from "../types";
import { useDialogue } from "../hooks/useDialogue";

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

  const dialogue = useDialogue({ onClose, titreId: "formal-notice-title", fermable: !saving });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        {...dialogue}
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-contour-200 dark:border-slate-700"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id="formal-notice-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t("components.formalNoticeModal.title")}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {t("components.formalNoticeModal.subtitle", {
                property: bail.propertyTitle,
                tenant: bail.tenantName,
                total: formatMoney(bail.totalDue, bail.currency),
              })}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t("common.actions.close")} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        {emise ? (
          <div className="mt-4 space-y-3">
            <p role="status" className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
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
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">{t("components.formalNoticeModal.registeredMail")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                {t("common.actions.close")}
              </button>
              <button type="button" onClick={() => onOpenDocument(emise.id)} className="text-sm px-3 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white font-semibold">
                {t("components.formalNoticeModal.open")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={emettre} className="mt-4 space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">{t("components.formalNoticeModal.intro")}</p>
            <div>
              <label htmlFor="formal-notice-deadline" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
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
                className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("components.formalNoticeModal.deadlineHint")}</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="mt-0.5" />
              {t("components.formalNoticeModal.sendEmail")}
            </label>
            <label className={`flex items-start gap-2 text-sm ml-6 ${sendEmail ? "text-slate-700 dark:text-slate-300" : "text-slate-400 dark:text-slate-600"}`}>
              <input
                type="checkbox"
                checked={sendEmail && notifyGuarantors}
                disabled={!sendEmail}
                onChange={(e) => setNotifyGuarantors(e.target.checked)}
                className="mt-0.5"
              />
              {t("components.formalNoticeModal.notifyGuarantors")}
            </label>
            <p className="text-xs text-slate-600 dark:text-slate-400">{t("components.formalNoticeModal.registeredMail")}</p>
            {bail.agencyReachable === false && (
              <p role="note" className="text-xs rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
                {t("components.formalNoticeModal.agencyUnreachable")}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white font-semibold">
                {saving ? t("components.formalNoticeModal.submitting") : t("components.formalNoticeModal.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
