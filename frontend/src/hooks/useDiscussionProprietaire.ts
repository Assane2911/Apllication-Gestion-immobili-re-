import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, isRequestCancelled, liste } from "../api/client";
import { useAuth } from "../context/auth";
import type { ConversationProprietaire, Message, PaginatedResponse } from "../types";
import { ajouterSiAbsent, fusionnerFil } from "../utils/fusionFil";
import { extensionEnregistrement } from "../utils/messageVocal";
import { useActualisationFil, useRafraichissementPeriodique } from "./useActualisationFil";
import type { EnregistrementVocal } from "./useEnregistreurVocal";

const PAGE_SIZE = 20;

type InterlocuteurActif = ConversationProprietaire["owner"];

/**
 * Logique de la discussion agence ↔ propriétaire, pour les deux côtés :
 *  - « MANAGER » : la liste des fils de l'agence (un par propriétaire), le fil choisi, l'envoi de texte et de vocaux ;
 *  - « OWNER » : son fil unique avec l'agence (le serveur l'identifie par son compte, aucun identifiant à fournir).
 * Le rendu (liste, en-tête, réponses rapides) reste propre à chaque page ; le fil et la saisie sont ceux de la
 * messagerie des locataires (FilDeMessages, ZoneDeSaisie).
 */
export function useDiscussionProprietaire(role: "MANAGER" | "OWNER") {
  const { user } = useAuth();
  const gestionnaire = role === "MANAGER";
  const [conversations, setConversations] = useState<ConversationProprietaire[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeOwner, setActiveOwner] = useState<InterlocuteurActif | null>(null);
  const [newText, setNewText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(!gestionnaire);
  const [error, setError] = useState<string | null>(null);

  function loadConversations(signal?: AbortSignal) {
    if (!gestionnaire) return Promise.resolve();
    return api
      .get<PaginatedResponse<ConversationProprietaire>>("/owner-messages/conversations", { params: { page, pageSize: PAGE_SIZE }, signal })
      .then((res) => {
        const items = liste<ConversationProprietaire>(res.data, "items");
        setConversations(items);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setSelectedOwnerId((courant) => courant ?? (items.length > 0 ? items[0].id : null));
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setError(apiErrorMessage(err));
        setLoading(false);
      });
  }

  // La liste ne se recharge qu'au montage et au changement de page, pas à chaque sélection (voir useConversationThread).
  useEffect(() => {
    if (!gestionnaire) return;
    const controller = new AbortController();
    loadConversations(controller.signal);
    return () => controller.abort();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [page, gestionnaire]);

  /** Adresse du fil : celui du propriétaire choisi (gestionnaire) ou le sien (propriétaire). Nulle tant que rien n'est choisi. */
  const adresse = gestionnaire ? (selectedOwnerId ? `/owner-messages/${selectedOwnerId}` : null) : "/owner-messages/mine";

  useEffect(() => {
    if (!adresse) {
      if (!gestionnaire) return;
      setMessages([]);
      setActiveOwner(null);
      return;
    }
    // Sans annulation, passer vite d'un fil à l'autre affichait les messages du premier sous l'en-tête du second.
    const controller = new AbortController();
    setLoadingMessages(true);
    api
      .get(adresse, { signal: controller.signal })
      .then((res) => {
        setMessages(liste<Message>(res.data, "messages"));
        setActiveOwner(res.data.owner ?? null);
        setLoadingMessages(false);
        if (gestionnaire) {
          // Ouvrir le fil marque ses messages lus côté serveur : la pastille de la liste suit sans recharger.
          setConversations((prev) => prev.map((c) => (c.id === selectedOwnerId ? { ...c, unreadCount: 0 } : c)));
          setError(null);
        }
      })
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        setError(apiErrorMessage(err));
        setLoadingMessages(false);
        setLoading(false);
      });
    return () => controller.abort();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [adresse]);

  // Côté propriétaire il n'y a pas de liste : le chargement du fil tient lieu de chargement de page.
  useEffect(() => {
    if (!gestionnaire && !loadingMessages) setLoading(false);
  }, [gestionnaire, loadingMessages]);

  const auteur = () => ({ id: user?.id || "", email: user?.email || "", role });

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!newText.trim() || !adresse) return;
    setSending(true);
    try {
      const res = await api.post(adresse, { content: newText.trim() });
      setMessages((prev) => ajouterSiAbsent(prev, { ...res.data, sender: auteur() }));
      setNewText("");
      if (gestionnaire) loadConversations();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  /** Envoie un message vocal dans le fil. Rejette en cas d'échec : la zone de saisie garde alors l'enregistrement. */
  async function handleSendVoice(enregistrement: EnregistrementVocal) {
    if (!adresse) return;
    const donnees = new FormData();
    donnees.append("audio", enregistrement.blob, `vocal.${extensionEnregistrement(enregistrement.type)}`);
    donnees.append("durationSec", String(enregistrement.duree));
    const res = await api.post(`${adresse}/audio`, donnees, { timeout: DELAI_UPLOAD_MS });
    setMessages((prev) => ajouterSiAbsent(prev, { ...res.data, sender: auteur() }));
    if (gestionnaire) loadConversations();
  }

  // Le fil ouvert se met à jour tout seul (nouveaux messages, état « Lu »), sans rechargement de la page.
  useActualisationFil({
    adresse,
    dernierId: messages.length > 0 ? messages[messages.length - 1].id : null,
    actif: !loadingMessages,
    surReponse: ({ messages: recus, luesIds }) => setMessages((prev) => fusionnerFil(prev, recus, luesIds)),
    surNouveau: gestionnaire ? () => void loadConversations() : undefined,
  });
  useRafraichissementPeriodique(() => loadConversations(), gestionnaire);

  return {
    conversations,
    page,
    setPage,
    total,
    totalPages,
    selectedOwnerId,
    setSelectedOwnerId,
    messages,
    activeOwner,
    newText,
    setNewText,
    sending,
    loading,
    loadingMessages,
    error,
    loadConversations,
    handleSend,
    handleSendVoice,
    pageSize: PAGE_SIZE,
  };
}
