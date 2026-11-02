import { AlertTriangle, Bell, CalendarClock, MessageSquare, UserPlus, Wrench } from "lucide-react";
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
  lead: UserPlus,
};

/** Filet à gauche de chaque notification : encre pour une information, orange pour un avertissement, rouge pour un danger. */
const severityBar: Record<string, string> = {
  info: "shadow-[inset_3px_0_0_var(--color-ink-900)]",
  warning: "shadow-[inset_3px_0_0_var(--color-orange-700)]",
  danger: "shadow-[inset_3px_0_0_var(--color-rose-600)]",
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
  const { t, i18n } = useTranslation();
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
  //
  // Le sondage s'arrête quand l'onglet est caché et repart, avec une lecture immédiate, quand il redevient visible :
  // un onglet oublié en arrière-plan sondait le serveur toute la journée (près de 1 000 appels, chacun avec
  // authentification, contrôle d'abonnement et sept requêtes SQL) pour une cloche que personne ne regardait.
  useEffect(() => {
    const controller = new AbortController();
    let minuteur: ReturnType<typeof setInterval> | null = null;
    const demarrer = () => {
      if (minuteur === null) minuteur = setInterval(() => load(controller.signal), POLL_INTERVAL_MS);
    };
    const arreter = () => {
      if (minuteur !== null) {
        clearInterval(minuteur);
        minuteur = null;
      }
    };
    const surVisibilite = () => {
      if (document.visibilityState === "hidden") {
        arreter();
      } else {
        load(controller.signal);
        demarrer();
      }
    };

    load(controller.signal);
    if (document.visibilityState !== "hidden") demarrer();
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      document.removeEventListener("visibilitychange", surVisibilite);
      arreter();
      controller.abort();
    };
    // Les textes viennent du serveur, dans la langue de l'interface (Accept-Language) : changer de langue relit la cloche.
  }, [endpoint, i18n.language]);

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
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center border border-slate-400 bg-white text-slate-700 transition-colors hover:border-ink-900 hover:bg-slate-50"
        aria-label={t(`${i18nPrefix}.ariaLabel`)}
      >
        <Bell size={18} />
        {nonVues.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center bg-orange-700 px-1 font-mono text-[10px] font-bold text-white">
            {nonVues.length > 9 ? "9+" : nonVues.length}
          </span>
        )}
      </button>
      </Bulle>

      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto border-2 border-ink-900 bg-white">
          <div className="flex items-start justify-between gap-3 border-b border-ink-900 bg-ink-900 px-4 py-3 text-white">
            <div className="min-w-0">
              <h4 className="font-mono text-xs font-semibold uppercase tracking-wider">{t(`${i18nPrefix}.title`)}</h4>
              <p className="text-xs text-white/85">{t(`${i18nPrefix}.itemCount`, { count: aTraiter.length })}</p>
            </div>
            {aTraiter.length > 0 && (
              <button
                type="button"
                onClick={toutMarquerLu}
                className="shrink-0 cursor-pointer border-b border-white/50 text-xs font-semibold text-white hover:border-white"
              >
                {t(`${i18nPrefix}.markAllRead`)}
              </button>
            )}
          </div>
          {affichees.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">{t(`${i18nPrefix}.allCaughtUp`)}</p>
          ) : (
            <ul className="divide-y divide-slate-300">
              {affichees.map((n) => {
                const Icon = iconByType[n.type];
                const classes = [nouvelles.has(cleDe(n)) ? "bg-orange-50" : "", n.read ? "opacity-60" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={n.id} className={classes || undefined}>
                    <Link
                      to={n.link}
                      onClick={fermer}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${severityBar[n.severity] ?? severityBar.info}`}
                    >
                      <Icon size={16} className="mt-0.5 text-slate-600 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-900 font-medium truncate">{n.title}</span>
                        <span className="block text-xs text-slate-600 truncate">{n.description}</span>
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
              className="w-full cursor-pointer border-t border-slate-300 px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-slate-700 transition-colors hover:bg-slate-50"
            >
              {afficherLues ? t(`${i18nPrefix}.hideRead`) : t(`${i18nPrefix}.showRead`, { count: lues.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
