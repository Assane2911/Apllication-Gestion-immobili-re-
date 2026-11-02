import { ArrowLeft, MessageSquare, Mic, Search, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import FilDeMessages from "../../components/FilDeMessages";
import Initiales from "../../components/Initiales";
import OngletsMessagerie from "../../components/OngletsMessagerie";
import Pagination from "../../components/Pagination";
import ZoneDeSaisie from "../../components/ZoneDeSaisie";
import { useDiscussionProprietaire } from "../../hooks/useDiscussionProprietaire";
import { estVocal, formaterDuree } from "../../utils/messageVocal";
import { correspond } from "../../utils/recherche";

const REPONSES_RAPIDES = ["crg", "payout", "document", "thanks"] as const;

/**
 * Messagerie du gestionnaire avec les propriétaires de ses biens : un fil par propriétaire qui a accès à son espace, en
 * texte et en message vocal. Même fil et même saisie que la messagerie des locataires ; la liste est celle des
 * propriétaires, le plus récemment actif d'abord.
 */
export default function OwnerMessagesPage() {
  const { t } = useTranslation();
  const {
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
    pageSize,
  } = useDiscussionProprietaire("MANAGER");

  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<"all" | "unread">("all");
  const nbNonLues = conversations.filter((c) => c.unreadCount > 0).length;
  const visibles = conversations.filter(
    (c) => (filtre === "all" || c.unreadCount > 0) && correspond(recherche, c.owner.firstName, c.owner.lastName, c.owner.companyName)
  );
  const conversationActive = conversations.find((c) => c.id === selectedOwnerId);
  const rangActif = conversationActive ? conversations.indexOf(conversationActive) : -1;
  const nomActif = activeOwner?.displayName ?? conversationActive?.owner.displayName ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{t("manager.ownerMessages.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("manager.ownerMessages.subtitle")}</p>
      </div>
      <OngletsMessagerie />

      {error && (
        <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span>{error}</span>
          <button onClick={() => loadConversations()} className="shrink-0 whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      <div className="flex h-[70vh] flex-col overflow-hidden border border-ink-900 bg-white md:h-[calc(100vh-20rem)] md:min-h-[520px] md:flex-row">
        {/* 1 · Index des fils : une ligne numérotée par propriétaire. */}
        <div className={`${selectedOwnerId ? "hidden md:flex" : "flex"} w-full flex-col border-slate-300 bg-slate-50 md:w-80 md:shrink-0 md:border-r`}>
          <div className="border-b border-ink-900 bg-ink-900 px-4 py-3 text-white">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider">{t("manager.ownerMessages.ongoingDiscussions")}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-white/80">
              {t("manager.ownerMessages.conversationCount", { count: total })}
              {nbNonLues > 0 && ` · ${t("manager.ownerMessages.unreadCount", { count: nbNonLues })}`}
            </p>
          </div>
          <div className="space-y-2 border-b border-slate-300 bg-white p-3">
            <div className="relative">
              <label htmlFor="proprietaires-recherche" className="sr-only">{t("manager.ownerMessages.search")}</label>
              <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="proprietaires-recherche"
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={t("manager.ownerMessages.search")}
                className="w-full border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-xs text-slate-900 [&::-webkit-search-cancel-button]:hidden"
              />
              {recherche && (
                <button
                  type="button"
                  onClick={() => setRecherche("")}
                  aria-label={t("manager.liste.clearSearch")}
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center text-slate-500 hover:text-ink-900"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
            <div role="group" aria-label={t("manager.ownerMessages.filtersLabel")} className="flex border border-slate-400">
              {(["all", "unread"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filtre === f}
                  onClick={() => setFiltre(f)}
                  className={`flex-1 cursor-pointer border-r border-slate-400 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 ${
                    filtre === f ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100"
                  }`}
                >
                  {t(`manager.ownerMessages.filters.${f}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 divide-y divide-slate-300 overflow-y-auto">
            {visibles.map((c, rang) => {
              const actif = selectedOwnerId === c.id;
              const nonLu = !actif && c.unreadCount > 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedOwnerId(c.id)}
                  className={`flex w-full cursor-pointer items-start gap-3 p-4 text-left transition-colors ${
                    actif ? "bg-white shadow-[inset_3px_0_0_var(--color-orange-700)]" : "hover:bg-white"
                  }`}
                >
                  <span aria-hidden="true" className="w-5 shrink-0 pt-1 font-mono text-[10px] text-slate-500">
                    {String((page - 1) * pageSize + rang + 1).padStart(2, "0")}
                  </span>
                  <Initiales prenom={c.owner.firstName} nom={c.owner.lastName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-900">{c.owner.displayName}</p>
                    <p className={`mt-1 truncate text-[11px] ${nonLu ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {c.lastMessage ? (
                        estVocal(c.lastMessage) ? (
                          <>
                            <Mic size={11} aria-hidden="true" className="mr-1 inline align-[-1px]" />
                            {t("voice.label")} ({formaterDuree(c.lastMessage.audioDurationSec ?? 0)})
                          </>
                        ) : (
                          c.lastMessage.content
                        )
                      ) : (
                        t("manager.ownerMessages.noMessageYet")
                      )}
                    </p>
                  </div>
                  {nonLu && <span role="img" aria-label={t("manager.ownerMessages.unread")} className="mt-1.5 h-2 w-2 shrink-0 bg-orange-700" />}
                </button>
              );
            })}
            {!loading && conversations.length === 0 && (
              <div className="space-y-3 p-6 text-center text-xs text-slate-600">
                <p>{t("manager.ownerMessages.noOwners")}</p>
                <Link to="/proprietaires" className="inline-block border-b border-ink-900/40 font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
                  {t("manager.ownerMessages.openOwners")}
                </Link>
              </div>
            )}
            {conversations.length > 0 && visibles.length === 0 && <p className="p-6 text-center text-xs text-slate-600">{t("manager.ownerMessages.noMatch")}</p>}
          </div>
          <div className="border-t border-slate-300 bg-white p-3">
            <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
          </div>
        </div>

        {/* 2 · Le fil : messages regroupés par jour et par bloc, saisie en pied. */}
        <div className={`${selectedOwnerId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-white`}>
          {selectedOwnerId && conversationActive ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 px-4 py-4 md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedOwnerId(null)}
                    aria-label={t("common.actions.back")}
                    className="-ml-1 shrink-0 cursor-pointer p-1.5 text-slate-700 hover:bg-slate-100 md:hidden"
                  >
                    <ArrowLeft size={18} aria-hidden="true" />
                  </button>
                  <Initiales prenom={conversationActive.owner.firstName} nom={conversationActive.owner.lastName} />
                  <div className="min-w-0">
                    {rangActif >= 0 && (
                      <p aria-hidden="true" className="font-mono text-[10px] uppercase tracking-wider text-orange-700">
                        {t("common.sheet")} {String((page - 1) * pageSize + rangActif + 1).padStart(2, "0")}
                      </p>
                    )}
                    <h3 className="truncate text-sm font-bold text-slate-900">{nomActif}</h3>
                  </div>
                </div>
                <Link
                  to={`/proprietaires/${conversationActive.owner.id}/crg`}
                  className="shrink-0 border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
                >
                  {t("manager.ownerMessages.crgLink")}
                </Link>
              </div>

              <FilDeMessages
                messages={messages}
                roleMoi="MANAGER"
                libelleMoi={t("manager.ownerMessages.you")}
                libelleAutre={t("manager.ownerMessages.ownerParen", { name: conversationActive.owner.firstName })}
                libelleLu={t("manager.ownerMessages.read")}
                libelleEnvoye={t("manager.ownerMessages.sent")}
                chargement={loadingMessages}
                libelleChargement={t("manager.ownerMessages.loadingMessages")}
                libelleVide={t("manager.ownerMessages.noMessagesInThread")}
              />

              <div role="group" aria-label={t("manager.ownerMessages.quick.label")} className="flex flex-wrap items-center gap-2 border-t border-slate-300 bg-slate-50 px-4 py-2.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.ownerMessages.quick.label")}</span>
                {REPONSES_RAPIDES.map((cle) => (
                  <button
                    key={cle}
                    type="button"
                    onClick={() => {
                      const texte = t(`manager.ownerMessages.quick.${cle}Text`);
                      setNewText(newText.trim() ? `${newText.trimEnd()} ${texte}` : texte);
                    }}
                    className="cursor-pointer border border-slate-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition-colors hover:border-ink-900 hover:text-ink-900"
                  >
                    {t(`manager.ownerMessages.quick.${cle}`)}
                  </button>
                ))}
              </div>

              <ZoneDeSaisie
                valeur={newText}
                onChange={setNewText}
                onSubmit={handleSend}
                onEnvoyerVocal={handleSendVoice}
                envoi={sending}
                libelleChamp={t("manager.ownerMessages.writeMessage")}
                libelleEnvoyer={t("manager.ownerMessages.send")}
                libelleEnvoi={t("manager.ownerMessages.sending")}
                indice={t("manager.ownerMessages.sendHint")}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-slate-600">
              <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" className="text-ink-900" />
              {t("manager.ownerMessages.selectDiscussion")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
