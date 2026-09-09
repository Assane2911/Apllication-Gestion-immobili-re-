import { useTranslation } from "react-i18next";
import { useConversationThread } from "../../hooks/useConversationThread";

export default function TenantMessagesPage() {
  const { t, i18n } = useTranslation();
  const {
    conversations,
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
    return <p className="text-slate-500 dark:text-slate-400 text-sm">{t("tenant.messages.loading")}</p>;
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 p-6 rounded-2xl">
        <p className="text-sm">{error}</p>
        <button
          onClick={loadConversations}
          className="mt-4 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-xl"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-slate-500 dark:text-slate-400 text-sm">{t("tenant.messages.noActiveContract")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("tenant.messages.title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("tenant.messages.subtitle")}</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden h-[600px] flex flex-col">
        {/* En-tête du chat */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t("tenant.messages.headerTitle")}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("tenant.messages.housing", { property: activeContract?.property?.title || t("tenant.messages.yourApartment") })}
            </p>
          </div>
          <span className="text-xs bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {t("tenant.messages.online")}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30 dark:bg-slate-950/20">
          {loadingMessages && (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">{t("tenant.messages.loadingMessages")}</p>
          )}
          {messages.map((m) => {
            const isMe = m.senderRole === "TENANT";
            return (
              <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">
                  {isMe ? t("tenant.messages.you") : t("tenant.messages.manager")} •{" "}
                  {new Date(m.createdAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div
                  className={`max-w-md px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
                    isMe
                      ? "bg-brand-600 text-white rounded-br-none"
                      : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
          {!loadingMessages && messages.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-12">
              {t("tenant.messages.noMessagesYet")}
            </p>
          )}
        </div>

        {/* Formulaire d'envoi */}
        <form onSubmit={handleSend} className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-2">
          <input
            type="text"
            aria-label={t("tenant.messages.writeMessage")}
            placeholder={t("tenant.messages.writeMessage")}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            className="flex-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={sending || !newText.trim()}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            {sending ? t("tenant.messages.sending") : t("tenant.messages.send")}
          </button>
        </form>
      </div>
    </div>
  );
}
