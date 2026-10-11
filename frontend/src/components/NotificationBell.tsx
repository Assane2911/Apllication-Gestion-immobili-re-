import { AlertTriangle, Bell, CalendarClock, MessageSquare, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, isRequestCancelled, liste } from "../api/client";
import type { NotificationItem, NotificationType } from "../types";
import Bulle from "./Bulle";

const iconByType: Record<NotificationType, typeof Bell> = {
  message: MessageSquare,
  invoice: AlertTriangle,
  issue: Wrench,
  contract_ending: CalendarClock,
};

const severityDot: Record<string, string> = {
  info: "bg-brand-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

const POLL_INTERVAL_MS = 30_000;

interface NotificationBellProps {
  /** Route de l'API à interroger — un centre de notifications différent par portail (voir notification.controller.ts). */
  endpoint?: string;
  /** Préfixe i18n des libellés affichés (tip, titre, "tout est à jour"...), un jeu de clés distinct par portail. */
  i18nPrefix?: string;
}

/** Cloche de notifications recalculée à la volée côté backend, rafraîchie
 * toutes les 30s. Le badge ne compte que les nouveautés (non vues) : ouvrir la
 * cloche les marque vues côté serveur (POST <endpoint>/seen), donc sur tous les
 * appareils. La liste, elle, garde les éléments encore à traiter — une facture
 * en retard reste un sujet même une fois vue — jusqu'à ce que la personne les
 * écarte avec « Tout marquer comme lu » (POST <endpoint>/read) ; ils restent
 * alors consultables via « Afficher les éléments lus », et une notification
 * nouvelle (autre événement) revient d'elle-même.
 *
 * Par défaut, celle du gestionnaire (messages non lus, factures en retard,
 * incidents ouverts, contrats arrivant à échéance — voir GET /api/notifications) ;
 * `endpoint`/`i18nPrefix` permettent de la réutiliser pour un autre portail
 * (voir TenantLayout.tsx, GET /api/notifications/mine). */
export default function NotificationBell({
  endpoint = "/notifications",
  i18nPrefix = "components.notificationBell",
}: NotificationBellProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  // Clés des notifications qui étaient nouvelles À L'OUVERTURE : le badge
  // retombe aussitôt, mais elles restent surlignées le temps que le panneau est
  // ouvert, pour que la personne voie ce qui vient d'arriver.
  const [nouvelles, setNouvelles] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  // Clés que cette personne vient de marquer vues. Une réponse de sondage partie
  // AVANT l'enregistrement peut arriver après : sans ceci, elle rallumerait le
  // badge jusqu'au sondage suivant.
  const marqueesVues = useRef<Set<string>>(new Set());
  // Même garde pour « lues » : un sondage en retard ne doit pas ressortir du
  // panneau ce que la personne vient d'en écarter.
  const marqueesLues = useRef<Set<string>>(new Set());
  const [afficherLues, setAfficherLues] = useState(false);

  function load(signal?: AbortSignal) {
    api
      .get<{ notifications: NotificationItem[] }>(endpoint, { signal })
      .then((res) =>
        setItems(
          liste<NotificationItem>(res.data, "notifications").map((n) => {
            const cle = n.key ?? n.id;
            const lue = n.read || marqueesLues.current.has(cle);
            return { ...n, seen: n.seen || lue || marqueesVues.current.has(cle), read: lue };
          })
        )
      )
      .catch((err) => {
        if (isRequestCancelled(err)) return;
        // silencieux : la cloche ne doit jamais faire planter le reste de l'app
      });
  }

  // clearInterval arrête les prochains sondages, mais pas celui déjà EN VOL :
  // sans AbortController, une réponse arrivant après le démontage (navigation
  // au moment précis où le sondage des 30s partait) appelait quand même
  // setItems sur un composant qui n'existe plus.
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const interval = setInterval(() => load(controller.signal), POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [endpoint]);

  // Sans clé (ancien backend), l'identifiant fait office de clé.
  const cleDe = (n: NotificationItem) => n.key ?? n.id;
  const nonVues = items.filter((n) => !n.seen);
  const aTraiter = items.filter((n) => !n.read);
  const lues = items.filter((n) => n.read);
  const affichees = afficherLues ? items : aTraiter;

  function fermer() {
    setOpen(false);
    setNouvelles(new Set());
    setAfficherLues(false);
  }

  function toutMarquerLu() {
    const cles = aTraiter.map(cleDe);
    if (cles.length === 0) return;
    cles.forEach((c) => {
      marqueesVues.current.add(c);
      marqueesLues.current.add(c);
    });
    setNouvelles(new Set());
    setItems((courants) => courants.map((n) => ({ ...n, seen: true, read: true })));
    api.post(`${endpoint}/read`, { keys: cles }).catch(() => {
      cles.forEach((c) => marqueesLues.current.delete(c));
      load();
    });
  }

  function basculer() {
    if (open) {
      fermer();
      return;
    }
    setOpen(true);
    if (nonVues.length === 0) return;
    setNouvelles(new Set(nonVues.map(cleDe)));
    // Optimiste : le badge retombe tout de suite. Si l'enregistrement échoue,
    // on relit l'état réel plutôt que de laisser un badge éteint à tort.
    const cles = items.map(cleDe);
    cles.forEach((c) => marqueesVues.current.add(c));
    setItems((courants) => courants.map((n) => ({ ...n, seen: true })));
    api.post(`${endpoint}/seen`, { keys: cles }).catch(() => {
      cles.forEach((c) => marqueesVues.current.delete(c));
      load();
    });
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNouvelles(new Set());
        setAfficherLues(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <Bulle texte={t(`${i18nPrefix}.tip`)}>
      <button
        onClick={basculer}
        className="relative w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
        aria-label={t(`${i18nPrefix}.ariaLabel`)}
      >
        <Bell size={18} />
        {nonVues.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {nonVues.length > 9 ? "9+" : nonVues.length}
          </span>
        )}
      </button>
      </Bulle>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg z-50">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{t(`${i18nPrefix}.title`)}</h4>
              <p className="text-xs text-slate-600 dark:text-slate-400">{t(`${i18nPrefix}.itemCount`, { count: aTraiter.length })}</p>
            </div>
            {aTraiter.length > 0 && (
              <button
                type="button"
                onClick={toutMarquerLu}
                className="shrink-0 text-xs font-medium text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 hover:underline"
              >
                {t(`${i18nPrefix}.markAllRead`)}
              </button>
            )}
          </div>
          {affichees.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 text-center py-8">{t(`${i18nPrefix}.allCaughtUp`)}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {affichees.map((n) => {
                const Icon = iconByType[n.type];
                const classes = [nouvelles.has(cleDe(n)) ? "bg-brand-50/70 dark:bg-brand-500/10" : "", n.read ? "opacity-60" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={n.id} className={classes || undefined}>
                    <Link
                      to={n.link}
                      onClick={fermer}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${severityDot[n.severity]}`} />
                      <Icon size={16} className="mt-0.5 text-slate-600 dark:text-slate-400 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-900 dark:text-slate-100 font-medium truncate">{n.title}</span>
                        <span className="block text-xs text-slate-600 dark:text-slate-400 truncate">{n.description}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {lues.length > 0 && (
            <button
              type="button"
              onClick={() => setAfficherLues((a) => !a)}
              className="w-full px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800 transition-colors"
            >
              {afficherLues ? t(`${i18nPrefix}.hideRead`) : t(`${i18nPrefix}.showRead`, { count: lues.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
