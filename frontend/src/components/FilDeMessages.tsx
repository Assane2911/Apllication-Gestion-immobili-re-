import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Message, Role } from "../types";
import { debutDeJour, libelleDuJour } from "../utils/libelleDuJour";

/** Deux messages du même auteur à moins de cinq minutes l'un de l'autre forment un seul bloc. */
const FENETRE_GROUPE_MS = 5 * 60 * 1000;

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

interface Props {
  messages: Message[];
  /** Rôle de la personne qui lit : ses messages sont à droite, en bleu plein. */
  roleMoi: Role;
  libelleMoi: string;
  libelleAutre: string;
  libelleLu: string;
  libelleEnvoye: string;
  chargement: boolean;
  libelleChargement: string;
  libelleVide: string;
  className?: string;
}

/**
 * Le fil d'une conversation : messages regroupés par jour (filet de date) et par bloc d'un même auteur, heure et état
 * « Envoyé / Lu » dans chaque bulle, ouverture sur le message le plus récent. Commun aux messageries du gestionnaire et du
 * locataire.
 */
export default function FilDeMessages({
  messages,
  roleMoi,
  libelleMoi,
  libelleAutre,
  libelleLu,
  libelleEnvoye,
  chargement,
  libelleChargement,
  libelleVide,
  className = "",
}: Props) {
  const { i18n } = useTranslation();
  const defilement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const zone = defilement.current;
    if (zone) zone.scrollTop = zone.scrollHeight;
  }, [messages]);
  const lignes = useMemo(() => composerLignes(messages, i18n.language), [messages, i18n.language]);

  return (
    <div ref={defilement} className={`flex-1 overflow-y-auto bg-slate-50 px-4 py-5 md:px-6 ${className}`}>
      {chargement && <p className="py-4 text-center text-xs text-slate-600">{libelleChargement}</p>}
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
        const isMe = m.senderRole === roleMoi;
        const heure = new Date(m.createdAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
        return (
          <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${ligne.debutDeBloc ? "mt-4" : "mt-1"}`}>
            {ligne.debutDeBloc && (
              <span className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">{isMe ? libelleMoi : libelleAutre}</span>
            )}
            <div
              className={`max-w-[85%] px-4 py-2.5 text-xs leading-relaxed md:max-w-md ${
                isMe ? "bg-ink-900 text-white" : "border border-slate-300 bg-white text-slate-800 shadow-[inset_3px_0_0_var(--color-orange-700)]"
              }`}
            >
              <p className="whitespace-pre-wrap wrap-break-word">{m.content}</p>
              <p className={`mt-1 text-right font-mono text-[10px] ${isMe ? "text-white/70" : "text-slate-500"}`}>
                {heure}
                {isMe && ` · ${m.isRead ? libelleLu : libelleEnvoye}`}
              </p>
            </div>
          </div>
        );
      })}
      {!chargement && messages.length === 0 && <p className="py-12 text-center text-xs text-slate-600">{libelleVide}</p>}
    </div>
  );
}
