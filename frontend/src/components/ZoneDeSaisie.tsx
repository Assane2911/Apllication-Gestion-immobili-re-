import { Mic, Send, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "../api/client";
import { type EnregistrementVocal, useEnregistreurVocal } from "../hooks/useEnregistreurVocal";
import { DUREE_MAX_MESSAGE_VOCAL_SEC, enregistrementPossible, formaterDuree } from "../utils/messageVocal";
import LecteurVocal from "./LecteurVocal";

const LONGUEUR_MAX = 5000;

interface Props {
  valeur: string;
  onChange: (valeur: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  envoi: boolean;
  libelleChamp: string;
  libelleEnvoyer: string;
  libelleEnvoi: string;
  indice: string;
  /**
   * Active le message vocal : un bouton micro apparaît à côté de « Envoyer ». La fonction reçoit l'enregistrement
   * réécouté et validé ; si elle échoue, l'enregistrement est gardé et l'erreur affichée, pour pouvoir réessayer.
   */
  onEnvoyerVocal?: (enregistrement: EnregistrementVocal) => Promise<void>;
}

const BOUTON_TRAIT =
  "inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:opacity-50";
const BOUTON_PLEIN =
  "inline-flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-ink-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50";

/**
 * Saisie d'un message : zone de deux lignes, compteur de caractères, bouton d'envoi. Entrée envoie, Maj+Entrée passe à la
 * ligne (sauf pendant une composition au clavier virtuel). Commune aux messageries du gestionnaire et du locataire.
 *
 * Avec `onEnvoyerVocal`, un bouton micro enregistre un message vocal (jusqu'à trois minutes) : pendant l'enregistrement
 * puis la réécoute, le panneau vocal remplace la zone de texte ; rien n'est envoyé avant la validation explicite.
 */
export default function ZoneDeSaisie({ valeur, onChange, onSubmit, envoi, libelleChamp, libelleEnvoyer, libelleEnvoi, indice, onEnvoyerVocal }: Props) {
  const { t } = useTranslation();
  const vocal = useEnregistreurVocal();
  const [envoiVocal, setEnvoiVocal] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const actif = vocal.etat !== "repos";
  const peutEnregistrer = Boolean(onEnvoyerVocal) && enregistrementPossible();

  async function envoyerVocal() {
    if (!onEnvoyerVocal || !vocal.enregistrement || envoiVocal) return;
    setEnvoiVocal(true);
    setErreurEnvoi(null);
    try {
      await onEnvoyerVocal(vocal.enregistrement);
      vocal.reinitialiser();
    } catch (err) {
      setErreurEnvoi(apiErrorMessage(err));
    } finally {
      setEnvoiVocal(false);
    }
  }

  const messageErreur = vocal.erreur ? t(`voice.errors.${vocal.erreur}`) : erreurEnvoi;

  return (
    <form onSubmit={onSubmit} className="border-t border-slate-300 bg-white p-4">
      {actif ? (
        <div role="group" aria-label={t("voice.panel")} className="space-y-3 border border-slate-400 bg-slate-50 p-4">
          {vocal.etat === "demarrage" && <p className="text-xs text-slate-700">{t("voice.starting")}</p>}

          {vocal.etat === "enregistrement" && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-orange-700">
                  <span aria-hidden="true" className="h-2.5 w-2.5 bg-orange-700" />
                  {t("voice.recording")}
                </p>
                <p className="font-mono text-sm font-bold tabular-nums text-ink-900" aria-label={t("voice.elapsed", { time: formaterDuree(vocal.secondes) })}>
                  {formaterDuree(vocal.secondes)} / {formaterDuree(DUREE_MAX_MESSAGE_VOCAL_SEC)}
                </p>
              </div>
              <div
                role="progressbar"
                aria-hidden="true"
                aria-valuemin={0}
                aria-valuemax={DUREE_MAX_MESSAGE_VOCAL_SEC}
                aria-valuenow={vocal.secondes}
                className="h-1.5 border border-slate-400 bg-white"
              >
                <div className="h-full bg-orange-700" style={{ width: `${Math.min(100, (vocal.secondes / DUREE_MAX_MESSAGE_VOCAL_SEC) * 100)}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={vocal.annuler} className={BOUTON_TRAIT}>
                  <Trash2 size={13} aria-hidden="true" /> {t("voice.cancel")}
                </button>
                <button type="button" onClick={vocal.terminer} data-autofocus className={BOUTON_PLEIN}>
                  <Square size={13} aria-hidden="true" /> {t("voice.stop")}
                </button>
              </div>
            </>
          )}

          {vocal.etat === "ecoute" && vocal.enregistrement && (
            <>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("voice.review")}</p>
              <LecteurVocal url={vocal.enregistrement.url} duree={vocal.enregistrement.duree} />
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={vocal.annuler} disabled={envoiVocal} className={BOUTON_TRAIT}>
                  <Trash2 size={13} aria-hidden="true" /> {t("voice.discard")}
                </button>
                <button type="button" onClick={envoyerVocal} disabled={envoiVocal} className={BOUTON_PLEIN}>
                  <Send size={13} aria-hidden="true" />
                  {envoiVocal ? t("voice.sending") : t("voice.send")}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <textarea
          rows={2}
          aria-label={libelleChamp}
          placeholder={libelleChamp}
          value={valeur}
          maxLength={LONGUEUR_MAX}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!envoi && valeur.trim()) e.currentTarget.form?.requestSubmit();
            }
          }}
          className="block w-full resize-none border border-slate-400 bg-white px-4 py-2.5 text-xs text-slate-900"
        />
      )}

      {messageErreur && (
        <p role="alert" className="mt-2 border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 shadow-[inset_3px_0_0_var(--color-rose-600)]">
          {messageErreur}
        </p>
      )}

      {!actif && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="hidden font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:block">{indice}</p>
          <div className="ml-auto flex items-center gap-3">
            <span className={`font-mono text-[10px] tabular-nums ${valeur.length > LONGUEUR_MAX - 500 ? "text-rose-700" : "text-slate-500"}`}>
              {valeur.length} / {LONGUEUR_MAX}
            </span>
            {peutEnregistrer && (
              <button type="button" onClick={() => void vocal.demarrer()} aria-label={t("voice.record")} className={BOUTON_TRAIT}>
                <Mic size={14} aria-hidden="true" />
                <span className="hidden sm:inline">{t("voice.recordShort")}</span>
              </button>
            )}
            <button type="submit" disabled={envoi || !valeur.trim()} className={BOUTON_PLEIN}>
              <Send size={13} aria-hidden="true" />
              {envoi ? libelleEnvoi : libelleEnvoyer}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
