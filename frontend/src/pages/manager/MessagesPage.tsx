import { ArrowLeft, Mail, MessageSquare, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import FilDeMessages from "../../components/FilDeMessages";
import Initiales from "../../components/Initiales";
import Pagination from "../../components/Pagination";
import PlanLogement from "../../components/PlanLogement";
import ZoneDeSaisie from "../../components/ZoneDeSaisie";
import { useCurrency } from "../../context/currency";
import { cleDuFil, useConversationThread } from "../../hooks/useConversationThread";

const PAGE_SIZE = 20;
function EnteteDeFiche({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
    </h4>
  );
}

export default function MessagesPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
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

  const conversationActive = conversations.find((c) => cleDuFil(c) === selectedThreadId);
  const rangActif = conversationActive ? conversations.indexOf(conversationActive) : -1;
  const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(i18n.language) : "—");

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

      <div className="flex h-[70vh] flex-col overflow-hidden border border-ink-900 bg-white md:h-[calc(100vh-17rem)] md:min-h-[560px] md:flex-row">
        {/* 1 · Index des fils : une ligne numérotée par locataire. */}
        <div
          className={`${selectedThreadId ? "hidden md:flex" : "flex"} w-full flex-col border-slate-300 bg-slate-50 md:w-80 md:shrink-0 md:border-r`}
        >
          <div className="border-b border-ink-900 bg-ink-900 px-4 py-3 text-white">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider">{t("manager.messages.ongoingDiscussions")}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-white/80">{t("manager.messages.conversationCount", { count: total })}</p>
          </div>
          <div className="flex-1 divide-y divide-slate-300 overflow-y-auto">
            {conversations.map((c, rang) => {
              const actif = selectedThreadId === cleDuFil(c);
              const nonLu = !actif && c.lastMessage?.senderRole === "TENANT" && c.lastMessage.isRead === false;
              return (
                <button
                  key={cleDuFil(c)}
                  onClick={() => setSelectedThreadId(cleDuFil(c))}
                  className={`flex w-full cursor-pointer items-start gap-3 p-4 text-left transition-colors ${
                    actif ? "bg-white shadow-[inset_3px_0_0_var(--color-orange-700)]" : "hover:bg-white"
                  }`}
                >
                  <span aria-hidden="true" className="w-5 shrink-0 pt-1 font-mono text-[10px] text-slate-500">
                    {String((page - 1) * PAGE_SIZE + rang + 1).padStart(2, "0")}
                  </span>
                  <Initiales prenom={c.tenant?.firstName} nom={c.tenant?.lastName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-900">
                      {c.tenant?.firstName} {c.tenant?.lastName}
                      {c.qualite === "COLOCATAIRE" && (
                        <span className="ml-1.5 border border-slate-400 px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase tracking-wider text-slate-700">
                          {t("manager.messages.cotenant")}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-slate-600">{c.property?.title}</p>
                    <p className={`mt-1 truncate text-[11px] ${nonLu ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {c.lastMessage ? c.lastMessage.content : t("manager.messages.noMessageYet")}
                    </p>
                  </div>
                  {nonLu && (
                    <span role="img" aria-label={t("manager.messages.unread")} className="mt-1.5 h-2 w-2 shrink-0 bg-orange-700" />
                  )}
                </button>
              );
            })}
            {conversations.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-600">{t("manager.messages.noActiveContracts")}</p>
            )}
          </div>
          <div className="border-t border-slate-300 bg-white p-3">
            <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
          </div>
        </div>

        {/* 2 · Le fil : messages regroupés par jour et par bloc, saisie en pied. */}
        <div className={`${selectedThreadId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-white`}>
          {selectedThreadId && activeDetails ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 px-4 py-4 md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedThreadId(null)}
                    aria-label={t("common.actions.back")}
                    className="-ml-1 shrink-0 cursor-pointer p-1.5 text-slate-700 hover:bg-slate-100 md:hidden"
                  >
                    <ArrowLeft size={18} aria-hidden="true" />
                  </button>
                  <Initiales prenom={activeDetails.tenant?.firstName} nom={activeDetails.tenant?.lastName} />
                  <div className="min-w-0">
                    {rangActif >= 0 && (
                      <p aria-hidden="true" className="font-mono text-[10px] uppercase tracking-wider text-orange-700">
                        {t("common.sheet")} {String((page - 1) * PAGE_SIZE + rangActif + 1).padStart(2, "0")}
                      </p>
                    )}
                    <h3 className="truncate text-sm font-bold text-slate-900">
                      {activeDetails.tenant?.firstName} {activeDetails.tenant?.lastName}
                    </h3>
                    <p className="truncate text-xs text-slate-600">
                      {activeDetails.property?.title} — {activeDetails.property?.address}
                    </p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 border border-slate-400 px-2.5 py-1 font-mono text-xs text-slate-800 xl:hidden">
                  <Phone size={12} aria-hidden="true" className="text-orange-700" />
                  {activeDetails.tenant?.phone}
                </span>
              </div>

              <FilDeMessages
                messages={messages}
                roleMoi="MANAGER"
                libelleMoi={t("manager.messages.you")}
                libelleAutre={t("manager.messages.tenantParen", { name: activeDetails.tenant?.firstName })}
                libelleLu={t("manager.messages.read")}
                libelleEnvoye={t("manager.messages.sent")}
                chargement={loadingMessages}
                libelleChargement={t("manager.messages.loadingMessages")}
                libelleVide={t("manager.messages.noMessagesInThread")}
              />

              <ZoneDeSaisie
                valeur={newText}
                onChange={setNewText}
                onSubmit={handleSend}
                envoi={sending}
                libelleChamp={t("manager.messages.writeMessage")}
                libelleEnvoyer={t("manager.messages.send")}
                libelleEnvoi={t("manager.messages.sending")}
                indice={t("manager.messages.sendHint")}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-slate-600">
              <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" className="text-ink-900" />
              {t("manager.messages.selectDiscussion")}
            </div>
          )}
        </div>

        {/* 3 · Fiche du bail : tout ce qu'il faut savoir sur l'interlocuteur sans quitter le fil (grands écrans). */}
        {selectedThreadId && activeDetails && (
          <aside
            aria-label={t("manager.messages.fiche.title")}
            className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-300 bg-white xl:flex"
          >
            <PlanLogement id={activeDetails.property?.id ?? selectedThreadId} className="h-28 w-full shrink-0 border-b border-slate-300" />
            <div className="space-y-5 p-4">
              <section>
                <EnteteDeFiche>{t("manager.messages.fiche.property")}</EnteteDeFiche>
                <p className="text-sm font-semibold text-slate-900">{activeDetails.property?.title}</p>
                <p className="mt-0.5 text-xs text-slate-600">{activeDetails.property?.address}</p>
              </section>

              <section>
                <EnteteDeFiche>{t("manager.messages.fiche.contact")}</EnteteDeFiche>
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">
                  {activeDetails.tenant?.firstName} {activeDetails.tenant?.lastName}
                  {conversationActive?.qualite === "COLOCATAIRE" && (
                    <span className="border border-slate-400 px-1.5 py-0.5 font-mono text-[10px] font-normal uppercase tracking-wider text-slate-700">
                      {t("manager.messages.cotenant")}
                    </span>
                  )}
                </p>
                <ul className="mt-2 space-y-1.5 text-xs">
                  {activeDetails.tenant?.phone && (
                    <li className="flex items-center gap-2">
                      <Phone size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                      <a
                        href={`tel:${String(activeDetails.tenant.phone).replace(/\s+/g, "")}`}
                        className="border-b border-ink-900/40 font-mono text-slate-900 hover:border-orange-700 hover:text-orange-700"
                      >
                        {activeDetails.tenant.phone}
                      </a>
                    </li>
                  )}
                  {activeDetails.tenant?.email && (
                    <li className="flex items-center gap-2">
                      <Mail size={13} aria-hidden="true" className="shrink-0 text-orange-700" />
                      <a
                        href={`mailto:${activeDetails.tenant.email}`}
                        className="min-w-0 truncate border-b border-ink-900/40 font-mono text-slate-900 hover:border-orange-700 hover:text-orange-700"
                      >
                        {activeDetails.tenant.email}
                      </a>
                    </li>
                  )}
                </ul>
              </section>

              <section>
                <EnteteDeFiche>{t("manager.messages.fiche.lease")}</EnteteDeFiche>
                <dl className="divide-y divide-slate-300 border border-slate-300 text-xs">
                  <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.messages.fiche.rent")}</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {activeDetails.rent != null ? formatMoney(activeDetails.rent, activeDetails.currency) : "—"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.messages.fiche.period")}</dt>
                    <dd className="text-right tabular-nums text-slate-900">
                      {formatDate(activeDetails.startDate)} → {formatDate(activeDetails.endDate)}
                    </dd>
                  </div>
                  {activeDetails.status && (
                    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.messages.fiche.status")}</dt>
                      <dd className="font-semibold text-slate-900">{t(`common.status.${activeDetails.status}`, { defaultValue: activeDetails.status })}</dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="flex flex-col items-start gap-2 text-xs font-semibold">
                <Link
                  to="/contracts"
                  className="border-b border-ink-900/40 pb-0.5 text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
                >
                  {t("manager.messages.fiche.openContracts")}
                </Link>
                <Link
                  to="/tenants"
                  className="border-b border-ink-900/40 pb-0.5 text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
                >
                  {t("manager.messages.fiche.openTenants")}
                </Link>
              </section>

              <p className="border-t border-slate-300 pt-3 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                {t("manager.messages.fiche.messageCount", { count: messages.length })}
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
