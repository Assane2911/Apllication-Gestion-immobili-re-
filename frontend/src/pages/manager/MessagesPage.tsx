import { ArrowLeft, MessageSquare, Phone, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import Initiales from "../../components/Initiales";
import Pagination from "../../components/Pagination";
import { cleDuFil, useConversationThread } from "../../hooks/useConversationThread";

export default function MessagesPage() {
  const { t, i18n } = useTranslation();
  const {
    conversations,
    page,
    setPage,
    total,
    totalPages,
    selectedThreadId,
    setSelectedThreadId,
    messages,
    activeContract: activeDetails,
    newText,
    setNewText,
    sending,
    loadingMessages,
    error,
    loadConversations,
    handleSend,
  } = useConversationThread("MANAGER", { refreshOnSend: true });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.messages.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.messages.subtitle")}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-xs flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => loadConversations()} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-300 overflow-hidden h-[70vh] md:h-[680px] flex flex-col md:flex-row">
        {/* Liste des conversations */}
        <div
          className={`${
            selectedThreadId ? "hidden md:flex" : "flex"
          } w-full md:w-80 border-r border-slate-300 flex-col bg-slate-50`}
        >
          <div className="p-4 border-b border-slate-300 bg-white">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-900">{t("manager.messages.ongoingDiscussions")}</h3>
            <p className="mt-1 text-xs text-slate-600">{t("manager.messages.conversationCount", { count: total })}</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-300">
            {conversations.map((c) => (
              <button
                key={cleDuFil(c)}
                onClick={() => setSelectedThreadId(cleDuFil(c))}
                className={`w-full text-left p-4 transition-colors flex items-start gap-3 ${
                  selectedThreadId === cleDuFil(c)
                    ? "bg-white shadow-[inset_3px_0_0_var(--color-orange-700)]"
                    : "hover:bg-white"
                }`}
              >
                <Initiales prenom={c.tenant?.firstName} nom={c.tenant?.lastName} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs text-slate-900 truncate">
                    {c.tenant?.firstName} {c.tenant?.lastName}
                    {c.qualite === "COLOCATAIRE" && (
                      <span className="ml-1.5 align-middle border border-slate-400 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-700">
                        {t("manager.messages.cotenant")}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-600 truncate">{c.property?.title}</p>
                  <p className="text-[11px] text-slate-600 truncate mt-1">
                    {c.lastMessage ? c.lastMessage.content : t("manager.messages.noMessageYet")}
                  </p>
                </div>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-slate-600 p-6 text-center">{t("manager.messages.noActiveContracts")}</p>
            )}
          </div>
          <div className="p-3 border-t border-slate-300 bg-white">
            <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
          </div>
        </div>

        {/* Zone de discussion */}
        <div
          className={`${
            selectedThreadId ? "flex" : "hidden md:flex"
          } flex-1 flex-col bg-white`}
        >
          {selectedThreadId && activeDetails ? (
            <>
              {/* En-tête de conversation */}
              <div className="px-4 md:px-6 py-4 border-b border-slate-300 flex flex-wrap items-center justify-between gap-3 bg-white">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedThreadId(null)}
                    aria-label={t("common.actions.back")}
                    className="md:hidden shrink-0 -ml-1 p-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    <ArrowLeft size={18} aria-hidden="true" />
                  </button>
                  <Initiales prenom={activeDetails.tenant?.firstName} nom={activeDetails.tenant?.lastName} />
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-sm truncate">
                      {activeDetails.tenant?.firstName} {activeDetails.tenant?.lastName}
                    </h3>
                    <p className="text-xs text-slate-600 truncate">
                      {activeDetails.property?.title} — {activeDetails.property?.address}
                    </p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 border border-slate-400 px-2.5 py-1 font-mono text-xs text-slate-800">
                  <Phone size={12} aria-hidden="true" className="text-orange-700" />
                  {activeDetails.tenant?.phone}
                </span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
                {loadingMessages && (
                  <p className="text-xs text-slate-600 text-center py-4">{t("manager.messages.loadingMessages")}</p>
                )}
                {messages.map((m) => {
                  const isMe = m.senderRole === "MANAGER";
                  return (
                    <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
                          {isMe ? t("manager.messages.you") : t("manager.messages.tenantParen", { name: activeDetails.tenant?.firstName })} •{" "}
                          {new Date(m.createdAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div
                        className={`max-w-md px-4 py-2.5 text-xs leading-relaxed ${
                          isMe
                            ? "bg-ink-900 text-white"
                            : "bg-white text-slate-800 border border-slate-300 shadow-[inset_3px_0_0_var(--color-orange-700)]"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
                {!loadingMessages && messages.length === 0 && (
                  <p className="text-xs text-slate-600 text-center py-12">
                    {t("manager.messages.noMessagesInThread")}
                  </p>
                )}
              </div>

              {/* Formulaire d'envoi */}
              <form onSubmit={handleSend} className="p-4 border-t border-slate-300 bg-white flex gap-2">
                <input
                  type="text"
                  aria-label={t("manager.messages.writeMessage")}
                  placeholder={t("manager.messages.writeMessage")}
                  value={newText}
                  maxLength={5000}
                  onChange={(e) => setNewText(e.target.value)}
                  className="flex-1 text-xs border border-slate-400 bg-white text-slate-900 px-4 py-2.5"
                />
                <button
                  type="submit"
                  disabled={sending || !newText.trim()}
                  className="inline-flex items-center gap-1.5 border border-ink-900 bg-ink-900 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-semibold px-5 py-2.5 transition-colors cursor-pointer"
                >
                  <Send size={13} aria-hidden="true" />
                  {sending ? t("manager.messages.sending") : t("manager.messages.send")}
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-slate-600 text-sm">
              <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" className="text-ink-900" />
              {t("manager.messages.selectDiscussion")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
