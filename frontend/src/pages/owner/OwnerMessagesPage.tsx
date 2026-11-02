import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import FilDeMessages from "../../components/FilDeMessages";
import ZoneDeSaisie from "../../components/ZoneDeSaisie";
import { useDiscussionProprietaire } from "../../hooks/useDiscussionProprietaire";

const REPONSES_RAPIDES = ["question", "payout", "visit", "thanks"] as const;

/**
 * Messagerie du propriétaire avec son agence : un fil unique, en texte et en message vocal. L'agence est prévenue de
 * chaque message dans sa cloche ; le propriétaire l'est par e-mail quand elle répond.
 */
export default function OwnerMessagesPage() {
  const { t } = useTranslation();
  const { messages, newText, setNewText, sending, loading, loadingMessages, error, handleSend, handleSendVoice } = useDiscussionProprietaire("OWNER");

  if (loading) return <p className="text-sm text-slate-600">{t("owner.messages.loading")}</p>;

  if (error) {
    return (
      <div className="border border-rose-300 bg-rose-50 p-6 text-rose-800 shadow-[inset_4px_0_0_var(--color-rose-600)]">
        <p className="text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 cursor-pointer border border-rose-700 bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("owner.messages.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("owner.messages.subtitle")}</p>
      </div>

      <div className="flex h-[70vh] flex-col overflow-hidden border border-ink-900 bg-white md:h-[calc(100vh-17rem)] md:min-h-[520px]">
        <div className="flex items-center gap-3 border-b border-ink-900 bg-ink-900 px-4 py-3 text-white md:px-6">
          <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-white text-ink-900">
            <Building2 size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold">{t("owner.messages.headerTitle")}</h3>
            <p className="truncate text-xs text-white/80">{t("owner.messages.headerSubtitle")}</p>
          </div>
        </div>

        <FilDeMessages
          messages={messages}
          roleMoi="OWNER"
          libelleMoi={t("owner.messages.you")}
          libelleAutre={t("owner.messages.agency")}
          libelleLu={t("owner.messages.read")}
          libelleEnvoye={t("owner.messages.sent")}
          chargement={loadingMessages}
          libelleChargement={t("owner.messages.loadingMessages")}
          libelleVide={t("owner.messages.noMessagesYet")}
        />

        <div role="group" aria-label={t("owner.messages.quick.label")} className="flex flex-wrap items-center gap-2 border-t border-slate-300 bg-slate-50 px-4 py-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("owner.messages.quick.label")}</span>
          {REPONSES_RAPIDES.map((cle) => (
            <button
              key={cle}
              type="button"
              onClick={() => {
                const texte = t(`owner.messages.quick.${cle}Text`);
                setNewText(newText.trim() ? `${newText.trimEnd()} ${texte}` : texte);
              }}
              className="cursor-pointer border border-slate-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:text-ink-900"
            >
              {t(`owner.messages.quick.${cle}`)}
            </button>
          ))}
        </div>

        <ZoneDeSaisie
          valeur={newText}
          onChange={setNewText}
          onSubmit={handleSend}
          onEnvoyerVocal={handleSendVoice}
          envoi={sending}
          libelleChamp={t("owner.messages.writeMessage")}
          libelleEnvoyer={t("owner.messages.send")}
          libelleEnvoi={t("owner.messages.sending")}
          indice={t("owner.messages.sendHint")}
        />
      </div>
    </div>
  );
}
