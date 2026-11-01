import { ArrowLeft, Mail, MessageSquare, Phone, Send } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import Initiales from "../../components/Initiales";
import Pagination from "../../components/Pagination";
import PlanLogement from "../../components/PlanLogement";
import { useCurrency } from "../../context/currency";
import { cleDuFil, useConversationThread } from "../../hooks/useConversationThread";
import type { Message } from "../../types";

const PAGE_SIZE = 20;
const LONGUEUR_MAX = 5000;
/** Deux messages du même auteur à moins de cinq minutes l'un de l'autre forment un seul bloc. */
const FENETRE_GROUPE_MS = 5 * 60 * 1000;

function debutDeJour(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** « Aujourd'hui », « hier », sinon « jeudi 30 octobre » (l'année n'apparaît que si elle n'est pas l'année courante). */
function libelleDuJour(iso: string, langue: string): string {
  const date = new Date(iso);
  const maintenant = new Date();
  const ecart = Math.round((debutDeJour(date) - debutDeJour(maintenant)) / 86_400_000);
  if (ecart === 0 || ecart === -1) {
    const relatif = new Intl.RelativeTimeFormat(langue, { numeric: "auto" }).format(ecart, "day");
    return relatif.charAt(0).toLocaleUpperCase(langue) + relatif.slice(1);
  }
  return date.toLocaleDateString(langue, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== maintenant.getFullYear() ? { year: "numeric" as const } : {}),
  });
}

type Ligne =
  | { genre: "jour"; cle: string; libelle: string }
  | { genre: "message"; message: Message; debutDeBloc: boolean };

/** Intercale un filet de date à chaque changement de jour et repère le premier message de chaque bloc. */
function composerLignes(messages: Message[], langue: string): Ligne[] {
  const lignes: Ligne[] = [];
  let precedent: Message | null = null;
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const nouveauJour = !precedent || debutDeJour(new Date(precedent.createdAt)) !== debutDeJour(date);
    if (nouveauJour) lignes.push({ genre: "jour", cle: `jour-${message.id}`, libelle: libelleDuJour(message.createdAt, langue) });
    const memeBloc =
      !nouveauJour &&
      precedent !== null &&
      precedent.senderRole === message.senderRole &&
      date.getTime() - new Date(precedent.createdAt).getTime() < FENETRE_GROUPE_MS;
    lignes.push({ genre: "message", message, debutDeBloc: !memeBloc });
    precedent = message;
  }
  return lignes;
}

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

  // Le fil s'ouvre toujours sur le message le plus récent.
  const defilement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const zone = defilement.current;
    if (zone) zone.scrollTop = zone.scrollHeight;
  }, [messages, selectedThreadId]);

  const conversationActive = conversations.find((c) => cleDuFil(c) === selectedThreadId);
  const rangActif = conversationActive ? conversations.indexOf(conversationActive) : -1;
  const lignes = composerLignes(messages, i18n.language);
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

              <div ref={defilement} className="flex-1 overflow-y-auto bg-slate-50 px-4 py-5 md:px-6">
                {loadingMessages && (
                  <p className="py-4 text-center text-xs text-slate-600">{t("manager.messages.loadingMessages")}</p>
                )}
                {lignes.map((ligne) => {
                  if (ligne.genre === "jour") {
                    return (
                      <div key={ligne.cle} className="my-5 flex items-center gap-3 first:mt-0">
                        <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
                        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{ligne.libelle}</span>
                        <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
                      </div>
                    );
                  }
                  const m = ligne.message;
                  const isMe = m.senderRole === "MANAGER";
                  const heure = new Date(m.createdAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${ligne.debutDeBloc ? "mt-4" : "mt-1"}`}>
                      {ligne.debutDeBloc && (
                        <span className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                          {isMe ? t("manager.messages.you") : t("manager.messages.tenantParen", { name: activeDetails.tenant?.firstName })}
                        </span>
                      )}
                      <div
                        className={`max-w-[85%] px-4 py-2.5 text-xs leading-relaxed md:max-w-md ${
                          isMe
                            ? "bg-ink-900 text-white"
                            : "border border-slate-300 bg-white text-slate-800 shadow-[inset_3px_0_0_var(--color-orange-700)]"
                        }`}
                      >
                        <p className="whitespace-pre-wrap wrap-break-word">{m.content}</p>
                        <p className={`mt-1 text-right font-mono text-[10px] ${isMe ? "text-white/70" : "text-slate-500"}`}>
                          {heure}
                          {isMe && ` · ${m.isRead ? t("manager.messages.read") : t("manager.messages.sent")}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {!loadingMessages && messages.length === 0 && (
                  <p className="py-12 text-center text-xs text-slate-600">{t("manager.messages.noMessagesInThread")}</p>
                )}
              </div>

              <form onSubmit={handleSend} className="border-t border-slate-300 bg-white p-4">
                <textarea
                  rows={2}
                  aria-label={t("manager.messages.writeMessage")}
                  placeholder={t("manager.messages.writeMessage")}
                  value={newText}
                  maxLength={LONGUEUR_MAX}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => {
                    // Entrée envoie, Maj+Entrée passe à la ligne ; on ne touche pas à la saisie en cours de composition (IME).
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!sending && newText.trim()) e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="block w-full resize-none border border-slate-400 bg-white px-4 py-2.5 text-xs text-slate-900"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="hidden font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:block">{t("manager.messages.sendHint")}</p>
                  <div className="ml-auto flex items-center gap-3">
                    <span
                      className={`font-mono text-[10px] tabular-nums ${newText.length > LONGUEUR_MAX - 500 ? "text-rose-700" : "text-slate-500"}`}
                    >
                      {newText.length} / {LONGUEUR_MAX}
                    </span>
                    <button
                      type="submit"
                      disabled={sending || !newText.trim()}
                      className="inline-flex cursor-pointer items-center gap-1.5 border border-ink-900 bg-ink-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                    >
                      <Send size={13} aria-hidden="true" />
                      {sending ? t("manager.messages.sending") : t("manager.messages.send")}
                    </button>
                  </div>
                </div>
              </form>
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
