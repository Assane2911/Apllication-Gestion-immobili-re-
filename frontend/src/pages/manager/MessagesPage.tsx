import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { Conversation, Message } from "../../types";

export default function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeDetails, setActiveDetails] = useState<any>(null);
  const [newText, setNewText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  function loadConversations() {
    api.get<Conversation[]>("/messages/conversations").then((res) => {
      setConversations(res.data);
      if (!selectedContractId && res.data.length > 0) {
        setSelectedContractId(res.data[0].contractId);
      }
    });
  }

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!selectedContractId) return;
    setLoadingMessages(true);
    api
      .get(`/messages/${selectedContractId}`)
      .then((res) => {
        setMessages(res.data.messages);
        setActiveDetails(res.data.contract);
      })
      .finally(() => setLoadingMessages(false));
  }, [selectedContractId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim() || !selectedContractId) return;
    setSending(true);
    try {
      const res = await api.post(`/messages/${selectedContractId}`, { content: newText.trim() });
      setMessages((prev) => [
        ...prev,
        {
          ...res.data,
          sender: { id: user?.id || "", email: user?.email || "", role: "MANAGER" },
        },
      ]);
      setNewText("");
      loadConversations();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Messagerie & Échanges</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Discussions directes avec vos locataires par contrat</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden h-[680px] flex">
        {/* Liste des conversations */}
        <div className="w-80 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-950/40">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Discussions en cours</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">{conversations.length} conversation(s)</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {conversations.map((c) => (
              <button
                key={c.contractId}
                onClick={() => setSelectedContractId(c.contractId)}
                className={`w-full text-left p-4 transition-colors flex items-start gap-3 ${
                  selectedContractId === c.contractId
                    ? "bg-brand-50 dark:bg-brand-500/10 border-l-4 border-brand-600 dark:border-brand-400"
                    : "hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold text-xs shrink-0">
                  {c.tenant?.firstName?.[0] || "L"}
                  {c.tenant?.lastName?.[0] || ""}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                    {c.tenant?.firstName} {c.tenant?.lastName}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{c.property?.title}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-1">
                    {c.lastMessage ? c.lastMessage.content : "Aucun message pour le moment"}
                  </p>
                </div>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 p-6 text-center">Aucun contrat ou locataire actif.</p>
            )}
          </div>
        </div>

        {/* Zone de discussion */}
        <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
          {selectedContractId && activeDetails ? (
            <>
              {/* En-tête de conversation */}
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/40">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {activeDetails.tenant?.firstName} {activeDetails.tenant?.lastName}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeDetails.property?.title} — {activeDetails.property?.address}
                  </p>
                </div>
                <span className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2.5 py-1 rounded-full font-medium">
                  {activeDetails.tenant?.phone}
                </span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30 dark:bg-slate-950/20">
                {loadingMessages && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">Chargement des messages...</p>
                )}
                {messages.map((m) => {
                  const isMe = m.senderRole === "MANAGER";
                  return (
                    <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {isMe ? "Vous (Agence)" : `${activeDetails.tenant?.firstName} (Locataire)`} •{" "}
                          {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
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
                    💬 Aucun message dans ce fil. Commencez la conversation avec votre locataire ci-dessous.
                  </p>
                )}
              </div>

              {/* Formulaire d'envoi */}
              <form onSubmit={handleSend} className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-2">
                <input
                  type="text"
                  placeholder="Écrivez votre message..."
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  className="flex-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={sending || !newText.trim()}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-colors cursor-pointer"
                >
                  {sending ? "..." : "Envoyer"}
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
              Sélectionnez une discussion à gauche pour commencer à échanger.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
