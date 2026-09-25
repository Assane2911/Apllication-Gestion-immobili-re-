import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, apiErrorMessage, isRequestCancelled, liste } from "../api/client";
import { useAuth } from "../context/auth";
import type { Conversation, Message, PaginatedResponse, Role } from "../types";

const CONVERSATIONS_PAGE_SIZE = 20;

interface UseConversationThreadOptions {
  /**
   * Recharge la liste des conversations après l'envoi d'un message (rafraîchit
   * l'aperçu du dernier message / le tri de la liste). Utile côté gestionnaire,
   * qui affiche cette liste ; inutile côté locataire, qui ne montre qu'un seul
   * fil de discussion à la fois.
   */
  refreshOnSend?: boolean;
}

/**
 * Logique partagée entre la messagerie du gestionnaire et celle du locataire :
 * chargement des conversations, chargement des messages du fil sélectionné,
 * et envoi d'un nouveau message. Les deux pages ne partagent que cet état et
 * ces effets — le rendu (mise en page, listes, formulaires) reste propre à
 * chacune.
 */
export function useConversationThread(role: Role, options: UseConversationThreadOptions = {}) {
  const { refreshOnSend = false } = options;
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeContract, setActiveContract] = useState<any>(null);
  const [newText, setNewText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadConversations(signal?: AbortSignal) {
    return api
      .get<PaginatedResponse<Conversation>>("/messages/conversations", {
        params: { page, pageSize: CONVERSATIONS_PAGE_SIZE },
        signal,
      })
      .then((res) => {
        const items = liste<Conversation>(res.data, "items");
        setConversations(items);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setSelectedContractId((current) => current ?? (items.length > 0 ? items[0].contractId : null));
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  // loadConversations lit selectedContractId via un setter fonctionnel (voir ci-dessus) plutôt
  // qu'une closure directe ; l'ajouter aux deps de l'effet ci-dessous redéclencherait un
  // rechargement à chaque sélection de conversation, alors qu'il ne doit tourner qu'au montage
  // ou quand la page change.
  useEffect(() => {
    const controller = new AbortController();
    loadConversations(controller.signal);
    return () => controller.abort();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (!selectedContractId) return;
    setLoadingMessages(true);
    api
      .get(`/messages/${selectedContractId}`)
      .then((res) => {
        setMessages(liste<Message>(res.data, "messages"));
        setActiveContract(res.data.contract);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoadingMessages(false));
  }, [selectedContractId]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!newText.trim() || !selectedContractId) return;
    setSending(true);
    try {
      const res = await api.post(`/messages/${selectedContractId}`, { content: newText.trim() });
      setMessages((prev) => [
        ...prev,
        {
          ...res.data,
          sender: { id: user?.id || "", email: user?.email || "", role },
        },
      ]);
      setNewText("");
      if (refreshOnSend) loadConversations();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return {
    conversations,
    page,
    setPage,
    total,
    totalPages,
    selectedContractId,
    setSelectedContractId,
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
  };
}
