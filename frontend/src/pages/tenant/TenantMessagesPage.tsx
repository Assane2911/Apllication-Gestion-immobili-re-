import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { Conversation, Message } from "../../types";

export default function TenantMessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeContract, setActiveContract] = useState<any>(null);
  const [newText, setNewText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  function loadConversations() {
    api
      .get<Conversation[]>("/messages/conversations")
      .then((res) => {
        setConversations(res.data);
        if (res.data.length > 0 && !selectedContractId) {
          setSelectedContractId(res.data[0].contractId);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!selectedContractId) return;
    api.get(`/messages/${selectedContractId}`).then((res) => {
      setMessages(res.data.messages);
      setActiveContract(res.data.contract);
    });
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
          sender: { id: user?.id || "", email: user?.email || "", role: "TENANT" },
        },
      ]);
      setNewText("");
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <p className="text-slate-500 dark:text-slate-400 text-sm">Chargement de la messagerie...</p>;
  }

  if (conversations.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-slate-500 dark:text-slate-400 text-sm">Aucun contrat de location actif associé pour échanger des messages.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Échanges avec mon gestionnaire</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Discutez directement avec votre agence / bailleur</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden h-[600px] flex flex-col">
        {/* En-tête du chat */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Agence & Gestionnaire</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Logement : {activeContract?.property?.title || "Votre appartement"}
            </p>
          </div>
          <span className="text-xs bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            En ligne
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30 dark:bg-slate-950/20">
          {messages.map((m) => {
            const isMe = m.senderRole === "TENANT";
            return (
              <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">
                  {isMe ? "Vous" : "Gestionnaire"} •{" "}
                  {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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
          {messages.length === 0 && (
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-12">
              👋 Vous n'avez pas encore d'échanges. Posez une question à votre gestionnaire ci-dessous.
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
      </div>
    </div>
  );
}
