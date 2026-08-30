import { AlertTriangle, Bell, CalendarClock, MessageSquare, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { NotificationItem, NotificationType } from "../types";

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

/** Cloche de notifications regroupant messages non lus, factures en retard,
 * incidents ouverts et contrats arrivant à échéance — recalculée à la volée
 * côté backend (voir GET /api/notifications), rafraîchie toutes les 30s. */
export default function NotificationBell() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    api
      .get<{ notifications: NotificationItem[] }>("/notifications")
      .then((res) => setItems(res.data.notifications))
      .catch(() => {
        // silencieux : la cloche ne doit jamais faire planter le reste de l'app
      });
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
        aria-label={t("components.notificationBell.ariaLabel")}
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg z-50">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{t("components.notificationBell.title")}</h4>
            <p className="text-xs text-slate-400 dark:text-slate-500">{t("components.notificationBell.itemCount", { count: items.length })}</p>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">{t("components.notificationBell.allCaughtUp")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((n) => {
                const Icon = iconByType[n.type];
                return (
                  <li key={n.id}>
                    <Link
                      to={n.link}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${severityDot[n.severity]}`} />
                      <Icon size={16} className="mt-0.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-900 dark:text-slate-100 font-medium truncate">{n.title}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{n.description}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
