import { useTranslation } from "react-i18next";
import FilDeMessages from "../../components/FilDeMessages";
import Initiales from "../../components/Initiales";
import ZoneDeSaisie from "../../components/ZoneDeSaisie";
import { cleDuFil, useConversationThread } from "../../hooks/useConversationThread";

const REPONSES_RAPIDES = ["hello", "thanks", "problem", "receipt", "paid"] as const;

export default function TenantMessagesPage() {
  const { t } = useTranslation();
  const {
    conversations,
    selectedThreadId,
    setSelectedThreadId,
    messages,
    activeContract,
    newText,
    setNewText,
    sending,
    loading,
    loadingMessages,
    error,
    loadConversations,
    handleSend,
  } = useConversationThread("TENANT");

  if (loading) {
    return <p className="text-sm text-slate-600">{t("tenant.messages.loading")}</p>;
  }

  if (error) {
    return (
      <div className="border border-rose-300 bg-rose-50 p-6 text-rose-800 shadow-[inset_4px_0_0_var(--color-rose-600)]">
        <p className="text-sm">{error}</p>
        <button
          onClick={() => loadConversations()}
          className="mt-4 cursor-pointer border border-rose-700 bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="border border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-600">{t("tenant.messages.noActiveContract")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("tenant.messages.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("tenant.messages.subtitle")}</p>
      </div>

      <div className="flex h-[70vh] flex-col overflow-hidden border border-ink-900 bg-white md:h-[calc(100vh-17rem)] md:min-h-[520px]">
        {/* En-tête du fil : le gestionnaire, le logement concerné et, s'il y en a plusieurs, le choix du logement. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900 bg-ink-900 px-4 py-3 text-white md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Initiales prenom={t("tenant.messages.manager")} className="bg-white! text-ink-900!" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold">{t("tenant.messages.headerTitle")}</h3>
              <p className="truncate text-xs text-white/80">
                {t("tenant.messages.housing", { property: activeContract?.property?.title || t("tenant.messages.yourApartment") })}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {/* Plusieurs fils (plusieurs baux, ou titulaire d'un bail et colocataire d'un autre) : on choisit le logement. */}
            {conversations.length > 1 && (
              <select
                aria-label={t("tenant.messages.chooseHousing")}
                value={selectedThreadId ?? ""}
                onChange={(e) => setSelectedThreadId(e.target.value)}
                className="min-w-0 border border-white/60 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                {conversations.map((c) => (
                  <option key={cleDuFil(c)} value={cleDuFil(c)}>
                    {c.property?.title}
                    {c.qualite === "COLOCATAIRE" ? ` · ${t("tenant.messages.cotenant")}` : ""}
                  </option>
                ))}
              </select>
            )}
            <span className="inline-flex shrink-0 items-center gap-1.5 border border-white/50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider">
              <span aria-hidden="true" className="h-2 w-2 bg-orange-300" />
              {t("tenant.messages.online")}
            </span>
          </div>
        </div>

        <FilDeMessages
          messages={messages}
          roleMoi="TENANT"
          libelleMoi={t("tenant.messages.you")}
          libelleAutre={t("tenant.messages.manager")}
          libelleLu={t("tenant.messages.read")}
          libelleEnvoye={t("tenant.messages.sent")}
          chargement={loadingMessages}
          libelleChargement={t("tenant.messages.loadingMessages")}
          libelleVide={t("tenant.messages.noMessagesYet")}
        />

        {/* Réponses rapides : un clic insère le texte (sans l'envoyer), à compléter avant l'envoi. */}
        <div role="group" aria-label={t("tenant.messages.quick.label")} className="flex flex-wrap items-center gap-2 border-t border-slate-300 bg-slate-50 px-4 py-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("tenant.messages.quick.label")}</span>
          {REPONSES_RAPIDES.map((cle) => (
            <button
              key={cle}
              type="button"
              onClick={() => {
                const texte = t(`tenant.messages.quick.${cle}Text`);
                setNewText(newText.trim() ? `${newText.trimEnd()} ${texte}` : texte);
              }}
              className="cursor-pointer border border-slate-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:text-ink-900"
            >
              {t(`tenant.messages.quick.${cle}`)}
            </button>
          ))}
        </div>

        <ZoneDeSaisie
          valeur={newText}
          onChange={setNewText}
          onSubmit={handleSend}
          envoi={sending}
          libelleChamp={t("tenant.messages.writeMessage")}
          libelleEnvoyer={t("tenant.messages.send")}
          libelleEnvoi={t("tenant.messages.sending")}
          indice={t("tenant.messages.sendHint")}
        />
      </div>
    </div>
  );
}
